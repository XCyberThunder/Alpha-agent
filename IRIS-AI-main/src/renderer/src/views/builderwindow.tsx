import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  FileJson,
  Folder,
  FolderOpen,
  Key,
  Loader2,
  Plus,
  Send,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  User,
  X
} from 'lucide-react'

import {
  BuilderAttachmentDescriptor,
  BuilderModelStatuses,
  BuilderProjectFile,
  BuilderProjectState,
  createBuilderProject,
  exportBuilderProjectZip,
  getBuilderModelStatuses,
  getBuilderWindowState,
  pickBuilderAttachments,
  saveBuilderProjectFile,
  updateBuilderProject
} from '@renderer/services/project-builder'

type RightPanel = 'preview' | 'code'
type PermissionMode = 'ask' | 'approve' | 'full'
type KnownProvider = 'glm' | 'zai' | 'gemini' | 'openrouter' | 'kimi' | 'groq'

type WindowPayload = {
  state?: BuilderProjectState
  previewHtml?: string
  prompt?: string
  providerError?: string
  autoStart?: boolean
  selectedProvider?: string
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

type FileTreeNodeData = {
  name: string
  type: 'file' | 'folder'
  ext?: string
  children?: FileTreeNodeData[]
}

type ProviderOption = {
  id: string
  provider: string
  label: string
  badge: string | null
  configured: boolean
  isCustom?: boolean
}

type CustomModel = {
  id: string
  label: string
  provider: string
  modelName: string
  baseUrl: string
}

type BuilderToast = {
  id: string
  tone: 'success' | 'error'
  message: string
}

const MIN_WIDTH = 220
const MAX_WIDTH = 560
const DRAFT_STORAGE_KEY = 'alpha_builder_window_draft'
const BUILDER_TOAST_EVENT = 'alpha-builder-toast'

const PROVIDER_LABELS: Record<KnownProvider, string> = {
  glm: 'GLM 5.2',
  zai: 'Z.AI',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  kimi: 'Kimi',
  groq: 'Groq'
}

const PROVIDER_GROUP_ALIASES: Record<string, KnownProvider> = {
  glm: 'glm',
  'glm 5.2': 'glm',
  zenmux: 'glm',
  zai: 'zai',
  'z.ai': 'zai',
  'z ai': 'zai',
  gemini: 'gemini',
  openrouter: 'openrouter',
  kimi: 'kimi',
  groq: 'groq'
}

const ACCESS_OPTIONS: Array<{
  id: PermissionMode
  label: string
  desc: string
  icon: typeof ShieldAlert
  color: string
}> = [
  {
    id: 'ask',
    label: 'Ask for approval',
    desc: 'Always ask before file changes and run actions.',
    icon: ShieldAlert,
    color: 'text-yellow-400'
  },
  {
    id: 'approve',
    label: 'Approve for me',
    desc: 'Allow safe project edits and ask on risky actions.',
    icon: ShieldCheck,
    color: 'text-blue-400'
  },
  {
    id: 'full',
    label: 'Full access',
    desc: 'Allow full project edits inside the current workspace.',
    icon: Unlock,
    color: 'text-green-400'
  }
]

const BUILDER_THEME_CSS = `
.builderwindow-root {
  --background: #0c0c0f;
  --foreground: #e2e2e8;
  --card: #111116;
  --popover: #18181e;
  --primary: #7c6cf7;
  --muted: #1e1e26;
  --muted-foreground: #5a5a6e;
  --border: rgba(255,255,255,0.07);
  --danger: #e5484d;
  color: var(--foreground);
  background: var(--background);
  font-family: Geist, Inter, system-ui, sans-serif;
}
.builderwindow-root * {
  box-sizing: border-box;
}
.builderwindow-root ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
.builderwindow-root ::-webkit-scrollbar-track {
  background: transparent;
}
.builderwindow-root ::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.08);
  border-radius: 999px;
}
.builderwindow-root textarea,
.builderwindow-root input,
.builderwindow-root button {
  font: inherit;
}
`

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const emitBuilderToast = (tone: 'success' | 'error', message: string) => {
  window.dispatchEvent(new CustomEvent(BUILDER_TOAST_EVENT, { detail: { tone, message } }))
}

const normalizeProvider = (value?: string | null): KnownProvider | null => {
  if (!value) return null
  const normalized = value.toLowerCase().trim()
  return PROVIDER_GROUP_ALIASES[normalized] || null
}

const providerDisplayName = (value?: string | null) => {
  const normalized = normalizeProvider(value)
  if (normalized) return PROVIDER_LABELS[normalized]
  return value || 'GLM 5.2'
}

const languageForFile = (filePath: string) => {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.html')) return 'html'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) return 'cpp'
  if (lower.endsWith('.c')) return 'c'
  return 'plaintext'
}

const extColorMap: Record<string, string> = {
  tsx: 'text-violet-400',
  ts: 'text-blue-400',
  css: 'text-cyan-400',
  json: 'text-yellow-400',
  md: 'text-emerald-400',
  html: 'text-orange-400',
  js: 'text-amber-400'
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const mapFilesToRecord = (files: BuilderProjectFile[]) =>
  files.reduce<Record<string, string>>((acc, file) => {
    acc[file.path.replace(/\\/g, '/')] = file.content
    return acc
  }, {})

const arrayPathToString = (pathParts: string[]) => pathParts.join('/')

const stringPathToArray = (input: string) => input.split('/').filter(Boolean)

const buildFileTree = (files: BuilderProjectFile[]): FileTreeNodeData[] => {
  const root: FileTreeNodeData[] = []

  const insertNode = (segments: string[], index: number, level: FileTreeNodeData[]) => {
    const name = segments[index]
    const isFile = index === segments.length - 1
    let existing = level.find((node) => node.name === name)

    if (!existing) {
      existing = {
        name,
        type: isFile ? 'file' : 'folder',
        ext: isFile ? name.split('.').pop()?.toLowerCase() : undefined,
        children: isFile ? undefined : []
      }
      level.push(existing)
    }

    if (!isFile && existing.children) {
      insertNode(segments, index + 1, existing.children)
    }
  }

  files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((file) => {
      const segments = stringPathToArray(file.path)
      if (segments.length) insertNode(segments, 0, root)
    })

  const sortNodes = (nodes: FileTreeNodeData[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((node) => node.children && sortNodes(node.children))
  }

  sortNodes(root)
  return root
}

const inlinePreviewHtml = (files: BuilderProjectFile[]) => {
  const htmlFile =
    files.find((file) => file.path === 'index.html') ||
    files.find((file) => file.path.endsWith('/index.html'))

  if (!htmlFile) return ''

  let html = htmlFile.content
  const cssFile =
    files.find((file) => file.path === 'style.css') ||
    files.find((file) => file.path.endsWith('/style.css'))
  const jsFile =
    files.find((file) => file.path === 'script.js') ||
    files.find((file) => file.path.endsWith('/script.js'))

  if (cssFile) {
    html = html.replace(
      /<link[^>]+href=["'][^"']*style\.css["'][^>]*>/i,
      `<style>\n${cssFile.content}\n</style>`
    )
  }

  if (jsFile) {
    html = html.replace(
      /<script[^>]+src=["'][^"']*script\.js["'][^>]*><\/script>/i,
      `<script>\n${jsFile.content}\n</script>`
    )
  }

  return html
}

const openPreviewWindow = (previewMarkup: string, title: string) => {
  const win = window.open('', '_blank', 'noopener,noreferrer')
  if (!win) {
    emitBuilderToast('error', 'Pop-up blocked - allow pop-ups for preview.')
    return
  }
  win.document.open()
  win.document.write(previewMarkup || `<!doctype html><title>${escapeHtml(title)}</title><body style="background:#0c0c0f;color:#e2e2e8;font-family:Inter,sans-serif;display:grid;place-items:center;min-height:100vh">Preview unavailable</body>`)
  win.document.close()
}

const openCodeWindow = (fileName: string, content: string) => {
  const win = window.open('', '_blank', 'noopener,noreferrer')
  if (!win) {
    emitBuilderToast('error', 'Pop-up blocked - allow pop-ups for code view.')
    return
  }

  const rows = content
    .split('\n')
    .map(
      (line, index) =>
        `<tr><td class="ln">${index + 1}</td><td class="code">${escapeHtml(line)}</td></tr>`
    )
    .join('')

  win.document.open()
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(fileName)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#0c0c0f;color:#e2e2e8;font-family:Geist Mono,ui-monospace,monospace;font-size:13px}
    h1{margin:0;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7c6cf7}
    table{width:100%;border-collapse:collapse}.ln{width:52px;padding:0 12px 0 0;text-align:right;color:#5a5a6e;vertical-align:top;user-select:none}.code{padding:0 16px;white-space:pre;word-break:break-word}
    tr:hover{background:rgba(255,255,255,.03)}
  </style></head><body><h1>${escapeHtml(fileName)}</h1><table>${rows}</table></body></html>`)
  win.document.close()
}

const summarizeAttachments = (attachments: BuilderAttachmentDescriptor[]) => {
  if (!attachments.length) return ''
  const parts = attachments.map((attachment) => {
    const contentPreview =
      typeof attachment.content === 'string' && attachment.content.trim()
        ? `\n${attachment.content.slice(0, 12000)}`
        : ''
    return `[ATTACHMENT:${attachment.kind}] ${attachment.name}${contentPreview}`
  })
  return `\n\nAdditional references:\n${parts.join('\n\n')}`
}

const readDraft = () => {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function FileIcon({ ext }: { ext?: string }) {
  if (ext === 'json') return <FileJson size={13} className="text-yellow-400/80" />
  if (ext === 'css') return <FileCode size={13} className="text-blue-400/80" />
  return <FileCode size={13} className="text-violet-400/80" />
}

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  onDownload,
  currentPath
}: {
  node: FileTreeNodeData
  depth: number
  selectedPath: string[]
  onSelect: (path: string[]) => void
  onDownload: (path: string[], name: string) => void
  currentPath: string[]
}) {
  const [open, setOpen] = useState(depth < 2)
  const [hovered, setHovered] = useState(false)
  const path = [...currentPath, node.name]
  const isSelected =
    node.type === 'file' &&
    selectedPath.length === path.length &&
    selectedPath.every((segment, index) => segment === path[index])

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-1.5 rounded text-left text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          style={{
            paddingLeft: `${8 + depth * 14}px`,
            paddingTop: 4,
            paddingBottom: 4,
            paddingRight: 8
          }}
        >
          {open ? (
            <FolderOpen size={13} className="shrink-0 text-yellow-400/70" />
          ) : (
            <Folder size={13} className="shrink-0 text-yellow-400/50" />
          )}
          <span className="text-xs font-medium tracking-wide">{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <FileTreeNode
              key={`${path.join('/')}/${child.name}`}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onDownload={onDownload}
              currentPath={path}
            />
          ))}
      </div>
    )
  }

  return (
    <div
      className={`relative flex items-center rounded transition-colors ${
        isSelected
          ? 'bg-primary/15 text-foreground'
          : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
      }`}
      style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: 6 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={() => onSelect(path)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
        <FileIcon ext={node.ext} />
        <span className="truncate text-xs font-mono">{node.name}</span>
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation()
          onDownload(path, node.name)
        }}
        title={`Download ${node.name}`}
        className="h-5 w-5 shrink-0 rounded transition-all"
        style={{
          opacity: hovered ? 1 : 0,
          pointerEvents: hovered ? 'auto' : 'none',
          color: hovered ? '#c9d1d9' : 'transparent',
          background: 'transparent'
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = '#30363d'
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = 'transparent'
        }}
      >
        <Download size={12} className="mx-auto" />
      </button>
    </div>
  )
}

function AccessMenu({
  value,
  onChange
}: {
  value: PermissionMode
  onChange: (value: PermissionMode) => void
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const handleToggle = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setCoords({ top: rect.top - 8, left: rect.left })
    }
    setOpen((value) => !value)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
      >
        <Key size={11} />
        <span>Access</span>
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="fixed z-[9999] w-64 rounded-xl border border-border bg-popover py-1.5 shadow-2xl shadow-black/70"
          style={{ top: coords.top, left: coords.left, transform: 'translateY(-100%)' }}
        >
          <p className="px-3 pb-1.5 pt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
            How should actions be approved?
          </p>
          {ACCESS_OPTIONS.map((option) => {
            const Icon = option.icon
            const active = option.id === value
            return (
              <button
                key={option.id}
                onClick={() => {
                  onChange(option.id)
                  setOpen(false)
                }}
                className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                  active ? 'bg-white/5' : 'hover:bg-white/[0.04]'
                }`}
              >
                <Icon size={14} className={`mt-0.5 shrink-0 ${option.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {option.label}
                    </span>
                    {active && <Check size={11} className="shrink-0 text-primary" />}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/60">{option.desc}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

const EMPTY_FORM = { provider: '', name: '', apiKey: '', baseUrl: '' }

function ModelSelector({
  value,
  onChange,
  options,
  onAddCustom
}: {
  value: string
  onChange: (value: string) => void
  options: ProviderOption[]
  onAddCustom: (model: CustomModel) => void
}) {
  const [open, setOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = options.find((option) => option.id === value) || options[0]

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
        setShowForm(false)
        setForm(EMPTY_FORM)
        setFormError('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSaveModel = () => {
    if (!form.provider.trim() || !form.name.trim()) {
      setFormError('Provider and model name required')
      return
    }
    if (!form.apiKey.trim()) {
      setFormError('API key required')
      return
    }

    const customModel: CustomModel = {
      id: `custom-${Date.now()}`,
      label: `${form.provider.trim()} / ${form.name.trim()}`,
      provider: form.provider.trim(),
      modelName: form.name.trim(),
      baseUrl: form.baseUrl.trim()
    }

    onAddCustom(customModel)
    onChange(customModel.id)
    setOpen(false)
    setShowForm(false)
    setForm(EMPTY_FORM)
    setFormError('')
    setShowApiKey(false)
    emitBuilderToast('success', `${customModel.label} added for this Builder session.`)
  }

  const inputClassName =
    'w-full rounded-lg border border-border bg-[#0d0d10] px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((state) => !state)
          setShowForm(false)
        }}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <span className="max-w-[110px] truncate">{current?.label || 'Select model'}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-64 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-2xl shadow-black/50">
          {!showForm ? (
            <>
              {options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => {
                    onChange(option.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                    option.id === value
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  <span className="truncate font-medium">{option.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {option.id === value && <Check size={11} className="text-primary" />}
                    {option.badge && (
                      <span className="rounded-md bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {option.badge}
                      </span>
                    )}
                  </span>
                </button>
              ))}
              <div className="mt-1 border-t border-border pt-1">
                <button
                  onClick={() => setShowForm(true)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  <Plus size={12} className="text-primary" />
                  <span>Add model</span>
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2.5 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Add model</span>
                <button
                  onClick={() => {
                    setShowForm(false)
                    setForm(EMPTY_FORM)
                    setFormError('')
                  }}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X size={13} />
                </button>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-medium text-muted-foreground/70">
                  Provider name *
                </label>
                <input
                  className={inputClassName}
                  placeholder="e.g. Gemini, Groq, Z.AI"
                  value={form.provider}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, provider: event.target.value }))
                    setFormError('')
                  }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-medium text-muted-foreground/70">
                  Model name *
                </label>
                <input
                  className={inputClassName}
                  placeholder="e.g. glm-5.2, gemini-2.5-pro"
                  value={form.name}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                    setFormError('')
                  }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-medium text-muted-foreground/70">
                  API key *
                </label>
                <div className="relative">
                  <input
                    className={`${inputClassName} pr-8`}
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="api-key"
                    value={form.apiKey}
                    onChange={(event) => {
                      setForm((prev) => ({ ...prev, apiKey: event.target.value }))
                      setFormError('')
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((state) => !state)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-medium text-muted-foreground/70">
                  Base URL <span className="opacity-50">(optional)</span>
                </label>
                <input
                  className={inputClassName}
                  placeholder="e.g. https://api.example.com"
                  value={form.baseUrl}
                  onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                />
              </div>

              {formError && <p className="text-[11px] text-red-400">{formError}</p>}

              <div className="flex gap-2 pt-0.5">
                <button
                  onClick={handleSaveModel}
                  className="flex-1 rounded-lg bg-primary py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/85"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setShowForm(false)
                    setForm(EMPTY_FORM)
                    setFormError('')
                    setShowApiKey(false)
                  }}
                  className="flex-1 rounded-lg border border-border py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? 'bg-primary/20 text-primary' : 'bg-violet-500/10 text-violet-400'
        }`}
      >
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>
      <div className={`flex max-w-[80%] flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'rounded-tr-sm bg-primary text-white'
              : 'rounded-tl-sm border border-border bg-card text-foreground'
          }`}
          dangerouslySetInnerHTML={{
            __html: escapeHtml(message.content).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          }}
        />
        <span className="px-1 text-[10px] text-muted-foreground/60">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

function CodeEditor({
  content,
  onChange
}: {
  content: string
  onChange: (value: string) => void
}) {
  const lines = content.split('\n')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumberRef = useRef<HTMLDivElement>(null)

  const syncScroll = () => {
    if (textareaRef.current && lineNumberRef.current) {
      lineNumberRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  return (
    <div className="flex h-full overflow-hidden font-mono text-xs leading-[1.6]">
      <div
        ref={lineNumberRef}
        className="w-10 shrink-0 select-none overflow-hidden border-r border-border bg-background"
        style={{ scrollbarWidth: 'none' }}
      >
        {lines.map((_, index) => (
          <div
            key={index}
            className="pr-2.5 text-right text-[11px] text-muted-foreground/40"
            style={{ lineHeight: '1.6' }}
          >
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        spellCheck={false}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        className="flex-1 resize-none overflow-auto bg-transparent px-4 py-0 text-[11px] text-foreground/90 outline-none"
        style={{
          fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
          lineHeight: '1.6',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.1) transparent'
        }}
      />
    </div>
  )
}

function PreviewPanel({
  previewMarkup,
  loading
}: {
  previewMarkup: string
  loading: boolean
}) {
  if (!previewMarkup && !loading) {
    return (
      <div className="relative flex h-full flex-1 items-center justify-center overflow-hidden bg-[#0c0c0f]">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '32px 32px'
          }}
        />
        <div className="relative z-10 text-center">
          <div className="text-3xl font-semibold tracking-tight text-foreground">Describe what you want to build.</div>
          <p className="mt-2 text-sm text-muted-foreground">Preview will appear here once files are generated.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full flex-1 overflow-hidden bg-[#0c0c0f]">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0c0c0f]/65 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin text-primary" />
            <span>Updating preview...</span>
          </div>
        </div>
      )}
      <iframe
        title="ALPHA Builder Preview"
        srcDoc={previewMarkup}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        className="h-full w-full border-0 bg-white"
      />
    </div>
  )
}

function CodePanel({
  tree,
  selectedFilePath,
  onSelectFile,
  content,
  onContentChange,
  onDownloadFile
}: {
  tree: FileTreeNodeData[]
  selectedFilePath: string[]
  onSelectFile: (path: string[]) => void
  content: string
  onContentChange: (value: string) => void
  onDownloadFile: (path: string[], name: string) => void
}) {
  const fileName = selectedFilePath[selectedFilePath.length - 1]
  const ext = fileName?.split('.').pop()?.toLowerCase()

  return (
    <div className="flex h-full">
      <div
        className="w-48 shrink-0 overflow-y-auto border-r border-border bg-card py-2"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.06) transparent' }}
      >
        <div className="px-3 pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Explorer
          </span>
        </div>
        {tree.map((node) => (
          <FileTreeNode
            key={node.name}
            node={node}
            depth={0}
            selectedPath={selectedFilePath}
            onSelect={onSelectFile}
            onDownload={onDownloadFile}
            currentPath={[]}
          />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center overflow-x-auto border-b border-border bg-card">
          <div className="flex items-center gap-2 border-r border-primary/30 bg-background/60 px-4 py-2">
            <FileIcon ext={ext} />
            <span className={`font-mono text-xs font-medium ${extColorMap[ext || ''] || 'text-foreground'}`}>
              {fileName || 'Select a file'}
            </span>
            <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {selectedFilePath.length ? (
            <CodeEditor content={content} onChange={onContentChange} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file to edit.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function BuilderWindow() {
  const [panel, setPanel] = useState<RightPanel>('preview')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>('glm')
  const [sending, setSending] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState<string[]>([])
  const [panelWidth, setPanelWidth] = useState(340)
  const [isDragging, setIsDragging] = useState(false)
  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask')
  const [attachments, setAttachments] = useState<BuilderAttachmentDescriptor[]>([])
  const [projectState, setProjectState] = useState<BuilderProjectState | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [modelStatuses, setModelStatuses] = useState<BuilderModelStatuses>({})
  const [customModels, setCustomModels] = useState<CustomModel[]>([])
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, boolean>>({})
  const [toasts, setToasts] = useState<BuilderToast[]>([])

  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lastAutoRunKeyRef = useRef<string>('')

  const draft = useMemo(() => readDraft(), [])

  useEffect(() => {
    if (!draft) return
    if (typeof draft.input === 'string') setInput(draft.input)
    if (draft.panel === 'preview' || draft.panel === 'code') setPanel(draft.panel)
    if (typeof draft.selectedModel === 'string') setSelectedModel(draft.selectedModel)
    if (draft.permissionMode === 'ask' || draft.permissionMode === 'approve' || draft.permissionMode === 'full') {
      setPermissionMode(draft.permissionMode)
    }
    if (typeof draft.panelWidth === 'number') {
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, draft.panelWidth)))
    }
  }, [draft])

  useEffect(() => {
    localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        input,
        panel,
        selectedModel,
        permissionMode,
        panelWidth,
        updatedAt: new Date().toISOString()
      })
    )
  }, [input, panel, selectedModel, permissionMode, panelWidth])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<{ tone: 'success' | 'error'; message: string }>).detail
      if (!detail?.message) return
      const id = makeId()
      setToasts((current) => [...current, { id, tone: detail.tone, message: detail.message }])
      window.setTimeout(() => {
        setToasts((current) => current.filter((toastItem) => toastItem.id !== id))
      }, 2800)
    }
    window.addEventListener(BUILDER_TOAST_EVENT, handleToast as EventListener)
    return () => window.removeEventListener(BUILDER_TOAST_EVENT, handleToast as EventListener)
  }, [])

  const providerOptions = useMemo<ProviderOption[]>(() => {
    const base: ProviderOption[] = (Object.keys(PROVIDER_LABELS) as KnownProvider[]).map((provider) => {
      const groupKey = provider === 'gemini' ? 'geminiBrain' : provider
      const slots = modelStatuses[groupKey] || []
      const activeSlot = slots.find((slot) => slot.enabled && slot.hasKey)
      const firstSlot = slots[0]
      const configured = Boolean(activeSlot || slots.some((slot) => slot.hasKey))
      const descriptor = activeSlot || firstSlot
      const modelId = descriptor?.modelId?.trim()
      const label = modelId ? `${PROVIDER_LABELS[provider]} / ${modelId}` : PROVIDER_LABELS[provider]
      return {
        id: provider,
        provider,
        label,
        badge: configured ? 'Ready' : 'Missing',
        configured
      }
    })

    const custom = customModels.map<ProviderOption>((model) => ({
      id: model.id,
      provider: model.provider,
      label: model.label,
      badge: 'Custom',
      configured: true,
      isCustom: true
    }))

    return [...base, ...custom]
  }, [customModels, modelStatuses])

  const fileTree = useMemo(() => buildFileTree(projectState?.files || []), [projectState])

  const selectedFileKey = selectedFilePath.length ? arrayPathToString(selectedFilePath) : ''
  const selectedContent = selectedFileKey ? fileContents[selectedFileKey] || '' : ''
  const activePreviewHtml = useMemo(() => {
    if (previewHtml) return previewHtml
    return projectState ? inlinePreviewHtml(projectState.files) : ''
  }, [previewHtml, projectState])

  const loadStatuses = useCallback(async () => {
    try {
      const result = await getBuilderModelStatuses()
      if (result.success && result.statuses) {
        setModelStatuses(result.statuses)
      }
    } catch {
      // leave selector usable without hard failure
    }
  }, [])

  useEffect(() => {
    void loadStatuses()
  }, [loadStatuses])

  const syncProjectState = useCallback(
    (state: BuilderProjectState, incomingPreviewHtml?: string, prompt?: string, providerError?: string) => {
      setProjectState(state)
      setFileContents(mapFilesToRecord(state.files))
      setDirtyFiles({})
      setPreviewHtml(incomingPreviewHtml || inlinePreviewHtml(state.files))
      setPreviewLoading(false)

      setSelectedFilePath((current) => {
        const currentKey = arrayPathToString(current)
        if (currentKey && state.files.some((file) => file.path === currentKey)) return current
        return state.files[0] ? stringPathToArray(state.files[0].path) : []
      })

      const provider = normalizeProvider(state.metadata.providerUsed) || normalizeProvider(state.metadata.modelUsed)
      if (provider) setSelectedModel(provider)

      const nextMessages: Message[] = []
      if (prompt) {
        nextMessages.push({
          id: `prompt-${makeId()}`,
          role: 'user',
          content: prompt,
          timestamp: new Date()
        })
      }
      nextMessages.push({
        id: `ack-${makeId()}`,
        role: 'assistant',
        content: providerError
          ? `Builder shell ready.\n\n${providerError}`
          : `Project ready in **${providerDisplayName(state.metadata.providerUsed)}**. Preview and code are synced.`,
        timestamp: new Date()
      })
      setMessages(nextMessages)
    },
    []
  )

  const submitPrompt = useCallback(
    async ({
      prompt,
      providerId,
      preserveUserMessage = false,
      projectId
    }: {
      prompt: string
      providerId?: string
      preserveUserMessage?: boolean
      projectId?: string | null
    }) => {
      const trimmed = prompt.trim()
      if (!trimmed || sending) return

      const providerChoice =
        normalizeProvider(providerId) ||
        normalizeProvider(
          providerOptions.find((option) => option.id === providerId)?.provider ||
            providerOptions.find((option) => option.id === selectedModel)?.provider ||
            selectedModel
        ) ||
        'glm'

      const messageText = `${trimmed}${summarizeAttachments(attachments)}`

      if (!preserveUserMessage) {
        setMessages((current) => [
          ...current,
          { id: `user-${makeId()}`, role: 'user', content: trimmed, timestamp: new Date() }
        ])
      }

      setSending(true)
      setPreviewLoading(true)

      try {
        const response = projectId
          ? await updateBuilderProject(projectId, messageText, providerChoice)
          : await createBuilderProject(messageText, providerChoice)

        if (response.success && response.state) {
          syncProjectState(response.state, response.previewHtml, preserveUserMessage ? trimmed : undefined)
          if (!preserveUserMessage) {
            setMessages((current) => [
              ...current,
              {
                id: `assistant-${makeId()}`,
                role: 'assistant',
                content: `Applied changes with **${providerDisplayName(
                  response.state?.metadata.providerUsed || providerChoice
                )}**.`,
                timestamp: new Date()
              }
            ])
          }
          setInput('')
          setAttachments([])
          return
        }

        setMessages((current) => [
          ...current,
          {
            id: `error-${makeId()}`,
            role: 'assistant',
            content:
              response.providerError ||
              response.message ||
              response.error ||
              'Builder request failed. Try another configured provider.',
            timestamp: new Date()
          }
        ])
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            id: `exception-${makeId()}`,
            role: 'assistant',
            content: error instanceof Error ? error.message : 'Builder request failed.',
            timestamp: new Date()
          }
        ])
      } finally {
        setSending(false)
        setPreviewLoading(false)
      }
    },
    [attachments, providerOptions, selectedModel, sending, syncProjectState]
  )

  const applyWindowPayload = useCallback(
    async (payload?: WindowPayload) => {
      if (!payload) return

      if (payload.state) {
        syncProjectState(payload.state, payload.previewHtml, payload.prompt, payload.providerError)
        return
      }

      if (payload.prompt) {
        setInput(payload.prompt)
      }

      if (payload.autoStart && payload.prompt) {
        const autoKey = JSON.stringify({
          prompt: payload.prompt,
          provider: payload.selectedProvider || selectedModel
        })

        if (lastAutoRunKeyRef.current !== autoKey) {
          lastAutoRunKeyRef.current = autoKey
          setMessages([
            {
              id: `autostart-${makeId()}`,
              role: 'user',
              content: payload.prompt,
              timestamp: new Date()
            }
          ])
          await submitPrompt({
            prompt: payload.prompt,
            providerId: payload.selectedProvider || selectedModel,
            preserveUserMessage: true
          })
        }
      }
    },
    [selectedModel, submitPrompt, syncProjectState]
  )

  useEffect(() => {
    void (async () => {
      const state = await getBuilderWindowState()
      if (state.success && state.payload) {
        await applyWindowPayload(state.payload)
      }
    })()

    const cleanup = window.electron.ipcRenderer.on('builder-window-state', async (_event, payload) => {
      await applyWindowPayload(payload as WindowPayload)
    })

    return () => {
      cleanup?.()
    }
  }, [applyWindowPayload])

  useEffect(() => {
    if (!projectState?.metadata.id || !selectedFileKey || !dirtyFiles[selectedFileKey]) return

    const timer = window.setTimeout(async () => {
      try {
        const response = await saveBuilderProjectFile(
          projectState.metadata.id,
          selectedFileKey,
          fileContents[selectedFileKey] || ''
        )
        if (response.success && response.state) {
          setProjectState(response.state)
          setPreviewHtml(response.previewHtml || inlinePreviewHtml(response.state.files))
          setDirtyFiles((current) => ({ ...current, [selectedFileKey]: false }))
        } else {
          emitBuilderToast('error', response.error || response.message || 'File save failed.')
        }
      } catch (error) {
        emitBuilderToast('error', error instanceof Error ? error.message : 'File save failed.')
      }
    }, 800)

    return () => window.clearTimeout(timer)
  }, [dirtyFiles, fileContents, projectState, selectedFileKey])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!projectState?.metadata.id || !selectedFileKey) return
        setDirtyFiles((current) => ({ ...current, [selectedFileKey]: true }))
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [projectState?.metadata.id, selectedFileKey])

  const onDividerMouseDown = (event: React.MouseEvent) => {
    event.preventDefault()
    dragStartX.current = event.clientX
    dragStartWidth.current = panelWidth
    setIsDragging(true)

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - dragStartX.current
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta)))
    }

    const onMouseUp = () => {
      setIsDragging(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const handleSend = () => {
    void submitPrompt({
      prompt: input,
      providerId: selectedModel,
      projectId: projectState?.metadata.id || null
    })
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedContent)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      emitBuilderToast('error', 'Copy failed.')
    }
  }

  const handleFileDownload = (pathParts: string[], name: string) => {
    const key = arrayPathToString(pathParts)
    const content = fileContents[key] ?? ''
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    URL.revokeObjectURL(url)
    emitBuilderToast('success', `${name} downloaded`)
  }

  const handleOpenInWindow = () => {
    if (panel === 'preview') {
      openPreviewWindow(activePreviewHtml, projectState?.metadata.name || 'ALPHA Preview')
      return
    }
    const name = selectedFilePath[selectedFilePath.length - 1] || 'file'
    openCodeWindow(name, selectedContent)
  }

  const handleZipDownload = async () => {
    if (!projectState?.metadata.id) {
      emitBuilderToast('error', 'No project available to download yet.')
      return
    }
    const response = await exportBuilderProjectZip(projectState.metadata.id)
    if (response.success) {
      emitBuilderToast(
        'success',
        response.exportPath ? `ZIP exported: ${response.exportPath}` : 'Project ZIP exported.'
      )
    } else {
      emitBuilderToast('error', response.error || response.message || 'ZIP export failed.')
    }
  }

  const handleAddCustomModel = (model: CustomModel) => {
    setCustomModels((current) => [...current, model])
  }

  const handlePickAttachment = async () => {
    const response = await pickBuilderAttachments('file')
    if (!response.success) {
      emitBuilderToast('error', response.error || 'Attachment pick failed.')
      return
    }
    if (response.cancelled || !response.attachments?.length) return
    setAttachments((current) => [...current, ...response.attachments!])
    emitBuilderToast(
      'success',
      `${response.attachments.length} attachment${response.attachments.length > 1 ? 's' : ''} added.`
    )
  }

  const handleSelectFile = (pathParts: string[]) => {
    setSelectedFilePath(pathParts)
    setPanel('code')
  }

  const handleEditorChange = (value: string) => {
    if (!selectedFileKey) return
    setFileContents((current) => ({ ...current, [selectedFileKey]: value }))
    setDirtyFiles((current) => ({ ...current, [selectedFileKey]: true }))
  }

  const currentModelLabel = providerOptions.find((option) => option.id === selectedModel)?.label || 'GLM 5.2'

  return (
    <>
      <style>{BUILDER_THEME_CSS}</style>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
        {toasts.map((toastItem) => (
          <div
            key={toastItem.id}
            className={`min-w-[220px] rounded-xl border px-3 py-2 text-sm shadow-2xl ${
              toastItem.tone === 'success'
                ? 'border-emerald-500/25 bg-[#18181e] text-emerald-200'
                : 'border-red-500/25 bg-[#18181e] text-red-200'
            }`}
          >
            {toastItem.message}
          </div>
        ))}
      </div>

      <div
        className={`builderwindow-root flex h-screen w-full overflow-hidden bg-background ${
          isDragging ? 'cursor-col-resize select-none' : ''
        }`}
      >
        <div className="flex shrink-0 flex-col bg-card" style={{ width: panelWidth }}>
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-sm font-semibold tracking-tight text-foreground">Agent</span>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {currentModelLabel.split(' ').slice(-2).join(' ')}
            </span>
          </div>

          <div
            className="flex-1 space-y-5 overflow-y-auto px-4 py-4"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.06) transparent' }}
          >
            {messages.length === 0 && !sending ? (
              <div className="flex h-full min-h-[220px] items-center justify-center text-center">
                <div>
                  <div className="text-lg font-semibold tracking-tight text-foreground">Describe what you want to build.</div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your project-specific coding chat will appear here.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message) => <ChatMessage key={message.id} message={message} />)
            )}

            {sending && (
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-400">
                  <Bot size={13} />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-3">
                  <Loader2 size={13} className="animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t border-border px-2.5 py-2">
            <div className="rounded-lg border border-border bg-muted/40 transition-all focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Describe what to build..."
                rows={2}
                className="w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
                style={{ scrollbarWidth: 'none' }}
              />
              <div className="flex items-center justify-between px-2 pb-2 pt-0.5">
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={handlePickAttachment}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                    aria-label="Add attachment"
                    title={attachments.length ? `${attachments.length} attachment(s) selected` : 'Add attachment'}
                  >
                    <Plus size={13} />
                  </button>
                  <AccessMenu value={permissionMode} onChange={setPermissionMode} />
                </div>

                <div className="flex items-center gap-1.5">
                  <ModelSelector
                    value={selectedModel}
                    onChange={setSelectedModel}
                    options={providerOptions}
                    onAddCustom={handleAddCustomModel}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || sending}
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-white transition-all hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="Send builder prompt"
                  >
                    {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          onMouseDown={onDividerMouseDown}
          className={`group relative flex w-[3px] shrink-0 cursor-col-resize items-center justify-center transition-colors duration-150 ${
            isDragging ? 'bg-primary' : 'bg-border hover:bg-primary'
          }`}
        >
          <div className={`flex flex-col gap-[3px] transition-opacity ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-[3px] w-[3px] rounded-full bg-white/60" />
            ))}
          </div>
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-2.5">
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5">
              {(['preview', 'code'] as RightPanel[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPanel(mode)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                    panel === mode
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {mode === 'preview' ? <Eye size={13} /> : <Code2 size={13} />}
                  <span className="capitalize">{mode}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenInWindow}
                title="Open in window"
                className="flex items-center justify-center rounded-lg border border-border bg-[#21262d] px-[8px] py-[6px] text-muted-foreground transition-colors hover:bg-[#30363d] hover:text-foreground"
              >
                <ExternalLink size={16} />
              </button>

              {panel === 'code' && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-[#21262d] px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-[#30363d] hover:text-foreground"
                >
                  {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              )}

              <button
                onClick={handleZipDownload}
                className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-white/90"
              >
                <Download size={12} />
                <span>Download</span>
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-background">
            {panel === 'preview' ? (
              <PreviewPanel previewMarkup={activePreviewHtml} loading={previewLoading} />
            ) : (
              <CodePanel
                tree={fileTree}
                selectedFilePath={selectedFilePath}
                onSelectFile={handleSelectFile}
                content={selectedContent}
                onContentChange={handleEditorChange}
                onDownloadFile={handleFileDownload}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
