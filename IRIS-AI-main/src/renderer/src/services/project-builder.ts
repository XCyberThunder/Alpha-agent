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
  previewHtml?: string
  message?: string
  error?: string
  code?: string
  exportPath?: string
  projectPath?: string
}

export const createBuilderProject = async (
  prompt: string,
  provider: 'glm' | 'gemini' | 'openrouter' | 'kimi' | 'groq' = 'glm'
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-create', { prompt, provider })
}

export const updateBuilderProject = async (
  projectId: string,
  prompt: string,
  provider?: 'glm' | 'gemini' | 'openrouter' | 'kimi' | 'groq'
): Promise<BuilderProjectResponse> => {
  return window.electron.ipcRenderer.invoke('project-builder-update', { projectId, prompt, provider })
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
