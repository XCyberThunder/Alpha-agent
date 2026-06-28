import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import {
  ArrowUp,
  Bot,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileImage,
  FileJson2,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderTree,
  FolderUp,
  Laptop,
  LayoutGrid,
  MessageSquare,
  MonitorSmartphone,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Smartphone,
  Terminal,
  Upload,
  X
} from 'lucide-react'
import {
  closeBuilderWindow,
  type BuilderProjectFile,
  type BuilderProjectState,
  type BuilderAttachmentDescriptor,
  copyBuilderProjectPath,
  createBuilderProject,
  exportBuilderProjectZip,
  getBuilderModelStatuses,
  getBuilderWindowState,
  openBuilderProjectFolder,
  openBuilderProjectInVsCode,
  pickBuilderAttachments,
  readBuilderProject,
  runBuilderProjectCommand,
  saveBuilderProjectFile,
  saveBuilderModelSlot,
  stopBuilderProjectCommand,
  setBuilderModelEnabled,
  testBuilderModelSlot,
  updateBuilderProject
} from '@renderer/services/project-builder'

type BuilderPayload = {
  state?: BuilderProjectState
  previewHtml?: string
  prompt?: string
  providerError?: string
  autoStart?: boolean
  selectedProvider?: string
}

type BuilderMode = 'preview' | 'code' | 'split' | 'visual'
type DeviceMode = 'desktop' | 'tablet' | 'mobile'
type PermissionMode = 'ask' | 'safe' | 'full'
type ChatMessageRole = 'user' | 'assistant' | 'system'
type ModelProvider = 'auto' | 'glm' | 'zai' | 'gemini' | 'openrouter' | 'kimi' | 'groq'

type ChatMessage = {
  id: string
  role: ChatMessageRole
  text: string
}

type AttachmentItem = {
  id: string
  name: string
  kind: 'image' | 'file' | 'folder'
  size: number
  path?: string
  fileCount?: number
  previewUrl?: string
  content?: string
  skippedCount?: number
}

type FileTreeNode = {
  id: string
  name: string
  path: string
  kind: 'file' | 'folder'
  children: FileTreeNode[]
}

type EditableTextNode = {
  id: string
  tag: string
  text: string
}

type ModelOption = {
  provider: ModelProvider
  label: string
  model: string
  configured: boolean
  status: string
  priorityLabel?: string
}

type AddModelDraft = {
  group: 'glm' | 'zai' | 'geminiBrain' | 'kimi' | 'openrouter' | 'groq'
  slot: 1 | 2 | 3
  apiKey: string
  baseUrl: string
  modelId: string
  providerMode: string
  enabled: boolean
}

type PendingApproval =
  | { type: 'command'; command: string }
  | { type: 'agent-edit'; prompt: string }

type ModeButtonMeta = {
  value: BuilderMode
  label: string
  icon: ReactNode
}

const deviceWidths: Record<DeviceMode, string> = {
  desktop: '100%',
  tablet: '860px',
  mobile: '430px'
}

const defaultAddModelDraft = (): AddModelDraft => ({
  group: 'zai',
  slot: 1,
  apiKey: '',
  baseUrl: 'https://api.z.ai/api/coding/paas/v4',
  modelId: 'glm-4.5v',
  providerMode: 'zai-coding',
  enabled: true
})

const buildLoaderCss = `
.csse-bounce-dots { display:flex; gap:10px; align-items:center; }
.csse-bounce-dots span { width:12px; height:12px; border-radius:50%; background:#f472b6; animation:csse-bounce-dots 1.2s ease-in-out infinite; }
.csse-bounce-dots span:nth-child(2) { background:#8b5cf6; animation-delay:0.18s; }
.csse-bounce-dots span:nth-child(3) { background:#22d3ee; animation-delay:0.36s; }
@keyframes csse-bounce-dots {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.48; }
  40% { transform: translateY(-14px); opacity: 1; }
}
`
const DRAFT_STORAGE_KEY = 'alpha_builder_window_draft'
const isDev = import.meta.env.DEV

const debugBuilder = (...args: unknown[]) => {
  if (isDev) {
    console.debug('[builderwindow]', ...args)
  }
}

const languageForFile = (filePath: string) => {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.html')) return 'html'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.c')) return 'c'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) return 'cpp'
  return 'plaintext'
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const safeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const previewFriendlyFile = (files: BuilderProjectFile[]) =>
  files.find((file) => file.path === 'index.html') ||
  files.find((file) => file.path.endsWith('/index.html')) ||
  null

const inlinePreviewFromFiles = (files: BuilderProjectFile[]) => {
  const htmlFile = previewFriendlyFile(files)
  if (!htmlFile) return ''

  let html = htmlFile.content
  const cssFile = files.find((file) => file.path === 'style.css' || file.path.endsWith('/style.css'))
  const jsFile = files.find((file) => file.path === 'script.js' || file.path.endsWith('/script.js'))

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

const extractEditableTextNodes = (html: string): EditableTextNode[] => {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const nodes = Array.from(doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,button,a,span,li'))
  return nodes
    .map((node, index) => ({
      id: `${node.tagName.toLowerCase()}-${index}`,
      tag: node.tagName.toLowerCase(),
      text: (node.textContent || '').trim()
    }))
    .filter((node) => node.text.length > 0)
    .slice(0, 32)
}

const applyVisualEditsToHtml = (html: string, edits: EditableTextNode[]) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const nodes = Array.from(doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,button,a,span,li'))
  edits.forEach((edit, index) => {
    const node = nodes[index]
    if (node) node.textContent = edit.text
  })
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}

const isTextFile = (name: string) =>
  /\.(txt|md|json|html|css|js|ts|tsx|py|java|c|cpp|jsx|yml|yaml)$/i.test(name)

const formatBytes = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 100 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

const buildFileTree = (files: BuilderProjectFile[]): FileTreeNode[] => {
  const root: FileTreeNode[] = []
  const folderMap = new Map<string, FileTreeNode>()

  const ensureFolder = (folderPath: string) => {
    if (!folderPath) return root
    if (folderMap.has(folderPath)) return folderMap.get(folderPath)!.children

    const segments = folderPath.split('/').filter(Boolean)
    let currentPath = ''
    let currentLevel = root

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      let existing = folderMap.get(currentPath)
      if (!existing) {
        existing = {
          id: `folder-${currentPath}`,
          name: segment,
          path: currentPath,
          kind: 'folder',
          children: []
        }
        currentLevel.push(existing)
        folderMap.set(currentPath, existing)
      }
      currentLevel = existing.children
    }

    return currentLevel
  }

  files.forEach((file) => {
    const parts = file.path.split('/').filter(Boolean)
    const fileName = parts.pop() || file.path
    const parentLevel = ensureFolder(parts.join('/'))
    parentLevel.push({
      id: `file-${file.path}`,
      name: fileName,
      path: file.path,
      kind: 'file',
      children: []
    })
  })

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    nodes.forEach((node) => sortNodes(node.children))
    return nodes
  }

  return sortNodes(root)
}

const getFileIcon = (targetPath: string) => {
  const lower = targetPath.toLowerCase()
  if (lower.endsWith('.json')) return <FileJson2 className="h-3.5 w-3.5" />
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return <FileText className="h-3.5 w-3.5" />
  if (/\.(html|css|js|jsx|ts|tsx|py|java|c|cpp|cc|cxx)$/i.test(lower)) {
    return <FileCode2 className="h-3.5 w-3.5" />
  }
  return <FileText className="h-3.5 w-3.5" />
}

const attachmentFromDescriptor = (item: BuilderAttachmentDescriptor): AttachmentItem => ({
  id: item.id,
  name: item.name,
  path: item.path,
  kind: item.kind,
  size: item.size,
  fileCount: item.fileCount,
  previewUrl: item.previewUrl,
  content: item.content,
  skippedCount: item.skippedCount
})

const summarizeAttachments = (attachments: AttachmentItem[]) =>
  attachments
    .map((item) => {
      const header = `${item.kind.toUpperCase()}: ${item.name}`
      if (item.content) return `${header}\n${item.content.slice(0, 7000)}`
      if (item.fileCount) return `${header}\nContains ${item.fileCount} files`
      return header
    })
    .join('\n\n')

const LoaderLabel = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 text-sm text-[#4b5563]">
    <div className="csse-bounce-dots">
      <span />
      <span />
      <span />
    </div>
    <span>{label}</span>
  </div>
)

export default function BuilderWindow() {
  const monaco = useMonaco()
  const [projectState, setProjectState] = useState<BuilderProjectState | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'editing' | 'saved' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('Start by describing what you want to build.')
  const [providerError, setProviderError] = useState('')
  const [mode, setMode] = useState<BuilderMode>('split')
  const [device, setDevice] = useState<DeviceMode>('desktop')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask')
  const [selectedModel, setSelectedModel] = useState<ModelProvider>('auto')
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [editableTexts, setEditableTexts] = useState<EditableTextNode[]>([])
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [terminalOutput, setTerminalOutput] = useState<string[]>([])
  const [terminalCommand, setTerminalCommand] = useState('npm run build')
  const [terminalHistory, setTerminalHistory] = useState<string[]>([])
  const [runningCommand, setRunningCommand] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [pendingFallbackPrompt, setPendingFallbackPrompt] = useState<string | null>(null)
  const [showModelModal, setShowModelModal] = useState(false)
  const [addModelDraft, setAddModelDraft] = useState<AddModelDraft>(defaultAddModelDraft)
  const [addModelMessage, setAddModelMessage] = useState('')
  const [activeSidebarTab, setActiveSidebarTab] = useState<'chat' | 'agent'>('chat')
  const consumedPromptRef = useRef<string>('')
  const terminalPanelRef = useRef<HTMLDivElement | null>(null)
  const filePanelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!monaco) return
    monaco.editor.defineTheme('alpha-builder-window', {
      base: 'vs-dark',
      inherit: true,
      rules: [{ token: 'comment', foreground: '7c3aed', fontStyle: 'italic' }],
      colors: {
        'editor.background': '#0b0e14',
        'editorLineNumber.foreground': '#465065',
        'editor.lineHighlightBackground': '#111622',
        'editorCursor.foreground': '#f9fafb',
        'editor.selectionBackground': '#1f293780'
      }
    })
    monaco.editor.setTheme('alpha-builder-window')
  }, [monaco])

  const refreshModelOptions = async () => {
    const response = await getBuilderModelStatuses()
    const statuses = response?.statuses || {}
    const options: ModelOption[] = [
      {
        provider: 'auto',
        label: 'Auto Priority',
        model: 'GLM -> Z.AI -> fallback',
        configured: true,
        status: 'ready',
        priorityLabel: 'default'
      }
    ]

    const resolveSlot = (group: string) =>
      (statuses[group] || []).find((item: any) => item.enabled && item.hasKey)

    const providerRows: Array<[ModelProvider, string, string, string]> = [
      ['glm', 'GLM', 'primary', resolveSlot('glm')?.modelId || 'glm'],
      ['zai', 'Z.AI', 'secondary', resolveSlot('zai')?.modelId || 'zai'],
      ['gemini', 'Gemini', 'fallback', resolveSlot('geminiBrain')?.maskedKey || 'gemini'],
      ['openrouter', 'OpenRouter', 'fallback', response?.openrouterModel || 'openrouter'],
      ['kimi', 'Kimi', 'fallback', resolveSlot('kimi')?.modelId || 'kimi'],
      ['groq', 'Groq', 'fallback', resolveSlot('groq')?.modelId || 'groq']
    ]

    providerRows.forEach(([provider, label, priorityLabel, model]) => {
      const group = provider === 'gemini' ? 'geminiBrain' : provider
      const found = resolveSlot(group)
      options.push({
        provider,
        label,
        model: String(model || provider),
        configured: Boolean(found),
        status: found?.status || 'missing',
        priorityLabel
      })
    })

    setModelOptions(options)
  }

  useEffect(() => {
    void refreshModelOptions()
  }, [])

  useEffect(() => {
    try {
      const rawDraft = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (!rawDraft) return
      const draft = JSON.parse(rawDraft) as {
        chatInput?: string
        mode?: BuilderMode
        selectedModel?: ModelProvider
        permissionMode?: PermissionMode
        statusMessage?: string
      }
      if (draft.chatInput) setChatInput(draft.chatInput)
      if (draft.mode) setMode(draft.mode)
      if (draft.selectedModel) setSelectedModel(draft.selectedModel)
      if (draft.permissionMode) setPermissionMode(draft.permissionMode)
      if (draft.statusMessage) setStatusMessage(draft.statusMessage)
    } catch (error) {
      debugBuilder('draft-load-failed', error)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          chatInput,
          mode,
          selectedModel,
          permissionMode,
          statusMessage,
          lastOutput: chatMessages.at(-1)?.text || '',
          updatedAt: new Date().toISOString()
        })
      )
    } catch (error) {
      debugBuilder('draft-save-failed', error)
    }
  }, [chatInput, mode, selectedModel, permissionMode, statusMessage, chatMessages])

  const applyIncomingPayload = (payload?: BuilderPayload | null) => {
    if (!payload) return
    debugBuilder('incoming-payload', payload)

    if (payload.selectedProvider && payload.selectedProvider !== 'auto') {
      setSelectedModel(payload.selectedProvider as ModelProvider)
    }

    if (payload.state) {
      const state = payload.state
      setProjectState(state)
      setPreviewHtml(payload.previewHtml || '')
      setSelectedFile(state.files[0]?.path || '')
      setStatus(payload.providerError ? 'error' : 'saved')
      setProviderError(payload.providerError || '')
      setStatusMessage(payload.providerError || `Project loaded: ${state.metadata.name}`)
      setChatMessages((prev) =>
        prev.length
          ? prev
          : [
              {
                id: safeId(),
                role: 'assistant',
                text: payload.providerError
                  ? `Builder shell ready. ${payload.providerError}`
                  : `Project loaded with ${state.metadata.providerUsed || state.metadata.modelUsed}.`
              }
            ]
      )
      return
    }

    if (payload.prompt && payload.autoStart && consumedPromptRef.current !== payload.prompt) {
      consumedPromptRef.current = payload.prompt
      setProjectState(null)
      setPreviewHtml('')
      setSelectedFile('')
      setDraftContent('')
      setProviderError('')
      setStatus('idle')
      setStatusMessage('Builder open hai. Prompt receive ho gaya.')
      setChatMessages([{ id: safeId(), role: 'user', text: payload.prompt }])
      void runProjectWorkflow(payload.prompt, payload.selectedProvider as ModelProvider | undefined, true)
    }
  }

  useEffect(() => {
    getBuilderWindowState().then((res) => applyIncomingPayload(res?.payload))
    const listener = (_event: unknown, payload: BuilderPayload) => applyIncomingPayload(payload)
    window.electron.ipcRenderer.on('builder-window-state', listener)
    return () => {
      window.electron.ipcRenderer.removeListener('builder-window-state', listener)
    }
  }, [])

  useEffect(() => {
    const listener = (_event: unknown, payload: any) => {
      if (!projectState || payload?.projectId !== projectState.metadata.id) return
      if (payload.type === 'start') {
        setRunningCommand(true)
        setTerminalOutput((prev) => [...prev, `$ ${payload.command}`])
      } else if (payload.type === 'stdout' || payload.type === 'stderr') {
        setTerminalOutput((prev) => [...prev, String(payload.chunk || '')])
      } else if (payload.type === 'exit') {
        setRunningCommand(false)
        setTerminalOutput((prev) => [...prev, `\n[exit ${payload.exitCode ?? 0}]`])
      } else if (payload.type === 'stopped') {
        setRunningCommand(false)
        setTerminalOutput((prev) => [...prev, '\n[stopped]'])
      }
    }

    window.electron.ipcRenderer.on('builder-terminal-event', listener)
    return () => {
      window.electron.ipcRenderer.removeListener('builder-terminal-event', listener)
    }
  }, [projectState])

  useEffect(() => {
    const file = projectState?.files.find((item) => item.path === selectedFile)
    setDraftContent(file?.content || '')
  }, [projectState, selectedFile])

  useEffect(() => {
    const html = previewHtml || inlinePreviewFromFiles(projectState?.files || [])
    setEditableTexts(extractEditableTextNodes(html))
  }, [previewHtml, projectState])

  const previewSource = useMemo(
    () => previewHtml || inlinePreviewFromFiles(projectState?.files || []),
    [previewHtml, projectState]
  )

  const currentProvider = useMemo<ModelProvider>(() => {
    const used = (projectState?.metadata.providerUsed || '').toLowerCase()
    if (used.includes('z.ai')) return 'zai'
    if (used.includes('gemini')) return 'gemini'
    if (used.includes('openrouter')) return 'openrouter'
    if (used.includes('kimi')) return 'kimi'
    if (used.includes('groq')) return 'groq'
    if (used.includes('glm')) return 'glm'
    return selectedModel
  }, [projectState, selectedModel])

  const progressivelyApplyProjectState = async (
    nextState: BuilderProjectState,
    nextPreviewHtml: string,
    loadingLabel: string
  ) => {
    setStatus('generating')
    setStatusMessage(loadingLabel)

    const partialState: BuilderProjectState = {
      metadata: nextState.metadata,
      files: []
    }

    setProjectState(partialState)
    setSelectedFile(nextState.files[0]?.path || '')
    setPreviewHtml('')

    for (const file of nextState.files) {
      partialState.files = [...partialState.files, file]
      setProjectState({
        metadata: nextState.metadata,
        files: [...partialState.files]
      })
      setSelectedFile((current) => current || file.path)
      setPreviewHtml(inlinePreviewFromFiles(partialState.files))
      setStatusMessage(`Writing ${file.path}...`)
      await sleep(220)
    }

    setProjectState(nextState)
    setPreviewHtml(nextPreviewHtml || inlinePreviewFromFiles(nextState.files))
    setStatus('saved')
    setStatusMessage('Project files ready.')
  }

  const resolveProviderForPrompt = (providerOverride?: ModelProvider) => {
    const target = providerOverride || selectedModel
    if (target === 'auto') return 'glm'
    return target
  }

  const buildPromptWithAttachments = (prompt: string) => {
    if (!attachments.length) return prompt
    return `${prompt}\n\nAttached context:\n${summarizeAttachments(attachments)}`
  }

  const runProjectWorkflow = async (
    prompt: string,
    providerOverride?: ModelProvider,
    isInitialHandoff = false
  ) => {
    const provider = resolveProviderForPrompt(providerOverride)
    const fullPrompt = buildPromptWithAttachments(prompt)
    setIsBusy(true)
    setProviderError('')
    setPendingFallbackPrompt(null)
    setStatus('generating')
    setStatusMessage('Waiting for model...')

    try {
      const response = projectState?.metadata.id
        ? await updateBuilderProject(projectState.metadata.id, fullPrompt, provider)
        : await createBuilderProject(fullPrompt, provider)

      if (response.success && response.state) {
        await progressivelyApplyProjectState(response.state, response.previewHtml || '', 'Generating files')

        if (response.providerError) {
          const fallbackMessage = response.providerError || 'Selected provider failed.'
          setProviderError(response.providerError)
          setPendingFallbackPrompt(prompt)
          setChatMessages((prev) => [...prev, { id: safeId(), role: 'assistant', text: fallbackMessage }])
        } else {
          setChatMessages((prev) => [
            ...prev,
            {
              id: safeId(),
              role: 'assistant',
              text: isInitialHandoff
                ? 'Prompt receive ho gaya. Coding Agent ne project generation start kar diya hai.'
                : 'Project files update ho gaye.'
            }
          ])
        }
      } else {
        const failure = response.error || response.message || 'Project generation failed.'
        setStatus('error')
        setStatusMessage(failure)
        setProviderError(failure)
        setPendingFallbackPrompt(prompt)
        setChatMessages((prev) => [...prev, { id: safeId(), role: 'assistant', text: failure }])
      }
    } finally {
      setIsBusy(false)
    }
  }

  const handleAgentPrompt = async (prompt: string, skipApproval = false) => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    debugBuilder('agent-prompt', { trimmed, skipApproval })

    if (!skipApproval && permissionMode === 'ask' && projectState) {
      setPendingApproval({ type: 'agent-edit', prompt: trimmed })
      setChatMessages((prev) => [
        ...prev,
        {
          id: safeId(),
          role: 'system',
          text: `Approval required: "${trimmed}" current project par apply karna hai?`
        }
      ])
      return
    }

    setChatMessages((prev) => [...prev, { id: safeId(), role: 'user', text: trimmed }])
    await runProjectWorkflow(trimmed, undefined, false)
    setChatInput('')
  }

  const handleFallbackChoice = async (provider: Exclude<ModelProvider, 'auto' | 'glm' | 'zai'>) => {
    if (!pendingFallbackPrompt) return
    setSelectedModel(provider)
    setPendingFallbackPrompt(null)
    await runProjectWorkflow(pendingFallbackPrompt, provider, false)
  }

  const persistFile = async (filePath: string, content: string) => {
    if (!projectState) return
    setIsBusy(true)
    setStatus('editing')
    setStatusMessage(`Saving ${filePath}...`)
    try {
      const response = await saveBuilderProjectFile(projectState.metadata.id, filePath, content)
      if (response.success && response.state) {
        setProjectState(response.state)
        setPreviewHtml(response.previewHtml || '')
        setStatus('saved')
        setStatusMessage(`Saved ${filePath}.`)
      } else {
        setStatus('error')
        setStatusMessage(response.error || 'Save failed.')
      }
    } finally {
      setIsBusy(false)
    }
  }

  const handleVisualSave = async () => {
    const htmlFile =
      projectState?.files.find((file) => file.path === 'index.html') ||
      projectState?.files.find((file) => file.path.endsWith('/index.html'))
    if (!htmlFile) return
    await persistFile(htmlFile.path, applyVisualEditsToHtml(htmlFile.content, editableTexts))
  }

  const refreshProject = async () => {
    if (!projectState?.metadata.id) return
    setIsBusy(true)
    setStatusMessage('Refreshing preview...')
    try {
      const response = await readBuilderProject(projectState.metadata.id)
      if (response.success && response.state) {
        setProjectState(response.state)
        setPreviewHtml(response.previewHtml || '')
        setStatus('saved')
        setStatusMessage('Project refreshed.')
      } else {
        setStatus('error')
        setStatusMessage(response.error || 'Project refresh failed.')
      }
    } finally {
      setIsBusy(false)
    }
  }

  const runTerminalCommand = async (command: string) => {
    if (!projectState?.metadata.id) {
      setStatusMessage('Pehle project generate karo.')
      return
    }
    const trimmed = command.trim()
    if (!trimmed) return

    const isRiskyCommand = /\bnpm\s+(install|i)|yarn\s+install|pnpm\s+install|bun\s+install|npm\s+run\s+(dev|build)\b/i.test(trimmed)
    const needsApproval = permissionMode === 'ask' || (permissionMode === 'safe' && isRiskyCommand)
    if (needsApproval) {
      setPendingApproval({ type: 'command', command: trimmed })
      setStatusMessage(`Approval required before running: ${trimmed}`)
      return
    }

    const response = await runBuilderProjectCommand(projectState.metadata.id, trimmed)
    if (response.success) {
      setTerminalHistory((prev) => [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 12))
      setTerminalCommand(trimmed)
    } else {
      setTerminalOutput((prev) => [...prev, response.error || 'Command start failed.'])
    }
  }

  const stopTerminalCommand = async () => {
    if (!projectState?.metadata.id) return
    await stopBuilderProjectCommand(projectState.metadata.id)
  }

  const handlePickAttachments = async (kind: AttachmentItem['kind']) => {
    const response = await pickBuilderAttachments(kind)
    if (!response.success) {
      setStatusMessage(response.error || 'Attachment pick failed.')
      debugBuilder('attachment-pick-failed', response.error)
      return
    }
    if (response.cancelled || !response.attachments?.length) return
    setAttachments((prev) => [...prev, ...response.attachments!.map(attachmentFromDescriptor)])
    setStatusMessage(
      kind === 'folder'
        ? `Folder attached (${response.attachments[0]?.fileCount || 0} files).`
        : `${response.attachments.length} attachment${response.attachments.length > 1 ? 's' : ''} added.`
    )
  }

  const openPreviewWindow = () => {
    if (!previewSource) return
    const win = window.open('', '_blank', 'width=1280,height=860')
    if (!win) return
    win.document.open()
    win.document.write(previewSource)
    win.document.close()
  }

  const handleTopAction = async (action: () => Promise<void> | void, busyLabel?: string) => {
    if (busyLabel) {
      setIsBusy(true)
      setStatusMessage(busyLabel)
    }
    try {
      await action()
    } finally {
      if (busyLabel) setIsBusy(false)
    }
  }

  const handleSidebarAction = (action: 'chat' | 'agent' | 'files' | 'terminal' | 'models') => {
    if (action === 'chat' || action === 'agent') {
      setActiveSidebarTab(action)
      setStatusMessage(action === 'chat' ? 'Project chat ready.' : 'Coding agent controls ready.')
      return
    }
    if (action === 'files') {
      setMode((current) => (current === 'preview' ? 'split' : current))
      filePanelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setStatusMessage('Project file tree focused.')
      return
    }
    if (action === 'terminal') {
      terminalPanelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setStatusMessage('Terminal panel focused.')
      return
    }
    setShowModelModal(true)
    setStatusMessage('Model configuration open hai.')
  }

  const saveModelDraft = async () => {
    const result = await saveBuilderModelSlot({
      group: addModelDraft.group,
      slot: addModelDraft.slot,
      key: addModelDraft.apiKey,
      baseUrl: addModelDraft.baseUrl,
      modelId: addModelDraft.modelId,
      providerMode: addModelDraft.providerMode
    })
    if (result?.success) {
      if (!addModelDraft.enabled) {
        await setBuilderModelEnabled({
          group: addModelDraft.group,
          slot: addModelDraft.slot,
          enabled: false
        })
      }
      setAddModelMessage('Model saved securely.')
      await refreshModelOptions()
    } else {
      setAddModelMessage(result?.error || 'Model save failed.')
    }
  }

  const testModelDraft = async () => {
    const result = await testBuilderModelSlot({
      group: addModelDraft.group,
      slot: addModelDraft.slot
    })
    setAddModelMessage(result?.success ? 'Model test passed.' : result?.error || 'Model test failed.')
    await refreshModelOptions()
  }

  const approvePendingAction = async () => {
    const current = pendingApproval
    setPendingApproval(null)
    if (!current) return
    if (current.type === 'command') {
      await runTerminalCommand(current.command)
      return
    }
    await handleAgentPrompt(current.prompt, true)
  }

  const activeFiles = projectState?.files || []
  const fileTree = useMemo(() => buildFileTree(activeFiles), [activeFiles])
  const selectedFileEntry = activeFiles.find((item) => item.path === selectedFile) || null
  const selectedFileDirty = Boolean(selectedFileEntry && selectedFileEntry.content !== draftContent)
  const currentModelLabel =
    modelOptions.find((option) => option.provider === currentProvider)?.label ||
    modelOptions.find((option) => option.provider === selectedModel)?.label ||
    'Auto Priority'
  const currentModelName =
    modelOptions.find((option) => option.provider === currentProvider)?.model ||
    modelOptions.find((option) => option.provider === selectedModel)?.model ||
    'GLM -> Z.AI -> fallback'
  const totalFiles = activeFiles.length
  const emptyState = !projectState && !isBusy && !chatMessages.length
  const showPreview = mode === 'preview' || mode === 'split' || mode === 'visual'
  const showCode = mode === 'code' || mode === 'split'
  const showVisual = mode === 'visual'
  const latestUserPrompt =
    [...chatMessages].reverse().find((message) => message.role === 'user')?.text || 'Start a new website brief'
  const projectDisplayName = projectState?.metadata.name || 'Untitled workspace'
  const workspacePath = projectState?.metadata.projectPath || '/workspace'
  const currentModelStatus =
    modelOptions.find((option) => option.provider === currentProvider)?.status ||
    modelOptions.find((option) => option.provider === selectedModel)?.status ||
    'ready'

  const modeButtons: ModeButtonMeta[] = [
    { value: 'preview', label: 'Preview', icon: <Eye className="h-3.5 w-3.5" /> },
    { value: 'code', label: 'Code', icon: <Code2 className="h-3.5 w-3.5" /> },
    { value: 'split', label: 'Split', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { value: 'visual', label: 'Visual', icon: <PencilLine className="h-3.5 w-3.5" /> }
  ]

  const quickCommandButtons: Array<[string, string]> = [
    ['npm install', 'Install dependencies'],
    ['npm run build', 'Build'],
    ['npm run dev', 'Start dev server']
  ]

  const renderFileTreeNodes = (nodes: FileTreeNode[], depth = 0): ReactNode =>
    nodes.map((node) => {
      if (node.kind === 'folder') {
        return (
          <div key={node.id} className="space-y-1">
            <div
              className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] font-medium text-[#cbd5e1]"
              style={{ paddingLeft: `${10 + depth * 14}px` }}
            >
              {depth === 0 ? (
                <FolderOpen className="h-3.5 w-3.5 text-amber-300" />
              ) : (
                <Folder className="h-3.5 w-3.5 text-amber-300/80" />
              )}
              <span className="truncate">{node.name}</span>
            </div>
            <div className="space-y-1">{renderFileTreeNodes(node.children, depth + 1)}</div>
          </div>
        )
      }

      const isActive = selectedFile === node.path
      return (
        <button
          key={node.id}
          onClick={() => setSelectedFile(node.path)}
          className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] transition ${
            isActive
              ? 'border border-cyan-400/40 bg-[#10151f] text-white shadow-[0_0_0_1px_rgba(34,211,238,0.12)]'
              : 'border border-white/5 bg-[#12161f] text-[#c3c9d4] hover:bg-[#151b26]'
          }`}
          style={{ paddingLeft: `${10 + depth * 14}px` }}
        >
          <span className={isActive ? 'text-cyan-200' : 'text-[#94a3b8]'}>{getFileIcon(node.path)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{node.name}</div>
            <div className={`truncate text-[10px] ${isActive ? 'text-white/55' : 'text-[#70829b]'}`}>{node.path}</div>
          </div>
          {selectedFileDirty && selectedFile === node.path && (
            <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-200">
              Edited
            </span>
          )}
        </button>
      )
    })

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#06070b] text-[#f5f7fb]">
      <style>{buildLoaderCss}</style>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.045)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.2),transparent_24%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_22%),radial-gradient(circle_at_bottom,rgba(17,24,39,0.8),transparent_36%)]" />

      <div className="relative z-10 grid h-full grid-cols-[50px_352px_minmax(0,1fr)] gap-2.5 p-2.5">
        <aside className="flex h-full flex-col items-center justify-between rounded-[16px] border border-white/10 bg-[#0a0d14]/95 py-2 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <div className="flex flex-col items-center gap-3">
            <div className="grid h-[36px] w-[36px] place-items-center rounded-[12px] bg-[#111318] text-white shadow-[0_0_0_1px_rgba(34,211,238,0.18),0_8px_24px_rgba(17,19,24,0.18)]">
              <Sparkles className="h-[16px] w-[16px]" />
            </div>
            <button
              aria-label="Open builder chat"
              onClick={() => handleSidebarAction('chat')}
              className={`grid h-[36px] w-[36px] place-items-center rounded-[12px] border ${
                activeSidebarTab === 'chat'
                  ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.12)]'
                  : 'border-white/10 bg-white/5 text-[#94a3b8]'
              }`}
            >
              <MessageSquare className="h-[16px] w-[16px]" />
            </button>
            <button
              aria-label="Open coding agent"
              onClick={() => handleSidebarAction('agent')}
              className={`grid h-[36px] w-[36px] place-items-center rounded-[12px] border ${
                activeSidebarTab === 'agent'
                  ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.12)]'
                  : 'border-white/10 bg-white/5 text-[#94a3b8]'
              }`}
            >
              <Bot className="h-[16px] w-[16px]" />
            </button>
            <button
              aria-label="Focus file tree"
              onClick={() => handleSidebarAction('files')}
              className="grid h-[36px] w-[36px] place-items-center rounded-[12px] border border-white/10 bg-white/5 text-[#94a3b8]"
            >
              <FolderTree className="h-[16px] w-[16px]" />
            </button>
            <button
              aria-label="Focus terminal"
              onClick={() => handleSidebarAction('terminal')}
              className="grid h-[36px] w-[36px] place-items-center rounded-[12px] border border-white/10 bg-white/5 text-[#94a3b8]"
            >
              <Terminal className="h-[16px] w-[16px]" />
            </button>
            <button
              aria-label="Add or configure model"
              onClick={() => handleSidebarAction('models')}
              className="grid h-[36px] w-[36px] place-items-center rounded-[12px] border border-white/10 bg-white/5 text-[#94a3b8]"
            >
              <Plus className="h-[16px] w-[16px]" />
            </button>
          </div>
          <div className="flex flex-col items-center gap-3">
            <button
              aria-label="Open builder settings"
              onClick={() => setShowModelModal(true)}
              className="grid h-[36px] w-[36px] place-items-center rounded-[12px] border border-white/10 bg-white/5 text-[#94a3b8]"
            >
              <Settings2 className="h-[16px] w-[16px]" />
            </button>
            <button
              onClick={() => void closeBuilderWindow()}
              className="grid h-[36px] w-[36px] place-items-center rounded-[12px] border border-red-500/15 bg-red-500/8 text-red-300"
            >
              <X className="h-[16px] w-[16px]" />
            </button>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#0b0f1a]/96 text-[#f8fafc] shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
          <div className="border-b border-white/8 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-[12px] bg-[#111318] text-white">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#70829b]">Coding Agent</div>
                  <div className="text-sm font-medium text-white">{currentModelLabel}</div>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1 rounded-[14px] border border-white/8 bg-white/5 p-1">
              <button
                aria-label="Show chat messages"
                onClick={() => setActiveSidebarTab('chat')}
                className={`rounded-[10px] px-2.5 py-1.5 text-left text-[11px] font-medium ${
                  activeSidebarTab === 'chat' ? 'bg-cyan-400/12 text-cyan-200' : 'text-[#94a3b8]'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Chat
                </span>
              </button>
              <button
                aria-label="Show agent details"
                onClick={() => setActiveSidebarTab('agent')}
                className={`rounded-[10px] px-2.5 py-1.5 text-left text-[11px] font-medium ${
                  activeSidebarTab === 'agent' ? 'bg-cyan-400/12 text-cyan-200' : 'text-[#94a3b8]'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5" />
                  Agent
                </span>
              </button>
            </div>

            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_112px] gap-2">
              <label className="rounded-[14px] border border-white/8 bg-white/5 p-2.5 text-[11px]">
                <div className="mb-1 text-[10px] uppercase tracking-[0.22em] text-[#70829b]">Model</div>
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value as ModelProvider)}
                  className="w-full bg-transparent text-[12px] text-white outline-none"
                >
                  {modelOptions.map((option) => (
                    <option key={option.provider} value={option.provider}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => setShowModelModal(true)}
                className="rounded-[14px] border border-white/8 bg-white/5 px-2.5 py-2 text-[11px] font-medium text-[#dbe4f0]"
              >
                Add Model
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {([
                ['ask', 'Ask approval'],
                ['safe', 'Approve safe'],
                ['full', 'Project full']
              ] as Array<[PermissionMode, string]>).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setPermissionMode(value)}
                  className={`rounded-full px-2.5 py-1 text-[10px] ${
                    permissionMode === value
                      ? 'border border-cyan-400/30 bg-cyan-400/10 text-cyan-200'
                      : 'border border-white/8 bg-white/5 text-[#94a3b8]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-[16px] border border-white/8 bg-white/5 p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#70829b]">Current Task</div>
              <div className="line-clamp-3 text-[12px] leading-5 text-white">{latestUserPrompt}</div>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-[#7a8191]">
                <span className="rounded-full border border-white/8 bg-black/20 px-2 py-0.5">AI PPT</span>
                <span className="rounded-full border border-white/8 bg-black/20 px-2 py-0.5">Website</span>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {emptyState ? (
              <div className="space-y-3">
                <div className="rounded-[16px] border border-white/8 bg-white/5 p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="csse-bounce-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="text-sm text-[#94a3b8]">Describe what you want to build.</span>
                  </div>
                  <div className="space-y-2 text-[12px] text-[#b8c2d1]">
                    <p className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">simple calculator website banao</p>
                    <p className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">portfolio website with glass hero and neon cards</p>
                    <p className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">CSS effect library with live demos and code copy</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {chatMessages.map((message) => (
                  <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={`max-w-[92%] rounded-[16px] px-3 py-2.5 text-[12px] leading-5 shadow-sm ${
                        message.role === 'user'
                          ? 'bg-[#111318] text-white'
                          : message.role === 'system'
                            ? 'border border-amber-200 bg-amber-50 text-amber-900'
                            : 'border border-white/8 bg-white/5 text-[#dbe4f0]'
                      }`}
                    >
                      {message.text}
                    </div>
                  </div>
                ))}

                {isBusy && (
                  <div className="rounded-[16px] border border-white/8 bg-white/5 p-4 shadow-sm">
                    <LoaderLabel label={projectState ? 'Applying files and refreshing preview' : 'Generating workspace'} />
                  </div>
                )}

                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-2.5 py-1 text-[10px] text-[#dbe4f0]"
                      >
                        {attachment.kind === 'folder' ? (
                          <Folder className="h-3 w-3 text-amber-300" />
                        ) : attachment.kind === 'image' ? (
                          <FileImage className="h-3 w-3 text-cyan-300" />
                        ) : (
                          <FileText className="h-3 w-3 text-violet-300" />
                        )}
                        <span>
                          {attachment.name}
                          {attachment.fileCount ? ` (${attachment.fileCount} files)` : ''}
                        </span>
                        <span className="text-[#70829b]">{formatBytes(attachment.size)}</span>
                        <button
                          onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))}
                          className="rounded-full p-1 text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#111418]"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {pendingApproval && (
                <div className="rounded-[16px] border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
                    <div className="font-semibold">Approval required</div>
                    <div className="mt-2">{pendingApproval.type === 'command' ? pendingApproval.command : pendingApproval.prompt}</div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => void approvePendingAction()}
                        className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-[11px] font-medium text-white"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setPendingApproval(null)}
                        className="rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-[11px] text-amber-900"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {pendingFallbackPrompt && (
                <div className="rounded-[16px] border border-violet-400/20 bg-violet-500/10 p-4 text-sm text-violet-100">
                    <div className="font-semibold">Choose fallback provider</div>
                    <div className="mt-2">{providerError || 'Selected model failed. Choose a fallback provider.'}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(['gemini', 'openrouter', 'kimi', 'groq'] as Array<Exclude<ModelProvider, 'auto' | 'glm' | 'zai'>>).map(
                        (provider) => (
                          <button
                            key={provider}
                            onClick={() => void handleFallbackChoice(provider)}
                            className="rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-[11px] font-medium capitalize text-violet-900"
                          >
                            {provider}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-white/8 px-3 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                onClick={() => void handlePickAttachments('image')}
                className="rounded-lg border border-white/8 bg-white/5 px-2 py-1.5 text-[10px] text-[#dbe4f0]"
              >
                <FileImage className="mr-1.5 inline h-3.5 w-3.5" />
                Image
              </button>
              <button
                onClick={() => void handlePickAttachments('file')}
                className="rounded-lg border border-white/8 bg-white/5 px-2 py-1.5 text-[10px] text-[#dbe4f0]"
              >
                <FileUp className="mr-1.5 inline h-3.5 w-3.5" />
                File
              </button>
              <button
                onClick={() => void handlePickAttachments('folder')}
                className="rounded-lg border border-white/8 bg-white/5 px-2 py-1.5 text-[10px] text-[#dbe4f0]"
              >
                <FolderUp className="mr-1.5 inline h-3.5 w-3.5" />
                Folder
              </button>
              <button
                onClick={() => setAttachments([])}
                className="rounded-lg border border-white/8 bg-white/5 px-2 py-1.5 text-[10px] text-[#dbe4f0]"
              >
                <Upload className="mr-1.5 inline h-3.5 w-3.5" />
                Clear
              </button>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault()
                void handleAgentPrompt(chatInput)
              }}
              className="rounded-[16px] border border-white/8 bg-white/5 p-2.5 shadow-sm"
            >
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleAgentPrompt(chatInput)
                  }
                }}
                placeholder="Describe your page, ask for file edits, or refine the design..."
                className="min-h-[72px] w-full resize-none bg-transparent text-[12px] text-white outline-none placeholder:text-[#70829b]"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-[10px] text-[#70829b]">
                  <span className="rounded-full border border-white/8 px-2 py-1">Full-Stack</span>
                  <span className="rounded-full border border-white/8 px-2 py-1">Tasks</span>
                </div>
                <button
                  type="submit"
                  disabled={!chatInput.trim() || isBusy}
                  className="grid h-[30px] w-[30px] place-items-center rounded-full bg-cyan-400 text-[#081018] disabled:opacity-40"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              </div>
            </form>
          </div>

        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#090d14] text-white shadow-[0_28px_100px_rgba(0,0,0,0.28)]">
          <div className="border-b border-white/8 bg-[#0b0f18] px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                    {status}
                  </span>
                  <span className="rounded-full border border-cyan-400/18 bg-cyan-400/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                    {currentModelLabel}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#94a3b8]">
                    {currentModelStatus}
                  </span>
                </div>
                <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-white">{projectDisplayName}</h1>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#94a3b8]">{providerError || statusMessage}</p>
                <div className="mt-2 text-[11px] text-[#70829b]">{currentModelName}</div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[12px] text-[#94a3b8]">
                  <FolderTree className="h-4 w-4 text-[#22d3ee]" />
                  <span className="max-w-[320px] truncate">{workspacePath}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={openPreviewWindow}
                    disabled={!previewSource}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40"
                  >
                    <ExternalLink className="mr-1.5 inline h-3.5 w-3.5" />
                    Preview
                  </button>
                  <button
                    onClick={() => void handleTopAction(refreshProject, 'Refreshing preview...')}
                    disabled={!projectState || isBusy}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40"
                  >
                    <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
                    Refresh
                  </button>
                  <button
                    onClick={() => void persistFile(selectedFile, draftContent)}
                    disabled={!selectedFile || isBusy || !selectedFileDirty}
                    className="rounded-lg bg-emerald-500/90 px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40"
                  >
                    <Save className="mr-1.5 inline h-3.5 w-3.5" />
                    {selectedFileDirty ? 'Save' : 'Saved'}
                  </button>
                  <button
                    onClick={() =>
                      void handleTopAction(async () => {
                        if (!projectState) return
                        const result = await exportBuilderProjectZip(projectState.metadata.id)
                        setStatusMessage(result.success ? `ZIP exported: ${result.exportPath}` : result.error || 'ZIP export failed.')
                      }, 'Exporting ZIP...')
                    }
                    disabled={!projectState}
                    className="rounded-lg bg-violet-500/85 px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40"
                  >
                    <Download className="mr-1.5 inline h-3.5 w-3.5" />
                    Export
                  </button>
                  <button
                    onClick={() =>
                      void handleTopAction(async () => {
                        if (!projectState) return
                        const result = await openBuilderProjectFolder(projectState.metadata.id)
                        setStatusMessage(result.success ? 'Folder opened.' : result.error || 'Open folder failed.')
                      })
                    }
                    disabled={!projectState}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40"
                  >
                    <FolderTree className="mr-1.5 inline h-3.5 w-3.5" />
                    Folder
                  </button>
                  <button
                    onClick={() =>
                      void handleTopAction(async () => {
                        if (!projectState) return
                        const result = await openBuilderProjectInVsCode(projectState.metadata.id)
                        setStatusMessage(result.success ? 'VS Code opened.' : result.error || 'VS Code open failed.')
                      })
                    }
                    disabled={!projectState}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40"
                  >
                    <Code2 className="mr-1.5 inline h-3.5 w-3.5" />
                    VS Code
                  </button>
                  <button
                    onClick={() =>
                      void handleTopAction(async () => {
                        if (!projectState) return
                        const result = await copyBuilderProjectPath(projectState.metadata.id)
                        setStatusMessage(result.success ? 'Project path copied.' : result.error || 'Copy failed.')
                      })
                    }
                    disabled={!projectState}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40"
                  >
                    <Copy className="mr-1.5 inline h-3.5 w-3.5" />
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {modeButtons.map(({ value, label, icon }) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                    mode === value ? 'bg-[#111318] text-white shadow-sm' : 'border border-white/10 bg-white/5 text-[#94a3b8]'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {icon}
                    {label}
                  </span>
                </button>
              ))}
              {([
                ['desktop', <Laptop className="h-4 w-4" />],
                ['tablet', <MonitorSmartphone className="h-4 w-4" />],
                ['mobile', <Smartphone className="h-4 w-4" />]
              ] as Array<[DeviceMode, ReactNode]>).map(([value, icon]) => (
                <button
                  key={value}
                  onClick={() => setDevice(value)}
                  className={`grid h-8 w-8 place-items-center rounded-full ${
                    device === value ? 'bg-[#111318] text-white' : 'border border-white/10 bg-white/5 text-[#94a3b8]'
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div
            className={`grid min-h-0 flex-1 gap-3 p-3 ${
              mode === 'preview'
                ? 'grid-cols-1'
                : mode === 'code'
                  ? 'grid-cols-[240px_minmax(0,1fr)]'
                  : 'grid-cols-[240px_minmax(0,1.1fr)_minmax(380px,0.95fr)]'
            }`}
          >
            {mode !== 'preview' && (
              <aside
                ref={filePanelRef}
                className="flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-white/10 bg-[#0b0d12] text-white shadow-[0_16px_40px_rgba(0,0,0,0.24)]"
              >
                <div className="border-b border-white/10 px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7d8795]">Files</div>
                  <div className="mt-1 text-sm font-medium text-white">{totalFiles} project files</div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="space-y-2">
                    {fileTree.length ? (
                      renderFileTreeNodes(fileTree)
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-[#12161f] p-4 text-sm text-[#93a0b5]">
                        Files will appear here after generation.
                      </div>
                    )}
                  </div>
                </div>
              </aside>
            )}

            {showPreview && (
              <section className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#090b10] text-white shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
                <div className="border-b border-white/10 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7d8795]">Preview</div>
                      <div className="mt-1 text-sm font-medium text-white">{projectState?.metadata.projectPath || 'Live website preview'}</div>
                    </div>
                    <button
                      onClick={openPreviewWindow}
                      disabled={!previewSource}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40"
                    >
                      Full Preview
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-[#07090d] p-4">
                  {previewSource ? (
                    <div className="flex min-h-full items-start justify-center">
                      <div style={{ width: deviceWidths[device], maxWidth: '100%' }} className="transition-all duration-300">
                        <iframe
                          title="builder-preview"
                          srcDoc={previewSource}
                          sandbox="allow-scripts allow-same-origin"
                          className="min-h-[780px] w-full rounded-[16px] border border-white/10 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.32)]"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      {isBusy ? (
                        <div className="rounded-[20px] border border-white/10 bg-[#11141c] px-6 py-5 shadow-sm">
                          <LoaderLabel label="Updating preview" />
                        </div>
                      ) : (
                        <div className="rounded-[20px] border border-dashed border-white/15 bg-[#11141c] px-8 py-10 text-center text-[#93a0b5]">
                          <Eye className="mx-auto mb-3 h-10 w-10 text-[#64748b]" />
                          <div className="text-lg font-medium text-white">Preview canvas is ready</div>
                          <div className="mt-2 text-sm">Generate or edit a project to render the website here.</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}

            {mode !== 'preview' && (
              <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_240px] gap-3">
                <div className="min-h-0 overflow-hidden rounded-[20px] border border-white/10 bg-[#0c1018] shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
                  <div className="border-b border-white/10 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8b93a5]">Code Editor</div>
                        <div className="mt-1 flex items-center gap-2 text-sm font-medium text-white">
                          <span>{selectedFile || 'No file selected'}</span>
                          {selectedFileDirty && (
                            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                              Unsaved
                            </span>
                          )}
                        </div>
                      </div>
                      {showVisual && (
                        <button
                          onClick={() => void handleVisualSave()}
                          className="rounded-lg bg-[#111318] px-2.5 py-1.5 text-[11px] font-medium text-white"
                        >
                          <PencilLine className="mr-1.5 inline h-3.5 w-3.5" />
                          Save Visual
                        </button>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeFiles.map((file) => (
                        <button
                          key={file.path}
                          onClick={() => setSelectedFile(file.path)}
                          className={`rounded-full px-3 py-1.5 text-[11px] ${
                            selectedFile === file.path
                              ? 'bg-[#111318] text-white'
                              : 'border border-white/10 bg-white/5 text-[#94a3b8]'
                          }`}
                        >
                          {file.path.split('/').pop()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="h-[calc(100%-96px)] overflow-hidden">
                    {showCode && selectedFile ? (
                      <Editor
                        height="100%"
                        language={languageForFile(selectedFile)}
                        value={draftContent}
                        onChange={(value) => setDraftContent(value || '')}
                        theme="alpha-builder-window"
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          wordWrap: 'on',
                          fontFamily: "'Fira Code', monospace"
                        }}
                      />
                    ) : showCode ? (
                      <div className="flex h-full items-center justify-center bg-[#0b0e14] text-[#94a3b8]">
                        Select a file to edit.
                      </div>
                    ) : showVisual ? (
                      <div className="h-full overflow-y-auto bg-[#0b0e14] p-4">
                        <div className="space-y-3">
                          {editableTexts.length ? (
                            editableTexts.map((item, index) => (
                              <label key={item.id} className="block rounded-2xl border border-white/10 bg-white/5 p-3 shadow-sm">
                                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#94a3b8]">{item.tag}</div>
                                <input
                                  value={item.text}
                                  onChange={(event) =>
                                    setEditableTexts((prev) =>
                                      prev.map((entry, currentIndex) =>
                                        currentIndex === index ? { ...entry, text: event.target.value } : entry
                                      )
                                    )
                                  }
                                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                                />
                              </label>
                            ))
                          ) : (
                            <div className="flex h-full min-h-[300px] items-center justify-center text-[#94a3b8]">
                              No editable text nodes found in the current preview.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center text-[#6b7280]">Code view hidden in preview mode.</div>
                    )}
                  </div>
                </div>

                <div
                  ref={terminalPanelRef}
                  className="overflow-hidden rounded-[20px] border border-white/10 bg-[#0c0f15] text-white shadow-[0_16px_40px_rgba(0,0,0,0.24)]"
                >
                  <div className="border-b border-white/10 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7d8795]">
                        <Terminal className="h-4 w-4" />
                        Terminal + Output
                      </div>
                      {runningCommand && <LoaderLabel label="Running" />}
                    </div>
                  </div>
                  <div className="grid h-[calc(100%-57px)] grid-cols-[minmax(0,1fr)_168px] gap-3 p-3">
                    <div className="flex min-h-0 flex-col gap-3">
                      <div className="flex flex-wrap gap-2">
                        {quickCommandButtons.map(([command, label]) => (
                          <button
                            key={command}
                            onClick={() => setTerminalCommand(command)}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-[#d5d9e3]"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={terminalCommand}
                          onChange={(event) => setTerminalCommand(event.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-[#7d8795]"
                          placeholder="Run command in current project folder"
                        />
                        <button
                          onClick={() => void runTerminalCommand(terminalCommand)}
                          className="rounded-lg bg-[#0ea5b7] px-3 py-1.5 text-[11px] font-medium text-white"
                        >
                          Run
                        </button>
                        <button
                          onClick={() => void stopTerminalCommand()}
                          disabled={!runningCommand}
                          className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200 disabled:opacity-40"
                        >
                          Stop
                        </button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto rounded-[18px] border border-white/10 bg-[#090c12] p-3 font-mono text-xs whitespace-pre-wrap text-[#d7def7]">
                        {terminalOutput.length ? terminalOutput.join('') : 'Terminal output will appear here.'}
                      </div>
                    </div>
                    <div className="min-h-0 overflow-y-auto rounded-[18px] border border-white/10 bg-[#10141d] p-3">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#7d8795]">History</div>
                      <div className="space-y-2">
                        {terminalHistory.map((item, index) => (
                          <button
                            key={`${item}-${index}`}
                            onClick={() => setTerminalCommand(item)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] text-[#d5d9e3]"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </section>
      </div>

      {showModelModal && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-[#0c0f15] p-6 text-white shadow-[0_24px_120px_rgba(0,0,0,0.44)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[#7d8795]">Add New Model</div>
                <div className="mt-1 text-2xl font-semibold text-white">Provider + model configuration</div>
              </div>
              <button onClick={() => setShowModelModal(false)} className="rounded-xl border border-white/10 bg-white/5 p-1.5 text-[#c2c9d6]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="mb-2 text-xs uppercase tracking-[0.24em] text-[#7d8795]">Provider</div>
                <select
                  value={addModelDraft.group}
                  onChange={(event) => setAddModelDraft((prev) => ({ ...prev, group: event.target.value as AddModelDraft['group'] }))}
                  className="w-full bg-transparent text-white outline-none"
                >
                  <option value="glm">GLM</option>
                  <option value="zai">Z.AI</option>
                  <option value="geminiBrain">Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="kimi">Kimi</option>
                  <option value="groq">Groq</option>
                </select>
              </label>
              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="mb-2 text-xs uppercase tracking-[0.24em] text-[#7d8795]">Slot</div>
                <select
                  value={addModelDraft.slot}
                  onChange={(event) => setAddModelDraft((prev) => ({ ...prev, slot: Number(event.target.value) as 1 | 2 | 3 }))}
                  className="w-full bg-transparent text-white outline-none"
                >
                  <option value={1}>Slot 1</option>
                  <option value={2}>Slot 2</option>
                  <option value={3}>Slot 3</option>
                </select>
              </label>
              <label className="col-span-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="mb-2 text-xs uppercase tracking-[0.24em] text-[#7d8795]">API Key</div>
                <input
                  value={addModelDraft.apiKey}
                  onChange={(event) => setAddModelDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
                  className="w-full bg-transparent text-white outline-none"
                />
              </label>
              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="mb-2 text-xs uppercase tracking-[0.24em] text-[#7d8795]">Base URL</div>
                <input
                  value={addModelDraft.baseUrl}
                  onChange={(event) => setAddModelDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
                  className="w-full bg-transparent text-white outline-none"
                />
              </label>
              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="mb-2 text-xs uppercase tracking-[0.24em] text-[#7d8795]">Model ID</div>
                <input
                  value={addModelDraft.modelId}
                  onChange={(event) => setAddModelDraft((prev) => ({ ...prev, modelId: event.target.value }))}
                  className="w-full bg-transparent text-white outline-none"
                />
              </label>
              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="mb-2 text-xs uppercase tracking-[0.24em] text-[#7d8795]">Provider Type</div>
                <input
                  value={addModelDraft.providerMode}
                  onChange={(event) => setAddModelDraft((prev) => ({ ...prev, providerMode: event.target.value }))}
                  className="w-full bg-transparent text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white">
                <input
                  type="checkbox"
                  checked={addModelDraft.enabled}
                  onChange={(event) => setAddModelDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
                />
                Enable after save
              </label>
            </div>

            <div className="mt-4 text-sm text-[#7d8795]">
              {addModelMessage || 'Secure vault ke through save hoga. Full key logs me nahi jayegi.'}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void testModelDraft()} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white">
                Test
              </button>
              <button onClick={() => void saveModelDraft()} className="rounded-xl bg-white px-3 py-1.5 text-[11px] text-[#111318]">
                Save Model
              </button>
              <button
                onClick={async () => {
                  await refreshModelOptions()
                  setShowModelModal(false)
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white"
              >
                Manage API Keys
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
