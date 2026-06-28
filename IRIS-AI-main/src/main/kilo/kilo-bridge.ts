import { IpcMain } from 'electron'
import KiloService from './kilo-service'

let kiloService: KiloService | null = null

export const getKiloService = () => kiloService

export default function registerKiloBridge({ ipcMain }: { ipcMain: IpcMain }) {
  if (!kiloService) {
    kiloService = new KiloService()
  }

  ipcMain.handle('kilo-settings-get', async () => {
    return { success: true, settings: kiloService?.getSettings() }
  })

  ipcMain.handle('kilo-settings-save', async (_, payload) => {
    return { success: true, settings: kiloService?.saveSettings(payload || {}) }
  })

  ipcMain.handle('kilo-health', async () => {
    return kiloService?.health()
  })

  ipcMain.handle('kilo-test', async () => {
    return kiloService?.testConfiguration()
  })

  ipcMain.handle('kilo-execute-task', async (_, payload) => {
    return kiloService?.executeCodingTask(payload)
  })

  ipcMain.handle('kilo-apply-patch', async (_, payload) => {
    return kiloService?.applyPatch(payload.taskId, payload.projectRoot, payload.patch, payload.permissionMode)
  })

  ipcMain.handle('kilo-run-command', async (_, payload) => {
    return kiloService?.runCommand(payload.taskId, payload.projectRoot, payload.command, payload.permissionMode)
  })

  ipcMain.handle('kilo-cancel-task', async (_, { taskId }) => {
    return kiloService?.cancelTask(taskId)
  })

  ipcMain.handle('kilo-get-task-status', async (_, { taskId }) => {
    return { success: true, task: kiloService?.getTaskStatus(taskId) }
  })

  ipcMain.handle('kilo-list-tasks', async () => {
    return { success: true, tasks: kiloService?.listTasks() || [] }
  })

  ipcMain.handle('kilo-clear-task-history', async () => {
    return kiloService?.clearTaskHistory()
  })

  ipcMain.handle('kilo-open-task-folder', async () => {
    return kiloService?.openTaskFolder()
  })
}
