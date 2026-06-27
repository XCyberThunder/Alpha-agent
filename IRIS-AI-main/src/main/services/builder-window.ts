import { BrowserWindow, IpcMain } from 'electron'
import { join } from 'path'

type BuilderPayload = {
  state: any
  previewHtml?: string
  prompt?: string
  providerError?: string
}

let builderWindow: BrowserWindow | null = null
let latestPayload: BuilderPayload | null = null

const sendBuilderState = () => {
  if (!builderWindow || builderWindow.isDestroyed() || !latestPayload) return
  builderWindow.webContents.send('builder-window-state', latestPayload)
}

const buildBuilderUrl = (rendererUrl?: string) => {
  const trimmed = rendererUrl?.replace(/\/+$/, '') || ''
  return `${trimmed}#/builder`
}

export const openBuilderWindow = async ({
  rendererUrl,
  icon,
  preloadPath,
  payload
}: {
  rendererUrl?: string
  icon?: string
  preloadPath: string
  payload?: BuilderPayload
}) => {
  if (payload) latestPayload = payload

  if (!builderWindow || builderWindow.isDestroyed()) {
    builderWindow = new BrowserWindow({
      width: 1680,
      height: 980,
      minWidth: 1200,
      minHeight: 760,
      title: 'ALPHA Website Builder',
      show: false,
      backgroundColor: '#020617',
      autoHideMenuBar: true,
      ...(process.platform === 'linux' && icon ? { icon } : {}),
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        backgroundThrottling: false,
        webSecurity: false
      }
    })

    builderWindow.on('ready-to-show', () => builderWindow?.show())
    builderWindow.on('closed', () => {
      builderWindow = null
    })
    builderWindow.webContents.on('did-finish-load', () => sendBuilderState())

    if (rendererUrl) {
      await builderWindow.loadURL(buildBuilderUrl(rendererUrl))
    } else {
      await builderWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: '/builder'
      })
    }
  }

  if (builderWindow.isMinimized()) builderWindow.restore()
  builderWindow.show()
  builderWindow.focus()
  sendBuilderState()
  return builderWindow
}

export default function registerBuilderWindow({
  ipcMain,
  rendererUrl,
  icon,
  preloadPath
}: {
  ipcMain: IpcMain
  rendererUrl?: string
  icon?: string
  preloadPath: string
}) {
  ipcMain.handle('builder-window-open', async (_, payload: BuilderPayload) => {
    await openBuilderWindow({ rendererUrl, icon, preloadPath, payload })
    return { success: true }
  })

  ipcMain.handle('builder-window-get-state', async () => ({
    success: true,
    payload: latestPayload
  }))

  ipcMain.handle('builder-window-close', async () => {
    builderWindow?.close()
    return { success: true }
  })
}
