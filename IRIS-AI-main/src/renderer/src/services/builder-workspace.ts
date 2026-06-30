export type BuilderWorkspaceNode = {
  name: string
  path: string
  type: 'file' | 'folder'
  ext?: string
  children?: BuilderWorkspaceNode[]
}

export type BuilderWorkspaceSummary = {
  name: string
  path: string
  lastOpenedAt: string
  available: boolean
}

export type BuilderWorkspaceSnapshot = {
  path: string
  name: string
  tree: BuilderWorkspaceNode[]
  branch: string | null
}

export type BuilderWorkspaceFile = {
  path: string
  name: string
  content: string
}

export type BuilderWorkspaceStateResponse = {
  success: boolean
  workspace?: BuilderWorkspaceSnapshot | null
  lastWorkspacePath?: string | null
  recentWorkspaces?: BuilderWorkspaceSummary[]
  cancelled?: boolean
  error?: string
}

export type BuilderWorkspaceFileResponse = {
  success: boolean
  file?: BuilderWorkspaceFile
  workspace?: BuilderWorkspaceSnapshot
  cancelled?: boolean
  error?: string
}

export type BuilderWorkspaceTerminalOpenResponse = {
  success: boolean
  sessionId?: string
  shell?: string
  cwd?: string
  error?: string
}

export type BuilderWorkspaceTerminalEvent = {
  sessionId: string
  type: 'stdout' | 'stderr' | 'exit' | 'error'
  text?: string
  exitCode?: number | null
}

export type BuilderWorkspaceSearchResult = {
  filePath: string
  fileName: string
  line: number
  preview: string
}

export const getBuilderWorkspaceState = async (): Promise<BuilderWorkspaceStateResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:get-state')

export const openBuilderWorkspaceFolderDialog = async (): Promise<BuilderWorkspaceStateResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:open-folder-dialog')

export const openBuilderWorkspace = async (
  workspacePath: string
): Promise<BuilderWorkspaceStateResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:open-workspace', { workspacePath })

export const clearBuilderRecentWorkspaces = async (): Promise<BuilderWorkspaceStateResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:clear-recents')

export const refreshBuilderWorkspace = async (
  workspacePath: string
): Promise<BuilderWorkspaceStateResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:refresh', { workspacePath })

export const searchBuilderWorkspace = async (payload: {
  workspacePath?: string
  query: string
}): Promise<{ success: boolean; results?: BuilderWorkspaceSearchResult[]; error?: string }> =>
  window.electron.ipcRenderer.invoke('builder-workspace:search', payload)

export const openBuilderLooseFileDialog = async (
  workspacePath?: string
): Promise<BuilderWorkspaceFileResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:open-file-dialog', { workspacePath })

export const readBuilderWorkspaceFile = async (
  filePath: string
): Promise<BuilderWorkspaceFileResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:read-file', { filePath })

export const writeBuilderWorkspaceFile = async (
  filePath: string,
  content: string
): Promise<{ success: boolean; error?: string }> =>
  window.electron.ipcRenderer.invoke('builder-workspace:write-file', { filePath, content })

export const createBuilderWorkspaceFile = async (payload: {
  workspacePath: string
  parentPath?: string
  name: string
}): Promise<BuilderWorkspaceFileResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:create-file', payload)

export const createBuilderWorkspaceFolder = async (payload: {
  workspacePath: string
  parentPath?: string
  name: string
}): Promise<BuilderWorkspaceStateResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:create-folder', payload)

export const revealBuilderWorkspacePath = async (
  targetPath: string
): Promise<{ success: boolean; error?: string }> =>
  window.electron.ipcRenderer.invoke('builder-workspace:reveal-path', { targetPath })

export const openBuilderTerminal = async (
  workspacePath?: string
): Promise<BuilderWorkspaceTerminalOpenResponse> =>
  window.electron.ipcRenderer.invoke('builder-workspace:terminal-open', { workspacePath })

export const sendBuilderTerminalInput = async (
  sessionId: string,
  input: string
): Promise<{ success: boolean; error?: string }> =>
  window.electron.ipcRenderer.invoke('builder-workspace:terminal-input', { sessionId, input })

export const disposeBuilderTerminal = async (
  sessionId: string
): Promise<{ success: boolean; error?: string }> =>
  window.electron.ipcRenderer.invoke('builder-workspace:terminal-dispose', { sessionId })
