export type BuilderProjectFile = {
  path: string
  content: string
}

export type BuilderProjectMetadata = {
  id: string
  name: string
  type: string
  createdAt: string
  updatedAt: string
  modelUsed: string
  providerUsed: string
  files: string[]
  lastPrompt: string
  projectPath: string
}

export type BuilderProjectState = {
  metadata: BuilderProjectMetadata
  files: BuilderProjectFile[]
}

export type BuilderProjectResponse = {
  success: boolean
  state?: BuilderProjectState
  changeSet?: BuilderChangeSet
  previewHtml?: string
  message?: string
  error?: string
  code?: string
  providerError?: string
  providerCode?: string
  exportPath?: string
  projectPath?: string
  cancelled?: boolean
  usedFallback?: boolean
  reviewRequired?: boolean
  providerTrace?: BuilderProviderTrace
}

export type BuilderChatResponse = {
  success: boolean
  message?: string
  error?: string
  code?: string
  providerLabel?: string
  cancelled?: boolean
  providerTrace?: BuilderProviderTrace
}

export type BuilderProviderTrace = {
  selectedProvider?: string
  selectedModelId?: string
  actualProviderCalled?: string
  actualModelCalled?: string
  providerUsed: string
  modelUsed: string
  mode: 'chat' | 'coding' | 'edit'
  fallbackUsed: boolean
  responseStatus: 'success' | 'failed' | 'cancelled'
  parsedFilesCount?: number
  filesApplied?: number
  parserResult?: string
  error?: string
}

export type BuilderApplyMode = 'review' | 'auto' | 'ask'

export type BuilderChangeSetFile = {
  path: string
  oldContent: string | null
  newContent: string | null
  changeType: 'create' | 'update' | 'delete'
  diffText: string
  safeToApply: boolean
  warnings: string[]
  applied?: boolean
}

export type BuilderChangeSet = {
  id: string
  requestId: string
  projectId: string
  projectName: string
  projectType: string
  providerUsed: string
  modelUsed: string
  selectedProvider: string
  selectedModelId: string
  actualProviderCalled: string
  actualModelCalled: string
  mode: 'generate' | 'edit'
  createdAt: string
  workspacePath: string
  userPrompt: string
  status: 'pending_review' | 'applied' | 'rejected' | 'partially_applied' | 'failed'
  files: BuilderChangeSetFile[]
  fallbackUsed: boolean
  parsedFilesCount: number
  parserResult: string
  rawOutput?: string
  providerTrace?: BuilderProviderTrace
  backupSnapshotId?: string | null
}

export type BuilderTerminalResult = {
  success: boolean
  runId?: string
  command?: string
  exitCode?: number | null
  output?: string
  error?: string
}

export type BuilderAttachmentKind = 'image' | 'file' | 'folder'

export type BuilderAttachmentDescriptor = {
  id: string
  name: string
  path?: string
  kind: BuilderAttachmentKind
  size: number
  fileCount?: number
  previewUrl?: string
  content?: string
  skippedCount?: number
}

export type BuilderAttachmentPickResponse = {
  success: boolean
  attachments?: BuilderAttachmentDescriptor[]
  cancelled?: boolean
  error?: string
}

export type BuilderModelStatusRow = {
  slot: number
  enabled: boolean
  status: string
  maskedKey: string
  hasKey: boolean
  baseUrl?: string
  modelId?: string
  providerMode?: string
  lastFailureReason?: string
  lastCheckedAt?: string
  lastUsedAt?: string
}

export type BuilderModelStatuses = Record<string, BuilderModelStatusRow[]>

export type BuilderProviderName =
  | 'glm'
  | 'zai'
  | 'gemini'
  | 'openrouter'
  | 'kimi'
  | 'groq'
  | 'kiloGateway'
  | 'routeway'

export type BuilderProviderSelection =
  | BuilderProviderName
  | {
      provider: BuilderProviderName
      slot?: number
      modelId?: string
      baseUrl?: string
      providerMode?: string
      apiKey?: string
      label?: string
    }

export const createBuilderProject = async (
  prompt: string,
  provider: BuilderProviderSelection = 'kiloGateway',
  requestId?: string,
  applyMode: BuilderApplyMode = 'review'
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-create', { prompt, provider, requestId, applyMode })
}

export const updateBuilderProject = async (
  projectId: string,
  prompt: string,
  provider?: BuilderProviderSelection,
  requestId?: string,
  applyMode: BuilderApplyMode = 'review'
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-update', {
    projectId,
    prompt,
    provider,
    requestId,
    applyMode
  })
}

export const chatBuilderPrompt = async (
  prompt: string,
  provider: BuilderProviderSelection = 'kiloGateway',
  projectId?: string,
  requestId?: string
): Promise<BuilderChatResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-chat', {
    prompt,
    provider,
    projectId,
    requestId
  })
}

export const cancelBuilderRequest = async (requestId: string): Promise<{ success: boolean }> => {
  return window.electron.ipcRenderer.invoke('project-builder-cancel', { requestId })
}

export const readBuilderProject = async (projectId: string): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-read', { projectId })
}

export const exportBuilderProjectZip = async (
  projectId: string
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-export-zip', { projectId })
}

export const openBuilderProjectFolder = async (
  projectId: string
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-open-folder', { projectId })
}

export const openBuilderProjectInVsCode = async (
  projectId: string
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-open-vscode', { projectId })
}

export const copyBuilderProjectPath = async (
  projectId: string
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-copy-path', { projectId })
}

export const saveBuilderProjectFile = async (
  projectId: string,
  filePath: string,
  content: string
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-save-file', { projectId, filePath, content })
}

export const restoreBuilderProjectLastBackup = async (
  projectId: string
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-restore-last-backup', { projectId })
}

export const listBuilderChangeSets = async (
  projectId?: string,
  workspacePath?: string
): Promise<{ success: boolean; changesets?: BuilderChangeSet[]; error?: string }> => {
  return window.electron.ipcRenderer.invoke('project-builder-list-changesets', { projectId, workspacePath })
}

export const applyBuilderChangeSet = async (payload: {
  projectId?: string
  workspacePath?: string
  changeSetId: string
  selectedPaths?: string[]
}): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-apply-changeset', payload)
}

export const rejectBuilderChangeSet = async (payload: {
  projectId?: string
  workspacePath?: string
  changeSetId: string
}): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-reject-changeset', payload)
}

export const undoBuilderLastAiChange = async (payload: {
  projectId?: string
  workspacePath?: string
  changeSetId?: string
}): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-undo-last-ai-change', payload)
}

export const deleteBuilderChangeSet = async (payload: {
  projectId?: string
  workspacePath?: string
  changeSetId: string
}): Promise<{ success: boolean; error?: string }> => {
  return window.electron.ipcRenderer.invoke('project-builder-delete-changeset', payload)
}

export const openBuilderWindow = async (payload: {
  state?: BuilderProjectState
  previewHtml?: string
  prompt?: string
  providerError?: string
  autoStart?: boolean
  selectedProvider?: string
}) => {
  return window.electron.ipcRenderer.invoke('builder-window-open', payload)
}

export const getBuilderWindowState = async (): Promise<{
  success: boolean
  payload?: {
    state?: BuilderProjectState
    previewHtml?: string
    prompt?: string
    providerError?: string
    autoStart?: boolean
    selectedProvider?: string
  }
}> => {
  return window.electron.ipcRenderer.invoke('builder-window-get-state')
}

export const closeBuilderWindow = async () => {
  return window.electron.ipcRenderer.invoke('builder-window-close')
}

export const getBuilderWindowMeta = async (): Promise<{
  success: boolean
  version?: string
  dataPath?: string
  error?: string
}> => {
  return window.electron.ipcRenderer.invoke('builder-window-get-meta')
}

export const openBuilderDataFolder = async (): Promise<{
  success: boolean
  path?: string
  error?: string
}> => {
  return window.electron.ipcRenderer.invoke('builder-window-open-data-folder')
}

export const runBuilderProjectCommand = async (
  projectId: string,
  command: string
): Promise<BuilderTerminalResult> => {
  return window.electron.ipcRenderer.invoke('project-builder-run-command', { projectId, command })
}

export const stopBuilderProjectCommand = async (
  projectId: string
): Promise<BuilderTerminalResult> => {
  return window.electron.ipcRenderer.invoke('project-builder-stop-command', { projectId })
}

export const getBuilderModelStatuses = async (): Promise<{
  success: boolean
  statuses?: BuilderModelStatuses
  openrouterModel?: string
}> => {
  return window.electron.ipcRenderer.invoke('key-manager-list-statuses')
}

export const saveBuilderModelSlot = async (payload: {
  group: 'glm' | 'zai' | 'geminiBrain' | 'geminiAgent' | 'kimi' | 'openrouter' | 'groq' | 'kiloGateway' | 'routeway'
  slot: number
  key: string
  baseUrl: string
  modelId: string
  providerMode: string
}) => {
  return window.electron.ipcRenderer.invoke('key-manager-save-slot', payload)
}

export const setBuilderModelEnabled = async (payload: {
  group: 'glm' | 'zai' | 'geminiBrain' | 'geminiAgent' | 'kimi' | 'openrouter' | 'groq' | 'kiloGateway' | 'routeway'
  slot: number
  enabled: boolean
}) => {
  return window.electron.ipcRenderer.invoke('key-manager-set-enabled', payload)
}

export const testBuilderModelSlot = async (payload: {
  group: 'glm' | 'zai' | 'geminiBrain' | 'geminiAgent' | 'kimi' | 'openrouter' | 'groq' | 'kiloGateway' | 'routeway'
  slot: number
}) => {
  return window.electron.ipcRenderer.invoke('key-manager-test-key', payload)
}

export const pickBuilderAttachments = async (
  kind: BuilderAttachmentKind
): Promise<BuilderAttachmentPickResponse> => {
  return window.electron.ipcRenderer.invoke('builder-window-pick-attachments', { kind })
}
