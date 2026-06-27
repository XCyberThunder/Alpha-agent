import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import {
  Bot,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  Laptop,
  LoaderCircle,
  MonitorSmartphone,
  PanelsLeftBottom,
  PencilLine,
  RefreshCw,
  Save,
  Smartphone,
  Sparkles,
  X
} from 'lucide-react'
import {
  BuilderProjectFile,
  BuilderProjectState,
  copyBuilderProjectPath,
  exportBuilderProjectZip,
  openBuilderProjectFolder,
  openBuilderProjectInVsCode,
  readBuilderProject,
  saveBuilderProjectFile,
  updateBuilderProject
} from '@renderer/services/project-builder'

type BuilderPayload = {
  state: BuilderProjectState
  previewHtml?: string
  prompt?: string
  providerError?: string
}

type BuilderMode = 'preview' | 'code' | 'split' | 'visual'
type DeviceMode = 'desktop' | 'tablet' | 'mobile'
type ChatMessage = { role: 'user' | 'assistant'; text: string }
type EditableTextNode = { id: string; tag: string; text: string }

const deviceWidths: Record<DeviceMode, string> = {
  desktop: '100%',
  tablet: '820px',
  mobile: '420px'
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
    .slice(0, 16)
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

export default function BuilderWindow() {
  const monaco = useMonaco()
  const [projectState, setProjectState] = useState<BuilderProjectState | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'editing' | 'saved' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('Waiting for project...')
  const [providerError, setProviderError] = useState('')
  const [mode, setMode] = useState<BuilderMode>('split')
  const [device, setDevice] = useState<DeviceMode>('desktop')
  const [isBusy, setIsBusy] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [editableTexts, setEditableTexts] = useState<EditableTextNode[]>([])

  useEffect(() => {
    if (!monaco) return
    monaco.editor.defineTheme('alpha-builder-window', {
      base: 'vs-dark',
      inherit: true,
      rules: [{ token: 'comment', foreground: '7dd3fc', fontStyle: 'italic' }],
      colors: {
        'editor.background': '#09111f',
        'editorLineNumber.foreground': '#4b7a9e'
      }
    })
    monaco.editor.setTheme('alpha-builder-window')
  }, [monaco])

  useEffect(() => {
    const applyPayload = (payload?: BuilderPayload | null) => {
      if (!payload?.state) return
      setProjectState(payload.state)
      setPreviewHtml(payload.previewHtml || '')
      setSelectedFile(payload.state.files[0]?.path || '')
      setStatus(payload.providerError ? 'error' : 'saved')
      setProviderError(payload.providerError || '')
      setStatusMessage(payload.providerError || `Builder ready for ${payload.state.metadata.name}.`)
      setChatMessages([
        {
          role: 'assistant',
          text: payload.providerError
            ? `Builder shell ready. ${payload.providerError}`
            : `Project loaded with ${payload.state.metadata.providerUsed || payload.state.metadata.modelUsed}.`
        }
      ])
    }

    window.electron.ipcRenderer.invoke('builder-window-get-state').then((res) => applyPayload(res?.payload))
    const listener = (_event: unknown, payload: BuilderPayload) => applyPayload(payload)
    window.electron.ipcRenderer.on('builder-window-state', listener)
    return () => {
      window.electron.ipcRenderer.removeListener('builder-window-state', listener)
    }
  }, [])

  useEffect(() => {
    const selected = projectState?.files.find((file) => file.path === selectedFile)
    setDraftContent(selected?.content || '')
  }, [projectState, selectedFile])

  useEffect(() => {
    const sourceHtml =
      previewHtml ||
      projectState?.files.find((file) => file.path === 'index.html' || file.path.endsWith('/index.html'))?.content ||
      ''
    setEditableTexts(extractEditableTextNodes(sourceHtml))
  }, [previewHtml, projectState])

  const fileMap = useMemo(
    () =>
      new Map(
        (projectState?.files || []).map((file) => [file.path, file.content])
      ),
    [projectState]
  )

  const effectivePreview = useMemo(() => {
    if (previewHtml) return previewHtml
    return fileMap.get('index.html') || Array.from(fileMap.entries()).find(([file]) => file.endsWith('/index.html'))?.[1] || ''
  }, [fileMap, previewHtml])

  const providerLabel = projectState?.metadata.providerUsed || projectState?.metadata.modelUsed || 'ALPHA'

  const persistFile = async (filePath: string, content: string) => {
    if (!projectState) return
    setIsBusy(true)
    setStatus('editing')
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

  const handleSaveCode = async () => {
    if (!selectedFile) return
    await persistFile(selectedFile, draftContent)
  }

  const handleVisualSave = async () => {
    const htmlFile =
      projectState?.files.find((file) => file.path === 'index.html') ||
      projectState?.files.find((file) => file.path.endsWith('/index.html'))
    if (!htmlFile) return
    const updatedHtml = applyVisualEditsToHtml(htmlFile.content, editableTexts)
    await persistFile(htmlFile.path, updatedHtml)
  }

  const handleProjectChat = async (prompt: string) => {
    if (!projectState?.metadata.id || !prompt.trim()) return
    setIsBusy(true)
    setStatus('editing')
    setChatMessages((prev) => [...prev, { role: 'user', text: prompt }])
    try {
      const provider = (projectState.metadata.providerUsed || '').toLowerCase().includes('z.ai')
        ? 'zai'
        : (projectState.metadata.providerUsed || '').toLowerCase().includes('gemini')
          ? 'gemini'
          : (projectState.metadata.providerUsed || '').toLowerCase().includes('openrouter')
            ? 'openrouter'
            : (projectState.metadata.providerUsed || '').toLowerCase().includes('kimi')
              ? 'kimi'
              : (projectState.metadata.providerUsed || '').toLowerCase().includes('groq')
                ? 'groq'
                : 'glm'
      const response = await updateBuilderProject(projectState.metadata.id, prompt, provider)
      if (response.success && response.state) {
        setProjectState(response.state)
        setPreviewHtml(response.previewHtml || '')
        setStatus(response.providerError ? 'error' : 'saved')
        setProviderError(response.providerError || '')
        setStatusMessage(response.providerError || 'Project updated and preview refreshed.')
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', text: response.providerError || 'Current project files updated successfully.' }
        ])
      } else {
        setStatus('error')
        setStatusMessage(response.error || response.message || 'Project update failed.')
      }
    } finally {
      setChatInput('')
      setIsBusy(false)
    }
  }

  const refreshProject = async () => {
    if (!projectState?.metadata.id) return
    const response = await readBuilderProject(projectState.metadata.id)
    if (response.success && response.state) {
      setProjectState(response.state)
      setPreviewHtml(response.previewHtml || '')
      setStatusMessage('Project state refreshed.')
    }
  }

  if (!projectState) {
    return <div className="flex h-screen items-center justify-center bg-slate-950 text-cyan-100">Waiting for Builder payload...</div>
  }

  const showPreview = mode === 'preview' || mode === 'split' || mode === 'visual'
  const showCode = mode === 'code' || mode === 'split'
  const showVisual = mode === 'visual'

  return (
    <div className="h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(168,85,247,0.16),_transparent_24%),linear-gradient(180deg,_#030712,_#020617_42%,_#020817)] text-white">
      <div className="flex h-full flex-col p-4">
        <div className="mb-4 rounded-[28px] border border-cyan-300/15 bg-slate-950/55 px-5 py-4 shadow-[0_24px_90px_rgba(2,6,23,0.68)] backdrop-blur-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.34em] text-cyan-200/80">
                <Sparkles className="h-4 w-4" />
                ALPHA Website Builder
              </div>
              <div className="mt-1 text-2xl font-semibold">{projectState.metadata.name}</div>
              <div className="mt-1 text-sm text-slate-300">
                Provider: {providerLabel} <span className="mx-2 text-slate-500">|</span> Status: {status}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['preview', 'code', 'split', 'visual'] as BuilderMode[]).map((value) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`rounded-2xl border px-3 py-2 text-xs uppercase tracking-[0.2em] transition ${
                    mode === value
                      ? 'border-cyan-300/40 bg-cyan-400/18 text-cyan-50'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {value === 'preview' ? 'Preview' : value === 'code' ? 'Code' : value === 'split' ? 'Split' : 'Visual Edit'}
                </button>
              ))}

              <div className="mx-1 h-8 w-px bg-white/10" />
              {([
                ['desktop', <Laptop className="h-4 w-4" />],
                ['tablet', <MonitorSmartphone className="h-4 w-4" />],
                ['mobile', <Smartphone className="h-4 w-4" />]
              ] as Array<[DeviceMode, ReactNode]>).map(([value, icon]) => (
                <button
                  key={value}
                  onClick={() => setDevice(value)}
                  className={`rounded-2xl border p-2 transition ${
                    device === value
                      ? 'border-violet-300/40 bg-violet-400/16 text-violet-50'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {icon}
                </button>
              ))}

              <div className="mx-1 h-8 w-px bg-white/10" />
              <button onClick={handleSaveCode} className="rounded-2xl border border-emerald-300/20 bg-emerald-400/12 px-3 py-2 text-xs text-emerald-100">
                <Save className="mr-2 inline h-4 w-4" /> Save
              </button>
              <button onClick={() => exportBuilderProjectZip(projectState.metadata.id).then((r) => setStatusMessage(r.success ? `ZIP exported: ${r.exportPath}` : r.error || 'ZIP export failed.'))} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100">
                <Download className="mr-2 inline h-4 w-4" /> Export ZIP
              </button>
              <button onClick={() => openBuilderProjectFolder(projectState.metadata.id).then((r) => setStatusMessage(r.success ? `Opened ${r.projectPath}` : r.error || 'Open folder failed.'))} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100">
                <FolderOpen className="mr-2 inline h-4 w-4" /> Open Folder
              </button>
              <button onClick={() => openBuilderProjectInVsCode(projectState.metadata.id).then((r) => setStatusMessage(r.success ? 'Opened in VS Code.' : r.error || 'VS Code open failed.'))} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100">
                <ExternalLink className="mr-2 inline h-4 w-4" /> Open in VS Code
              </button>
              <button onClick={async () => { const result = await copyBuilderProjectPath(projectState.metadata.id); if (result.success && result.projectPath) { await navigator.clipboard.writeText(result.projectPath); setStatusMessage(`Copied path: ${result.projectPath}`) } }} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100">
                <Copy className="mr-2 inline h-4 w-4" /> Copy Path
              </button>
              <button onClick={() => refreshProject()} className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-100">
                <RefreshCw className="h-4 w-4" />
              </button>
              <button onClick={() => window.electron.ipcRenderer.invoke('builder-window-close')} className="rounded-2xl border border-red-400/20 bg-red-500/10 p-2 text-red-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 text-sm text-slate-300">{providerError || statusMessage}</div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_420px] gap-4">
          <aside className="min-h-0 rounded-[28px] border border-cyan-300/12 bg-slate-950/45 p-4 backdrop-blur-2xl">
            <div className="mb-3 text-xs uppercase tracking-[0.3em] text-cyan-200/70">File Tree</div>
            <div className="space-y-2 overflow-y-auto pr-1">
              {projectState.files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file.path)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                    selectedFile === file.path
                      ? 'border-cyan-300/35 bg-cyan-400/12 text-cyan-50'
                      : 'border-white/8 bg-white/5 text-slate-300 hover:bg-white/8'
                  }`}
                >
                  {file.path}
                </button>
              ))}
            </div>
          </aside>

          <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_260px] gap-4">
            <div className="min-h-0 rounded-[28px] border border-cyan-300/12 bg-slate-950/45 p-4 backdrop-blur-2xl">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">
                  {showVisual ? 'Visual Edit' : 'Live Preview'}
                </div>
                <div className="text-xs text-slate-400">Device: {device}</div>
              </div>

              {showPreview && (
                <div className="flex h-[calc(100%-1.75rem)] items-start justify-center overflow-auto rounded-[24px] border border-white/8 bg-slate-950/60 p-4">
                  <div style={{ width: deviceWidths[device], maxWidth: '100%' }} className="transition-all duration-300">
                    <iframe
                      title="builder-preview"
                      srcDoc={effectivePreview}
                      sandbox="allow-scripts allow-same-origin"
                      className="min-h-[560px] w-full rounded-[18px] bg-white shadow-[0_28px_80px_rgba(2,6,23,0.45)]"
                    />
                  </div>
                </div>
              )}

              {showVisual && (
                <div className="mt-4 grid gap-3">
                  {editableTexts.map((item, index) => (
                    <label key={item.id} className="rounded-2xl border border-white/8 bg-white/5 p-3">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.24em] text-slate-400">{item.tag}</div>
                      <input
                        value={item.text}
                        onChange={(event) =>
                          setEditableTexts((prev) =>
                            prev.map((entry, currentIndex) =>
                              currentIndex === index ? { ...entry, text: event.target.value } : entry
                            )
                          )
                        }
                        className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none"
                      />
                    </label>
                  ))}
                  <button onClick={handleVisualSave} className="w-fit rounded-2xl border border-violet-300/25 bg-violet-400/12 px-4 py-2 text-sm text-violet-50">
                    <PencilLine className="mr-2 inline h-4 w-4" />
                    Save Visual Edits
                  </button>
                </div>
              )}
            </div>

            <div className="min-h-0 rounded-[28px] border border-violet-300/12 bg-slate-950/45 p-4 backdrop-blur-2xl">
              <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-violet-200/70">
                <Bot className="h-4 w-4" />
                Coding Agent Chat
              </div>
              <div className="mb-3 h-[150px] space-y-3 overflow-y-auto pr-1">
                {chatMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`max-w-[88%] rounded-2xl border px-4 py-3 text-sm ${
                      message.role === 'user'
                        ? 'ml-auto border-cyan-300/20 bg-cyan-400/10 text-cyan-50'
                        : 'border-white/8 bg-white/6 text-zinc-100'
                    }`}
                  >
                    {message.text}
                  </div>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleProjectChat(chatInput)
                }}
                className="flex items-center gap-3 rounded-[22px] border border-white/10 bg-white/6 px-4 py-3"
              >
                <input
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Navbar black glass banao..."
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || isBusy}
                  className="rounded-xl border border-cyan-300/20 bg-cyan-400/15 px-3 py-2 text-xs text-cyan-100 disabled:opacity-50"
                >
                  {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Send'}
                </button>
              </form>
            </div>
          </section>

          <section className="min-h-0 rounded-[28px] border border-cyan-300/12 bg-slate-950/45 p-4 backdrop-blur-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-cyan-200/70">
                <PanelsLeftBottom className="h-4 w-4" />
                Code Tabs
              </div>
              <div className="truncate text-xs text-slate-400">{selectedFile}</div>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {projectState.files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file.path)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    selectedFile === file.path
                      ? 'border-cyan-300/30 bg-cyan-400/12 text-cyan-100'
                      : 'border-white/8 bg-white/5 text-zinc-300 hover:bg-white/8'
                  }`}
                >
                  {file.path.split('/').pop()}
                </button>
              ))}
            </div>
            {showCode ? (
              <div className="h-[calc(100%-3.5rem)] overflow-hidden rounded-[22px] border border-white/8">
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
              </div>
            ) : (
              <div className="flex h-[calc(100%-3.5rem)] items-center justify-center rounded-[22px] border border-dashed border-white/10 text-slate-500">
                Code editor hidden in {mode} mode.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
