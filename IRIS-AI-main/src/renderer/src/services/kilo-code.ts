import type {
  CodingTask,
  CodingTaskResult,
  KiloHealthResult,
  KiloSettings,
  KiloTaskRecord
} from '../../../main/kilo/kilo-types'

export const getKiloSettings = async (): Promise<{ success: boolean; settings?: KiloSettings }> => {
  return window.electron.ipcRenderer.invoke('kilo-settings-get')
}

export const saveKiloSettings = async (
  payload: Partial<KiloSettings>
): Promise<{ success: boolean; settings?: KiloSettings }> => {
  return window.electron.ipcRenderer.invoke('kilo-settings-save', payload)
}

export const healthCheckKilo = async (): Promise<KiloHealthResult> => {
  return window.electron.ipcRenderer.invoke('kilo-health')
}

export const testKiloConfiguration = async (): Promise<{ success: boolean; message?: string }> => {
  return window.electron.ipcRenderer.invoke('kilo-test')
}

export const executeKiloCodingTask = async (payload: CodingTask): Promise<CodingTaskResult> => {
  return window.electron.ipcRenderer.invoke('kilo-execute-task', payload)
}

export const cancelKiloTask = async (taskId: string) => {
  return window.electron.ipcRenderer.invoke('kilo-cancel-task', { taskId })
}

export const listKiloTasks = async (): Promise<{ success: boolean; tasks?: KiloTaskRecord[] }> => {
  return window.electron.ipcRenderer.invoke('kilo-list-tasks')
}

export const clearKiloTaskHistory = async () => {
  return window.electron.ipcRenderer.invoke('kilo-clear-task-history')
}

export const openKiloTaskFolder = async () => {
  return window.electron.ipcRenderer.invoke('kilo-open-task-folder')
}
