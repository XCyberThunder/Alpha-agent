import { useEffect, useMemo, useState } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import {
  Bot,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FolderOpen,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
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
  updateBuilderProject
} from '@renderer/services/project-builder'

type BuilderOpenDetail = {
  state: BuilderProjectState
  previewHtml?: string
  prompt?: string
}

type ProjectChatMessage = {
  role: 'user' | 'assistant'
  text: string
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

const previewFriendlyFile = (files: BuilderProjectFile[]) => {
  return (
    files.find((file) => file.path === 'index.html') ||
    files.find((file) => file.path.endsWith('/index.html')) ||
    files[0] ||
    null
  )
}

export default function LiveCodingWidget() {
  const monaco = useMonaco()
  const [isVisible, setIsVisible] = useState(false)
  const [projectState, setProjectState] = useState<BuilderProjectState | null>(null)
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'editing' | 'saved' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ProjectChatMessage[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!monaco) return
    monaco.editor.defineTheme('alpha-dark-builder', {
      base: 'vs-dark',
      inherit: true,
      rules: [{ token: 'comment', foreground: '7dd3fc', fontStyle: 'italic' }],
      colors: { 'editor.background': '#00000000' }
    })
    monaco.editor.setTheme('alpha-dark-builder')
  }, [monaco])

  useEffect(() => {
    const handleOpenBuilder = (event: Event) => {
      const detail = (event as CustomEvent<BuilderOpenDetail>).detail
      if (!detail?.state) return
      setProjectState(detail.state)
      setPreviewHtml(detail.previewHtml || '')
      setSelectedFile(detail.state.files[0]?.path || '')
      setStatus('saved')
      setStatusMessage(detail.prompt ? `Generated from: ${detail.prompt}` : 'Project ready.')
      setChatMessages([
        {
          role: 'assistant',
          text: 'Builder ready. Project-specific changes yahin se kar sakte ho.'
        }
      ])
      setIsVisible(true)
    }

    window.addEventListener('alpha-open-project-builder', handleOpenBuilder as EventListener)
    return () => {
      window.removeEventListener('alpha-open-project-builder', handleOpenBuilder as EventListener)
    }
  }, [])

  const selectedFileContent = useMemo(() => {
    if (!projectState) return ''
    return projectState.files.find((file) => file.path === selectedFile)?.content || ''
  }, [projectState, selectedFile])

  const previewFallback = useMemo(() => {
    if (previewHtml) return previewHtml
    const fallbackFile = projectState ? previewFriendlyFile(projectState.files) : null
    if (!fallbackFile) return ''
    if (fallbackFile.path.endsWith('.html')) return fallbackFile.content
    return ''
  }, [previewHtml, projectState])

  const updateProject = async (prompt: string) => {
    if (!projectState?.metadata.id) return
    setIsSubmitting(true)
    setStatus('editing')
    setStatusMessage('GLM 5.2 is updating the project...')
    setChatMessages((prev) => [...prev, { role: 'user', text: prompt }])

    try {
      const response = await updateBuilderProject(projectState.metadata.id, prompt)
      if (response.success && response.state) {
        setProjectState(response.state)
        setPreviewHtml(response.previewHtml || '')
        if (!selectedFile || !response.state.files.some((file) => file.path === selectedFile)) {
          setSelectedFile(response.state.files[0]?.path || '')
        }
        setStatus('saved')
        setStatusMessage('Project files updated and saved.')
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', text: 'Update done. Preview and files refreshed.' }
        ])
      } else {
        setStatus('error')
        setStatusMessage(response.message || response.error || 'Project update failed.')
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', text: response.message || response.error || 'Update failed.' }
        ])
      }
    } catch (error: any) {
      setStatus('error')
      setStatusMessage(error?.message || 'Project update failed.')
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', text: error?.message || 'Project update failed.' }
      ])
    } finally {
      setIsSubmitting(false)
      setChatInput('')
    }
  }

  const handleExportZip = async () => {
    if (!projectState?.metadata.id) return
    setStatus('editing')
    setStatusMessage('Exporting ZIP...')
    const result = await exportBuilderProjectZip(projectState.metadata.id)
    setStatus(result.success ? 'saved' : 'error')
    setStatusMessage(
      result.success ? `ZIP exported to ${result.exportPath}` : result.error || 'ZIP export failed.'
    )
  }

  const handleOpenFolder = async () => {
    if (!projectState?.metadata.id) return
    const result = await openBuilderProjectFolder(projectState.metadata.id)
    setStatusMessage(result.success ? `Opened ${result.projectPath}` : result.error || 'Open folder failed.')
  }

  const handleOpenVsCode = async () => {
    if (!projectState?.metadata.id) return
    const result = await openBuilderProjectInVsCode(projectState.metadata.id)
    setStatusMessage(result.success ? 'Opened in VS Code.' : result.error || 'VS Code open failed.')
  }

  const handleCopyPath = async () => {
    if (!projectState?.metadata.id) return
    const result = await copyBuilderProjectPath(projectState.metadata.id)
    if (result.success && result.projectPath) {
      await navigator.clipboard.writeText(result.projectPath)
      setStatusMessage(`Copied path: ${result.projectPath}`)
    } else {
      setStatusMessage(result.error || 'Copy path failed.')
    }
  }

  if (!isVisible || !projectState) return null

  return (
    <div className="absolute inset-0 z-[1200] bg-black/55 backdrop-blur-sm p-5">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-cyan-300/20 bg-slate-950/72 shadow-[0_24px_120px_rgba(15,23,42,0.68)]">
        <div className="flex items-center justify-between border-b border-white/8 bg-slate-950/55 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
              <Sparkles className={`h-5 w-5 ${isSubmitting ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-200/80">
                  Website Builder
                </span>
                <span className="rounded-full border border-cyan-300/15 bg-cyan-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-cyan-100/80">
                  {projectState.metadata.modelUsed}
                </span>
              </div>
              <p className="mt-1 text-lg font-semibold text-white">{projectState.metadata.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="mr-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200">
              {status}
            </div>
            <button
              onClick={handleExportZip}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-100 transition hover:bg-white/10"
            >
              <Download className="h-4 w-4" /> Export ZIP
            </button>
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-100 transition hover:bg-white/10"
            >
              <FolderOpen className="h-4 w-4" /> Open Folder
            </button>
            <button
              onClick={handleOpenVsCode}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-100 transition hover:bg-white/10"
            >
              <ExternalLink className="h-4 w-4" /> Open in VS Code
            </button>
            <button
              onClick={handleCopyPath}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-100 transition hover:bg-white/10"
            >
              <Copy className="h-4 w-4" /> Copy Path
            </button>
            <button
              onClick={() => setIsVisible(false)}
              className="rounded-xl border border-red-400/15 bg-red-500/10 p-2 text-red-200 transition hover:bg-red-500/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1.1fr)_minmax(0,1fr)] gap-0">
          <aside className="flex min-h-0 flex-col border-r border-white/8 bg-slate-950/38">
            <div className="border-b border-white/8 px-4 py-3 text-xs uppercase tracking-[0.28em] text-zinc-400">
              File Tree
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-2">
                {projectState.files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    className={`flex w-full items-center gap-2 rounded-2xl border px-3 py-2 text-left transition ${
                      selectedFile === file.path
                        ? 'border-cyan-300/30 bg-cyan-400/12 text-cyan-100'
                        : 'border-white/5 bg-white/5 text-zinc-300 hover:bg-white/8'
                    }`}
                  >
                    <FileCode2 className="h-4 w-4 shrink-0" />
                    <span className="truncate text-sm">{file.path}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_240px] border-r border-white/8">
            <div className="min-h-0 border-b border-white/8 bg-slate-950/28 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-zinc-400">
                <Eye className="h-4 w-4 text-cyan-200" />
                Live Preview
              </div>
              <div className="h-[calc(100%-28px)] overflow-hidden rounded-[24px] border border-cyan-300/15 bg-slate-950/55">
                {previewFallback ? (
                  <iframe
                    title="builder-preview"
                    srcDoc={previewFallback}
                    sandbox="allow-scripts allow-same-origin"
                    className="h-full w-full bg-white"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-zinc-400">
                    <div>
                      <Code2 className="mx-auto mb-3 h-10 w-10 text-zinc-500" />
                      <p>No HTML preview available for this project yet.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col bg-slate-950/48">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-zinc-400">
                  <MessageSquare className="h-4 w-4 text-violet-200" />
                  Coding Agent Chat
                </div>
                {isSubmitting && (
                  <div className="flex items-center gap-2 text-xs text-cyan-200">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Updating
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
                  const trimmed = chatInput.trim()
                  if (!trimmed || isSubmitting) return
                  void updateProject(trimmed)
                }}
                className="border-t border-white/8 p-4"
              >
                <div className="flex items-center gap-3 rounded-[22px] border border-white/10 bg-white/6 px-4 py-3">
                  <Bot className="h-4 w-4 text-cyan-200" />
                  <input
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    placeholder="Navbar black glass banao..."
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !chatInput.trim()}
                    className="rounded-xl border border-cyan-300/20 bg-cyan-400/15 px-3 py-2 text-xs text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Send'}
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className="flex min-h-0 flex-col bg-slate-950/36">
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-zinc-400">
                <Code2 className="h-4 w-4 text-cyan-200" />
                Code Tabs
              </div>
              <span className="truncate text-xs text-zinc-400">{selectedFile || 'No file selected'}</span>
            </div>
            <div className="flex min-h-0 flex-wrap gap-2 border-b border-white/8 px-4 py-3">
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
            <div className="min-h-0 flex-1 pt-3">
              <Editor
                height="100%"
                language={languageForFile(selectedFile)}
                theme="alpha-dark-builder"
                value={selectedFileContent}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  wordWrap: 'on',
                  fontFamily: "'Fira Code', monospace"
                }}
              />
            </div>
          </section>
        </div>

        <div className="border-t border-white/8 bg-slate-950/45 px-5 py-3 text-sm text-zinc-300">
          {statusMessage || `Project path: ${projectState.metadata.projectPath}`}
        </div>
      </div>
    </div>
  )
}
