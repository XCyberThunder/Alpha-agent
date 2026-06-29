import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  MoreHorizontal,
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
  BuilderProviderSelection,
  BuilderProjectFile,
  BuilderProjectState,
  createBuilderProject,
  exportBuilderProjectZip,
  getBuilderModelStatuses,
  getBuilderWindowState,
  openBuilderProjectFolder,
  openBuilderProjectInVsCode,
  pickBuilderAttachments,
  readBuilderProject,
  saveBuilderProjectFile,
  copyBuilderProjectPath,
  updateBuilderProject
} from '@renderer/services/project-builder'

type RightPanel = 'preview' | 'code'
type PermissionMode = 'ask' | 'approve' | 'full'
type KnownProvider =
  | 'glm'
  | 'zai'
  | 'gemini'
  | 'openrouter'
  | 'kimi'
  | 'groq'
  | 'kiloGateway'
  | 'routeway'

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
  provider: KnownProvider
  label: string
  badge: string | null
  configured: boolean
  slot?: number
  modelId?: string
  baseUrl?: string
  providerMode?: string
  apiKey?: string
  groupLabel?: string
  isCustom?: boolean
}

type BuilderProviderSelectionPayload = Extract<BuilderProviderSelection, { provider: string }>

type CustomModel = {
  id: string
  label: string
  provider: KnownProvider
  modelName: string
  baseUrl: string
  apiKey: string
  providerMode?: string
}

type BuilderToast = {
  id: string
  tone: 'success' | 'error'
  message: string
}

type PersistedMessage = Omit<Message, 'timestamp'> & { timestamp: string }

type ChatSession = {
  id: string
  projectId: string | null
  title: string
  providerId: string
  createdAt: string
  updatedAt: string
  messages: PersistedMessage[]
}

type ChatStore = {
  sessions: ChatSession[]
  recentSessionIds: string[]
}

type SidebarMenuSection = 'project' | 'more' | null

const MIN_WIDTH = 220
const MAX_WIDTH = 560
const DRAFT_STORAGE_KEY = 'alpha_builder_window_draft'
const BUILDER_TOAST_EVENT = 'alpha-builder-toast'
const CHAT_SESSIONS_STORAGE_KEY = 'alpha_builder_chat_sessions_v1'

const PROVIDER_LABELS: Record<KnownProvider, string> = {
  kiloGateway: 'Kilo Gateway',
  routeway: 'Routeway',
  glm: 'GLM 5.2',
  zai: 'Z.AI',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  kimi: 'Kimi',
  groq: 'Groq'
}

const PROVIDER_GROUP_ALIASES: Record<string, KnownProvider> = {
  kiloGateway: 'kiloGateway',
  'kilo gateway': 'kiloGateway',
  kilo: 'kiloGateway',
  routeway: 'routeway',
  'routeway.ai': 'routeway',
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
    desc: 'Always ask before edits / commands / external actions.',
    icon: ShieldAlert,
    color: 'text-yellow-400'
  },
  {
    id: 'approve',
    label: 'Approve for me',
    desc: 'Only ask for actions detected as potentially unsafe.',
    icon: ShieldCheck,
    color: 'text-blue-400'
  },
  {
    id: 'full',
    label: 'Full access',
    desc: 'Broad access mode, but still respect ALPHA safety boundaries.',
    icon: Unlock,
    color: 'text-green-400'
  }
]

const BUILDER_THEME_CSS = `
.builderwindow-root {
  --background: #141414;
  --background-soft: #1a1a1a;
  --foreground: #ffffff;
  --card: rgba(26,26,26,0.92);
  --popover: rgba(29,29,29,0.98);
  --primary: #2f81f7;
  --primary-cyan: #2f81f7;
  --primary-pink: #7c6cf7;
  --primary-blue: #3b82f6;
  --primary-red: #ef4444;
  --muted: rgba(24,24,27,0.96);
  --muted-foreground: #a1a1aa;
  --border: rgba(255,255,255,0.09);
  --danger: #ef4444;
  color: var(--foreground);
  background:
    radial-gradient(circle at 12% 0%, rgba(124,108,247,0.12), transparent 20%),
    radial-gradient(circle at 100% 100%, rgba(47,129,247,0.09), transparent 18%),
    linear-gradient(180deg, #1e1b1d 0%, #17171a 18%, #121214 100%);
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
.builderwindow-root textarea::placeholder,
.builderwindow-root input::placeholder {
  color: rgba(161,161,170,0.58);
}
.builderwindow-root .glass-panel {
  background:
    linear-gradient(180deg, rgba(31,31,34,0.97), rgba(20,20,23,0.985));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow:
    0 20px 44px rgba(0,0,0,0.30),
    inset 0 1px 0 rgba(255,255,255,0.04),
    inset 0 0 0 1px rgba(124,108,247,0.02);
  backdrop-filter: blur(16px);
}
.builderwindow-root .premium-button {
  background:
    linear-gradient(180deg, rgba(41,41,45,0.96), rgba(24,24,27,0.98));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.04),
    0 8px 24px rgba(0,0,0,0.16);
}
.builderwindow-root .premium-button:hover {
  background:
    linear-gradient(180deg, rgba(49,49,54,0.98), rgba(28,28,31,0.98));
}
.builderwindow-root .menu-surface {
  background:
    linear-gradient(180deg, rgba(29,29,31,0.98), rgba(21,21,24,0.98));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow:
    0 24px 48px rgba(0,0,0,0.42),
    inset 0 1px 0 rgba(255,255,255,0.05);
  backdrop-filter: blur(16px);
}
.builderwindow-root .field-shell {
  background:
    linear-gradient(180deg, rgba(23,23,25,0.98), rgba(17,17,18,0.98));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.03),
    0 8px 24px rgba(0,0,0,0.18);
}
.builderwindow-root .accent-status {
  background: linear-gradient(180deg, rgba(28,28,31,0.98), rgba(20,20,24,0.98));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}
.builderwindow-root .codex-panel {
  background: linear-gradient(180deg, rgba(26,26,26,0.96), rgba(18,18,18,0.98));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.builderwindow-root .codex-user-bubble {
  background: linear-gradient(180deg, rgba(33,49,82,0.96), rgba(29,40,66,0.96));
  border: 1px solid rgba(83,138,255,0.28);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}
.builderwindow-root .codex-assistant-card {
  background: linear-gradient(180deg, rgba(27,27,30,0.96), rgba(18,18,20,0.98));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.builderwindow-root .codex-input-shell {
  background:
    linear-gradient(180deg, rgba(19,19,22,0.98), rgba(15,15,18,0.98));
  border: 1px solid rgba(255,255,255,0.07);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.025),
    0 8px 20px rgba(0,0,0,0.18);
}
.builderwindow-root .codex-editor-surface {
  background: #1e1e1e;
}
.builderwindow-root .codex-editor-gutter {
  background: #181818;
}
.builderwindow-root .codex-editor-tab {
  background: #252526;
}
.builderwindow-root .codex-editor-border {
  border-color: rgba(255,255,255,0.06);
}
.builderwindow-root .minimal-control {
  background: linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.008));
  border: 1px solid rgba(255,255,255,0.055);
  box-shadow: none;
  color: #b5b5be;
  backdrop-filter: blur(10px);
  transition:
    background-color 140ms ease-out,
    border-color 140ms ease-out,
    color 140ms ease-out,
    transform 140ms ease-out,
    box-shadow 140ms ease-out;
}
.builderwindow-root .minimal-control:hover {
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
  border-color: rgba(255,255,255,0.11);
  color: #f4f4f5;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
}
.builderwindow-root .minimal-control-active {
  background: linear-gradient(180deg, rgba(59,130,246,0.14), rgba(124,108,247,0.12));
  border-color: rgba(96,165,250,0.24);
  color: #ffffff;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.03),
    0 0 0 1px rgba(59,130,246,0.05);
}
.builderwindow-root .minimal-control-ghost {
  background: transparent;
  border: none;
  box-shadow: none;
}
.builderwindow-root .dropdown-enter {
  transform-origin: bottom left;
  animation: builder-fade-scale 150ms ease-out;
}
.builderwindow-root .dropdown-enter-right {
  transform-origin: bottom right;
  animation: builder-fade-scale 150ms ease-out;
}
.builderwindow-root .preview-surface {
  background:
    radial-gradient(circle at 50% 18%, rgba(56,189,248,0.08), transparent 22%),
    radial-gradient(circle at 82% 10%, rgba(124,108,247,0.06), transparent 20%),
    linear-gradient(180deg, #101114 0%, #0b0c10 100%);
}
.builderwindow-root .preview-chip {
  background: rgba(12,14,18,0.78);
  border: 1px solid rgba(255,255,255,0.075);
  box-shadow:
    0 8px 24px rgba(0,0,0,0.28),
    inset 0 1px 0 rgba(255,255,255,0.03);
}
@keyframes builder-fade-scale {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
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
  return value || 'Kilo Gateway'
}

const toProviderSelection = (
  option?: ProviderOption | null
): BuilderProviderSelectionPayload | undefined => {
  if (!option) return undefined
  return {
    provider: option.provider,
    slot: option.slot,
    modelId: option.modelId,
    baseUrl: option.baseUrl,
    providerMode: option.providerMode,
    apiKey: option.apiKey,
    label: option.label
  }
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

const serializeMessages = (messages: Message[]): PersistedMessage[] =>
  messages.map((message) => ({
    ...message,
    timestamp: message.timestamp.toISOString()
  }))

const hydrateMessages = (messages: PersistedMessage[]): Message[] =>
  messages.map((message) => ({
    ...message,
    timestamp: new Date(message.timestamp)
  }))

const readChatStore = (): ChatStore => {
  try {
    const raw = localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)
    if (!raw) return { sessions: [], recentSessionIds: [] }
    const parsed = JSON.parse(raw) as Partial<ChatStore>
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      recentSessionIds: Array.isArray(parsed.recentSessionIds) ? parsed.recentSessionIds : []
    }
  } catch {
    return { sessions: [], recentSessionIds: [] }
  }
}

const writeChatStore = (store: ChatStore) => {
  localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(store))
}

const deriveSessionTitle = (messages: Message[], fallback = 'New chat') => {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content.trim()
  if (!firstUserMessage) return fallback
  return firstUserMessage.length > 56 ? `${firstUserMessage.slice(0, 56)}...` : firstUserMessage
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
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 280 })
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
      setCoords({
        top: Math.max(16, rect.top - 12),
        left: Math.max(12, rect.left),
        width: Math.max(272, rect.width + 96)
      })
    }
    setOpen((value) => !value)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="minimal-control flex h-6.5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium"
        aria-expanded={open}
        aria-label="Access permissions"
      >
        <Key size={11} />
        <span>Access</span>
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu-surface dropdown-enter fixed z-[9999] rounded-xl py-1.5 shadow-2xl"
            style={{
              top: coords.top,
              left: coords.left,
              width: Math.min(coords.width, 244),
              transform: 'translateY(-100%)'
            }}
          >
            <p className="px-3 pb-1 pt-0.5 text-[9px] font-medium uppercase tracking-widest text-muted-foreground/60">
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
                  className={`mx-1.5 flex w-[calc(100%-12px)] items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all ${
                    active
                      ? 'bg-gradient-to-r from-cyan-500/12 via-violet-500/10 to-pink-500/12'
                      : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/20">
                    <Icon size={11} className={option.color} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {option.label}
                      </span>
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                          active ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-300' : 'border-white/10 text-transparent'
                        }`}
                      >
                        <Check size={9} />
                      </span>
                    </div>
                    <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground/70">{option.desc}</p>
                  </div>
                </button>
              )
            })}
          </div>,
          document.body
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
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 248 })
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const current = options.find((option) => option.id === value) || options[0]

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
        setShowForm(false)
        setForm(EMPTY_FORM)
        setFormError('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const updateCoords = useCallback(
    (formOpen: boolean) => {
      if (!buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      const width = formOpen ? 308 : 236
      setCoords({
        top: Math.max(16, rect.top - 12),
        left: Math.min(window.innerWidth - width - 16, Math.max(12, rect.left + rect.width - width)),
        width
      })
    },
    []
  )

  const handleSaveModel = () => {
    if (!form.provider.trim() || !form.name.trim()) {
      setFormError('Provider and model name required')
      return
    }
    if (!form.apiKey.trim()) {
      setFormError('API key required')
      return
    }

    const normalizedProvider = normalizeProvider(form.provider)
    if (!normalizedProvider) {
      setFormError('Known provider name required')
      return
    }

    const customModel: CustomModel = {
      id: `custom-${Date.now()}`,
      label: `${form.provider.trim()} / ${form.name.trim()}`,
      provider: normalizedProvider,
      modelName: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      providerMode: 'openai-compatible'
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
    'w-full rounded-lg border border-border bg-[#101014] px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50'

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        onClick={() => {
          updateCoords(false)
          setOpen((state) => !state)
          setShowForm(false)
        }}
        className="minimal-control flex h-6.5 w-[74px] min-w-0 max-w-[74px] items-center justify-between gap-1 rounded-md px-1.5 text-[11px] font-medium"
        title={current?.label || 'Select model'}
        aria-label={current?.label || 'Select model'}
      >
        <span className="truncate">Model</span>
        <ChevronDown size={9} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        createPortal(
        <div
          ref={menuRef}
          className="menu-surface dropdown-enter-right fixed z-[9998] overflow-hidden rounded-xl py-1.5 shadow-2xl"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
            transform: 'translateY(-100%)',
            maxHeight: '70vh'
          }}
        >
          {!showForm ? (
            <>
              <div className="max-h-[48vh] overflow-y-auto px-1.5">
              {options.map((option, index) => {
                const showGroupLabel = index === 0 || option.groupLabel !== options[index - 1]?.groupLabel
                return (
                  <div key={option.id}>
                    {showGroupLabel && option.groupLabel ? (
                      <div className="px-2.5 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/55">
                        {option.groupLabel}
                      </div>
                    ) : null}
                    <button
                      onClick={() => {
                        onChange(option.id)
                        setOpen(false)
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                        option.id === value
                          ? 'bg-gradient-to-r from-cyan-500/12 via-violet-500/10 to-pink-500/12 text-foreground'
                          : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                      }`}
                    >
                      <span className="truncate font-medium">{option.label}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {option.id === value && <Check size={11} className="text-primary" />}
                        {option.badge && (
                          <span className="rounded-md bg-primary/16 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                            {option.badge}
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                )
              })}
              </div>
              <div className="mt-1 border-t border-border px-1.5 pt-1">
                <button
                  onClick={() => {
                    updateCoords(true)
                    setShowForm(true)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  <Plus size={12} className="text-primary" />
                  <span>Add model</span>
                </button>
              </div>
            </>
          ) : (
            <div className="max-h-[70vh] space-y-2.5 overflow-y-auto p-3">
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
                  className="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 py-2 text-xs font-medium text-white transition-colors hover:opacity-90"
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
                  className="flex-1 rounded-xl border border-border py-2 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-[#213152] text-blue-200'
            : 'border border-white/8 bg-[#232326] text-zinc-300'
        }`}
      >
        {isUser ? <User size={9} /> : <Bot size={9} />}
      </div>
      <div className={`flex max-w-[80%] flex-col gap-0.5 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`whitespace-pre-wrap px-3 py-1.5 text-[11.5px] leading-5 ${
            isUser
              ? 'codex-user-bubble rounded-2xl rounded-tr-md text-white'
              : 'codex-assistant-card rounded-2xl rounded-tl-md text-zinc-100'
          }`}
          dangerouslySetInnerHTML={{
            __html: escapeHtml(message.content).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          }}
        />
        <span className="px-1 text-[9.5px] text-muted-foreground/55">
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
    <div className="codex-editor-surface flex h-full overflow-hidden font-mono text-xs leading-[1.6] text-[#d4d4d4]">
      <div
        ref={lineNumberRef}
        className="codex-editor-gutter codex-editor-border w-11 shrink-0 select-none overflow-hidden border-r"
        style={{ scrollbarWidth: 'none' }}
      >
        {lines.map((_, index) => (
          <div
            key={index}
            className="pr-2.5 text-right text-[11px] text-[#6e7681]"
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
        className="flex-1 resize-none overflow-auto bg-transparent px-4 py-0 text-[11px] text-[#d4d4d4] outline-none"
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
      <div className="preview-surface relative flex h-full flex-1 items-center justify-center overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '32px 32px'
          }}
        />
        <div className="relative z-10 text-center">
          <div className="text-[28px] font-semibold tracking-tight text-foreground">Describe what you want to build.</div>
          <p className="mt-2 text-[13px] text-muted-foreground">Preview will appear here once files are generated.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="preview-surface relative h-full flex-1 overflow-hidden">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#050505]/66 backdrop-blur-md">
          <div className="preview-chip flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-muted-foreground">
            <Loader2 size={12} className="animate-spin text-cyan-300" />
            <span>Updating preview...</span>
          </div>
        </div>
      )}
      <iframe
        title="ALPHA Builder Preview"
        srcDoc={previewMarkup}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        className="h-full w-full border-0 bg-transparent"
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
        className="codex-editor-gutter codex-editor-border w-48 shrink-0 overflow-y-auto border-r py-2"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.06) transparent' }}
      >
        <div className="px-3 pb-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
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
        <div className="codex-editor-tab codex-editor-border flex shrink-0 items-center overflow-x-auto border-b">
          <div className="flex items-center gap-2 border-r border-white/5 bg-black/10 px-3 py-1.5">
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
            <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
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
  const [selectedModel, setSelectedModel] = useState<string>('kiloGateway-default')
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
  const [activeSessionId, setActiveSessionId] = useState('')
  const [recentSessions, setRecentSessions] = useState<ChatSession[]>([])
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false)
  const [sidebarMenuSection, setSidebarMenuSection] = useState<SidebarMenuSection>(null)
  const [statusText, setStatusText] = useState('Describe what you want to build.')

  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lastAutoRunKeyRef = useRef<string>('')
  const sidebarMenuRef = useRef<HTMLDivElement>(null)
  const sidebarMenuButtonRef = useRef<HTMLButtonElement>(null)

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

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        sidebarMenuRef.current &&
        !sidebarMenuRef.current.contains(event.target as Node) &&
        sidebarMenuButtonRef.current &&
        !sidebarMenuButtonRef.current.contains(event.target as Node)
      ) {
        setSidebarMenuOpen(false)
        setSidebarMenuSection(null)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  useEffect(() => {
    const store = readChatStore()
    const sessions = [...store.sessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    setRecentSessions(sessions.slice(0, 8))
  }, [])

  const providerOptions = useMemo<ProviderOption[]>(() => {
    const providerOrder: KnownProvider[] = [
      'kiloGateway',
      'glm',
      'zai',
      'openrouter',
      'routeway',
      'gemini',
      'kimi',
      'groq'
    ]

    const base: ProviderOption[] = providerOrder.flatMap((provider) => {
      const groupKey = provider === 'gemini' ? 'geminiBrain' : provider
      const slots = modelStatuses[groupKey] || []
      const defaultsByProvider: Record<KnownProvider, { modelId: string; baseUrl?: string; providerMode?: string }> = {
        kiloGateway: { modelId: 'laguna-m.1:free', baseUrl: 'https://api.kilo.ai/api/gateway', providerMode: 'openai-compatible' },
        glm: { modelId: 'z-ai/glm-5.2-free', baseUrl: 'https://zenmux.ai/api/v1', providerMode: 'openai-compatible' },
        zai: { modelId: 'glm-4.5v', baseUrl: 'https://api.z.ai/api/coding/paas/v4', providerMode: 'zai-coding' },
        openrouter: { modelId: 'openai/gpt-4.1-mini', baseUrl: 'https://openrouter.ai/api/v1', providerMode: 'openai-compatible' },
        routeway: { modelId: '', baseUrl: 'https://api.routeway.ai/v1', providerMode: 'openai-compatible' },
        gemini: { modelId: 'gemini-2.5-flash' },
        kimi: { modelId: 'moonshot-v1-8k' },
        groq: { modelId: 'llama-3.1-8b-instant' }
      }
      const defaults = defaultsByProvider[provider]
      const configuredSlots = slots
        .filter((slot) => slot.enabled && (slot.hasKey || provider === 'gemini'))
        .map<ProviderOption>((slot) => ({
          id: `${provider}-slot-${slot.slot}`,
          provider,
          label: `${PROVIDER_LABELS[provider]} / ${slot.modelId?.trim() || defaults.modelId || `Slot ${slot.slot}`}`,
          badge: slot.hasKey || provider === 'gemini' ? 'Configured' : 'Not configured',
          configured: Boolean(slot.hasKey || provider === 'gemini'),
          slot: slot.slot,
          modelId: slot.modelId?.trim() || defaults.modelId,
          baseUrl: slot.baseUrl?.trim() || defaults.baseUrl,
          providerMode: slot.providerMode?.trim() || defaults.providerMode,
          groupLabel: PROVIDER_LABELS[provider]
        }))

      const defaultOption: ProviderOption = {
        id: `${provider}-default`,
        provider,
        label: `${PROVIDER_LABELS[provider]} / ${defaults.modelId || 'Select model'}`,
        badge: configuredSlots.length ? 'Configured' : 'Not configured',
        configured: configuredSlots.length > 0 || provider === 'gemini',
        modelId: defaults.modelId,
        baseUrl: defaults.baseUrl,
        providerMode: defaults.providerMode,
        groupLabel: PROVIDER_LABELS[provider]
      }

      return provider === 'kiloGateway'
        ? [defaultOption, ...configuredSlots]
        : configuredSlots.length
          ? configuredSlots
          : [defaultOption]
    })

    const custom = customModels.map<ProviderOption>((model) => ({
      id: model.id,
      provider: model.provider,
      label: model.label,
      badge: 'Custom',
      configured: true,
      modelId: model.modelName,
      baseUrl: model.baseUrl,
      providerMode: model.providerMode || 'openai-compatible',
      apiKey: model.apiKey,
      groupLabel: 'Custom Compatible',
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

  const refreshRecentSessions = useCallback((preferredProjectId?: string | null) => {
    const store = readChatStore()
    const ordered = [...store.sessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    const filtered = preferredProjectId
      ? [
          ...ordered.filter((session) => session.projectId === preferredProjectId),
          ...ordered.filter((session) => session.projectId !== preferredProjectId)
        ]
      : ordered
    setRecentSessions(filtered.slice(0, 8))
  }, [])

  const persistSession = useCallback(
    (nextMessages: Message[], projectId?: string | null, sessionIdOverride?: string) => {
      if (!nextMessages.length) return
      const store = readChatStore()
      const sessionId = sessionIdOverride || activeSessionId || `session-${makeId()}`
      const existing = store.sessions.find((session) => session.id === sessionId)
      const now = new Date().toISOString()
      const nextSession: ChatSession = {
        id: sessionId,
        projectId: projectId ?? projectState?.metadata.id ?? existing?.projectId ?? null,
        title: deriveSessionTitle(nextMessages, existing?.title || projectState?.metadata.name || 'New chat'),
        providerId: selectedModel,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        messages: serializeMessages(nextMessages)
      }
      const nextSessions = [
        nextSession,
        ...store.sessions.filter((session) => session.id !== sessionId)
      ]
      writeChatStore({
        sessions: nextSessions,
        recentSessionIds: [sessionId, ...store.recentSessionIds.filter((id) => id !== sessionId)].slice(0, 24)
      })
      if (sessionId !== activeSessionId) {
        setActiveSessionId(sessionId)
      }
      refreshRecentSessions(nextSession.projectId)
    },
    [activeSessionId, projectState?.metadata.id, projectState?.metadata.name, refreshRecentSessions, selectedModel]
  )

  const loadSessionById = useCallback(
    async (sessionId: string) => {
      const store = readChatStore()
      const session = store.sessions.find((item) => item.id === sessionId)
      if (!session) return

      if (session.projectId && session.projectId !== projectState?.metadata.id) {
        const response = await readBuilderProject(session.projectId)
        if (response.success && response.state) {
          setProjectState(response.state)
          setFileContents(mapFilesToRecord(response.state.files))
          setDirtyFiles({})
          setPreviewHtml(response.previewHtml || inlinePreviewHtml(response.state.files))
          setSelectedFilePath(response.state.files[0] ? stringPathToArray(response.state.files[0].path) : [])
        }
      }

      setActiveSessionId(session.id)
      if (session.providerId) {
        setSelectedModel(session.providerId)
      }
      setMessages(hydrateMessages(session.messages))
      setStatusText(`Loaded chat: ${session.title}`)
      refreshRecentSessions(session.projectId)
    },
    [projectState?.metadata.id, refreshRecentSessions]
  )

  const syncProjectState = useCallback(
    (
      state: BuilderProjectState,
      incomingPreviewHtml?: string,
      prompt?: string,
      providerError?: string,
      preserveCurrentChat = false
    ) => {
      setProjectState(state)
      setFileContents(mapFilesToRecord(state.files))
      setDirtyFiles({})
      setPreviewHtml(incomingPreviewHtml || inlinePreviewHtml(state.files))
      setPreviewLoading(false)
      setStatusText(
        providerError
          ? providerError
          : `Project ready in ${providerDisplayName(state.metadata.providerUsed)}.`
      )

      setSelectedFilePath((current) => {
        const currentKey = arrayPathToString(current)
        if (currentKey && state.files.some((file) => file.path === currentKey)) return current
        return state.files[0] ? stringPathToArray(state.files[0].path) : []
      })

      if (preserveCurrentChat) return

      const store = readChatStore()
      const latestProjectSession = store.sessions
        .filter((session) => session.projectId === state.metadata.id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]

      if (latestProjectSession) {
        setActiveSessionId(latestProjectSession.id)
        if (latestProjectSession.providerId) {
          setSelectedModel(latestProjectSession.providerId)
        }
        setMessages(hydrateMessages(latestProjectSession.messages))
        return
      }

      if (prompt || providerError) {
        const nextMessages: Message[] = []
        if (prompt) {
          nextMessages.push({
            id: `prompt-${makeId()}`,
            role: 'user',
            content: prompt,
            timestamp: new Date()
          })
        }
        if (providerError) {
          nextMessages.push({
            id: `ack-${makeId()}`,
            role: 'assistant',
            content: `Builder shell ready.\n\n${providerError}`,
            timestamp: new Date()
          })
        }
        setMessages(nextMessages)
        return
      }

      setMessages([])
    },
    []
  )

  useEffect(() => {
    if (!messages.length) return
    persistSession(messages, projectState?.metadata.id || null)
  }, [messages, persistSession, projectState?.metadata.id])

  useEffect(() => {
    if (!projectState?.metadata.id) return
    if (messages.length) return
    const store = readChatStore()
    const latestProjectSession = store.sessions
      .filter((session) => session.projectId === projectState.metadata.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
    if (!latestProjectSession) return
    setActiveSessionId(latestProjectSession.id)
    setMessages(hydrateMessages(latestProjectSession.messages))
    setStatusText(`Restored chat: ${latestProjectSession.title}`)
  }, [messages.length, projectState?.metadata.id])

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
      setInput('')
      setStatusText(`Sending request to ${providerDisplayName(providerId || selectedModel)}...`)

      const selectedOption =
        providerOptions.find((option) => option.id === providerId) ||
        providerOptions.find((option) => option.id === selectedModel) ||
        providerOptions[0]
      const providerChoice = toProviderSelection(selectedOption)

      const messageText = `${trimmed}${summarizeAttachments(attachments)}`
      if (import.meta.env.DEV) {
        console.info('[BUILDER_DEBUG] submit', {
          provider: providerChoice?.provider,
          modelId: providerChoice?.modelId || '',
          slot: providerChoice?.slot || null,
          selectedModel,
          promptLength: trimmed.length,
          attachments: attachments.length,
          existingProjectId: projectId || null
        })
      }

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
          syncProjectState(response.state, response.previewHtml, undefined, response.providerError, true)
          if (!preserveUserMessage) {
            setMessages((current) => [
              ...current,
              {
                id: `assistant-${makeId()}`,
                role: 'assistant',
                content: response.providerError
                  ? `Provider returned fallback shell.\n\n${response.providerError}`
                  : `Applied changes with **${providerDisplayName(
                      response.state?.metadata.providerUsed || providerChoice?.label || providerChoice?.provider
                    )}**.`,
                timestamp: new Date()
              }
            ])
          }
          setStatusText(
            response.providerError
              ? `Fallback shell ready for ${response.state.metadata.name}.`
              : `${response.state.files.length} files updated in ${response.state.metadata.name}.`
          )
          if (!activeSessionId) {
            persistSession(
              preserveUserMessage
                ? [
                    {
                      id: `user-${makeId()}`,
                      role: 'user',
                      content: trimmed,
                      timestamp: new Date()
                    },
                    {
                      id: `assistant-${makeId()}`,
                      role: 'assistant',
                      content: `Applied changes with **${providerDisplayName(
                        response.state.metadata.providerUsed || providerChoice?.label || providerChoice?.provider
                      )}**.`,
                      timestamp: new Date()
                    }
                  ]
                : messages,
              response.state.metadata.id
            )
          }
          setAttachments([])
          return
        }

        setStatusText('Provider returned an error. Check the latest assistant message.')
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
        setStatusText('Builder request failed.')
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
    [activeSessionId, attachments, messages, persistSession, providerOptions, selectedModel, sending, syncProjectState]
  )

  const applyWindowPayload = useCallback(
    async (payload?: WindowPayload) => {
      if (!payload) return

      if (payload.state) {
        syncProjectState(payload.state, payload.previewHtml, payload.prompt, payload.providerError)
        return
      }

      if (payload.autoStart && payload.prompt) {
        const autoKey = JSON.stringify({
          prompt: payload.prompt,
          provider: payload.selectedProvider || selectedModel
        })

        if (lastAutoRunKeyRef.current !== autoKey) {
          lastAutoRunKeyRef.current = autoKey
          await submitPrompt({
            prompt: payload.prompt,
            providerId: payload.selectedProvider || selectedModel,
            preserveUserMessage: false
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

  const handleOpenProjectFolder = async () => {
    if (!projectState?.metadata.id) {
      emitBuilderToast('error', 'No project available yet.')
      return
    }
    const response = await openBuilderProjectFolder(projectState.metadata.id)
    if (!response.success) {
      emitBuilderToast('error', response.error || 'Open folder failed.')
    }
  }

  const handleOpenProjectInVsCode = async () => {
    if (!projectState?.metadata.id) {
      emitBuilderToast('error', 'No project available yet.')
      return
    }
    const response = await openBuilderProjectInVsCode(projectState.metadata.id)
    if (!response.success) {
      emitBuilderToast('error', response.error || 'Open in VS Code failed.')
    }
  }

  const handleCopyProjectPath = async () => {
    if (!projectState?.metadata.id) {
      emitBuilderToast('error', 'No project available yet.')
      return
    }
    const response = await copyBuilderProjectPath(projectState.metadata.id)
    if (response.success && response.projectPath) {
      await navigator.clipboard.writeText(response.projectPath)
      emitBuilderToast('success', 'Project path copied.')
      return
    }
    emitBuilderToast('error', response.error || 'Copy path failed.')
  }

  const handleNewChat = () => {
    const hasContext = messages.length > 0 || input.trim().length > 0 || attachments.length > 0
    if (hasContext) {
      const confirmed = window.confirm('Start a new Builder chat? Project files will stay the same.')
      if (!confirmed) return
    }
    setSidebarMenuOpen(false)
    setSidebarMenuSection(null)
    setMessages([])
    setInput('')
    setAttachments([])
    setActiveSessionId(`session-${makeId()}`)
    setStatusText('Started a new chat.')
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

  const currentModelLabel =
    providerOptions.find((option) => option.id === selectedModel)?.label || 'Kilo Gateway / laguna-m.1:free'

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
        <div className="glass-panel flex shrink-0 flex-col bg-card" style={{ width: panelWidth }}>
          <div className="relative flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-sky-400" />
              <span className="text-sm font-semibold tracking-tight text-foreground">Agent</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="field-shell max-w-[124px] truncate rounded-full px-2 py-1 font-mono text-[9.5px] text-muted-foreground">
                {currentModelLabel}
              </span>
              <button
                ref={sidebarMenuButtonRef}
                onClick={() => {
                  setSidebarMenuOpen((value) => !value)
                  setSidebarMenuSection(null)
                }}
                className="premium-button flex h-6.5 w-6.5 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-white"
                aria-label="Open Builder agent menu"
              >
                <MoreHorizontal size={12} />
              </button>
            </div>

            {sidebarMenuOpen && (
              <div
                ref={sidebarMenuRef}
                className="menu-surface absolute right-3 top-[calc(100%-6px)] z-50 w-[260px] rounded-2xl p-2 text-xs shadow-2xl"
              >
                <div className="space-y-1">
                  <button
                    onClick={handleNewChat}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-foreground transition-colors hover:bg-white/5"
                  >
                    <span>New chat</span>
                    <span className="text-[10px] text-muted-foreground">Clear thread</span>
                  </button>
                  <button
                    onClick={() => setSidebarMenuSection((current) => (current === 'project' ? null : 'project'))}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-foreground transition-colors hover:bg-white/5"
                  >
                    <span>Project</span>
                    <ChevronDown size={12} className={`transition-transform ${sidebarMenuSection === 'project' ? 'rotate-180' : ''}`} />
                  </button>
                  {sidebarMenuSection === 'project' && (
                    <div className="space-y-1 px-2 pb-1">
                      <button onClick={handleOpenProjectFolder} className="flex w-full rounded-lg px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-white/5 hover:text-white">Open folder</button>
                      <button onClick={handleOpenProjectInVsCode} className="flex w-full rounded-lg px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-white/5 hover:text-white">Open in VS Code</button>
                      <button onClick={handleCopyProjectPath} className="flex w-full rounded-lg px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-white/5 hover:text-white">Copy path</button>
                      <button onClick={handleZipDownload} className="flex w-full rounded-lg px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-white/5 hover:text-white">Download ZIP</button>
                    </div>
                  )}
                  <button
                    onClick={() => setSidebarMenuSection((current) => (current === 'more' ? null : 'more'))}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-foreground transition-colors hover:bg-white/5"
                  >
                    <span>More</span>
                    <ChevronDown size={12} className={`transition-transform ${sidebarMenuSection === 'more' ? 'rotate-180' : ''}`} />
                  </button>
                  {sidebarMenuSection === 'more' && (
                    <div className="space-y-1 px-2 pb-1">
                      <button onClick={() => { void loadStatuses(); setStatusText('Model statuses refreshed.'); setSidebarMenuOpen(false) }} className="flex w-full rounded-lg px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-white/5 hover:text-white">Refresh models</button>
                      <button onClick={() => { handleOpenInWindow(); setSidebarMenuOpen(false) }} className="flex w-full rounded-lg px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-white/5 hover:text-white">Open current panel</button>
                    </div>
                  )}
                  <div className="pt-2">
                    <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.24em] text-muted-foreground/60">
                      Recent chats
                    </div>
                    <div className="space-y-1">
                      {recentSessions.length ? (
                        recentSessions.map((session) => (
                          <button
                            key={session.id}
                            onClick={() => {
                              setSidebarMenuOpen(false)
                              void loadSessionById(session.id)
                            }}
                            className={`flex w-full flex-col rounded-xl px-3 py-2 text-left transition-colors ${
                              session.id === activeSessionId ? 'bg-white/6 text-white' : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <span className="truncate text-xs">{session.title}</span>
                            <span className="text-[10px] opacity-60">
                              {new Date(session.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-[11px] text-muted-foreground/70">No saved Builder chats yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
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
              <div className="flex gap-2">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/8 bg-[#232326] text-zinc-300">
                  <Bot size={9} />
                </div>
                <div className="accent-status flex items-center gap-2 rounded-2xl rounded-tl-md px-3 py-1.5">
                  <Loader2 size={10} className="animate-spin text-cyan-300" />
                  <span className="text-[11px] text-muted-foreground">{statusText}</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t border-border px-3 py-3">
            <div className="codex-input-shell rounded-xl transition-all focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
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
                className="w-full min-h-[64px] resize-none bg-transparent px-3.5 pb-1 pt-2.5 text-[11.5px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/50"
                style={{ scrollbarWidth: 'none' }}
              />
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 px-3 pb-2.5 pt-1">
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    onClick={handlePickAttachment}
                    className="minimal-control flex h-6 w-6 items-center justify-center rounded-md"
                    aria-label="Add attachment"
                    title={attachments.length ? `${attachments.length} attachment(s) selected` : 'Add attachment'}
                  >
                    <Plus size={10} />
                  </button>
                  <AccessMenu value={permissionMode} onChange={setPermissionMode} />
                </div>

                <div className="flex min-w-0 items-center justify-end overflow-hidden">
                  <ModelSelector
                    value={selectedModel}
                    onChange={setSelectedModel}
                    options={providerOptions}
                    onAddCustom={handleAddCustomModel}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="flex h-6.5 w-6.5 items-center justify-center rounded-full bg-[#2f81f7] text-white shadow-[0_8px_18px_rgba(47,129,247,0.16)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Send builder prompt"
                >
                  {sending ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                </button>
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

        <div className="glass-panel flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-[linear-gradient(180deg,rgba(26,26,29,0.98),rgba(21,21,24,0.98))] px-3.5 py-1.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-md border border-white/6 bg-black/10 p-0.5">
              {(['preview', 'code'] as RightPanel[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPanel(mode)}
                  className={`flex items-center gap-1 rounded-md px-1.5 py-[4px] text-[10.5px] font-medium transition-all ${
                    panel === mode
                      ? 'minimal-control minimal-control-active'
                      : 'minimal-control minimal-control-ghost hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  {mode === 'preview' ? <Eye size={11} /> : <Code2 size={11} />}
                  <span className="capitalize">{mode}</span>
                </button>
              ))}
            </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-white">
                  {projectState?.metadata.name || 'Blank workspace'}
                </div>
                <div className="truncate text-[10px] text-zinc-500">
                  {providerDisplayName(projectState?.metadata.providerUsed || selectedModel)} · {projectState?.files.length || 0} files
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleOpenInWindow}
                title="Open in window"
                className="minimal-control flex h-6 w-6 items-center justify-center rounded-md"
              >
                <ExternalLink size={10} />
              </button>

              {panel === 'code' && (
                <button
                  onClick={handleCopy}
                  className="minimal-control flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium"
                >
                  {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              )}

              <button
                onClick={handleZipDownload}
                className="minimal-control flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium text-foreground"
              >
                <Download size={10} />
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


