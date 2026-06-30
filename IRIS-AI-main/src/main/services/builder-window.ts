import fs from 'fs'
import path from 'path'
import { BrowserWindow, IpcMain, dialog } from 'electron'
import { join } from 'path'

type BuilderPayload = {
  state?: any
  previewHtml?: string
  prompt?: string
  providerError?: string
  autoStart?: boolean
  selectedProvider?: string
}

let builderWindow: BrowserWindow | null = null
let latestPayload: BuilderPayload | null = null

type AttachmentKind = 'image' | 'file' | 'folder'

type PickedAttachment = {
  id: string
  name: string
  path?: string
  kind: AttachmentKind
  size: number
  fileCount?: number
  previewUrl?: string
  content?: string
  skippedCount?: number
}

const textFilePattern = /\.(txt|md|json|html|css|js|jsx|ts|tsx|py|java|c|cpp|cc|cxx|yml|yaml)$/i
const imageFilePattern = /\.(png|jpe?g|webp|svg)$/i
const secretFilePattern = /(^|[\\/])(\.env(\..+)?)$|(^|[\\/])(id_rsa|id_dsa|id_ed25519|.*\.pem|.*\.key)$/i
const ignoredFolderPattern = /(^|[\\/])(node_modules|\.git|dist|build|coverage|out)([\\/]|$)/i

const makeAttachmentId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const readSafeTextFile = (filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return content.slice(0, 20000)
  } catch {
    return ''
  }
}

const walkDirectoryFiles = (rootPath: string): string[] => {
  const output: string[] = []
  const queue = [rootPath]

  while (queue.length) {
    const current = queue.shift()
    if (!current) continue
    if (ignoredFolderPattern.test(current)) continue
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(fullPath)
      } else if (entry.isFile()) {
        output.push(fullPath)
      }
    }
  }

  return output
}

const toPickedAttachment = (filePath: string, kind: Exclude<AttachmentKind, 'folder'>): PickedAttachment => {
  const stats = fs.statSync(filePath)
  return {
    id: makeAttachmentId(),
    name: path.basename(filePath),
    path: filePath,
    kind,
    size: stats.size,
    previewUrl: kind === 'image' ? `file://${filePath.replace(/\\/g, '/')}` : undefined,
    content: kind === 'file' && textFilePattern.test(filePath) ? readSafeTextFile(filePath) : undefined
  }
}

const pickAttachments = async (kind: AttachmentKind): Promise<{
  success: boolean
  attachments?: PickedAttachment[]
  cancelled?: boolean
  error?: string
}> => {
  const parentWindow = builderWindow && !builderWindow.isDestroyed() ? builderWindow : BrowserWindow.getFocusedWindow()
  const showDialog = (options: Electron.OpenDialogOptions) =>
    parentWindow ? dialog.showOpenDialog(parentWindow, options) : dialog.showOpenDialog(options)

  if (kind === 'folder') {
    const result = await showDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths.length) return { success: true, cancelled: true, attachments: [] }

    const rootPath = result.filePaths[0]
    const files = walkDirectoryFiles(rootPath)
    const visibleFiles = files.filter((filePath) => !secretFilePattern.test(filePath))
    const readableFiles = visibleFiles
      .filter((filePath) => textFilePattern.test(filePath))
      .slice(0, 40)
      .map((filePath) => {
        const relative = path.relative(rootPath, filePath).replace(/\\/g, '/')
        return `FILE: ${relative}\n${readSafeTextFile(filePath)}`
      })

    const totalSize = visibleFiles.reduce((sum, filePath) => {
      try {
        return sum + fs.statSync(filePath).size
      } catch {
        return sum
      }
    }, 0)

    return {
      success: true,
      attachments: [
        {
          id: makeAttachmentId(),
          name: path.basename(rootPath),
          path: rootPath,
          kind: 'folder',
          size: totalSize,
          fileCount: visibleFiles.length,
          skippedCount: files.length - visibleFiles.length,
          content: readableFiles.join('\n\n')
        }
      ]
    }
  }

  const result = await showDialog({
    properties: ['openFile', 'multiSelections'],
    filters:
      kind === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }]
        : [
            {
              name: 'Supported Files',
              extensions: ['txt', 'md', 'json', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'cc', 'cxx', 'png', 'jpg', 'jpeg', 'webp', 'svg']
            }
          ]
  })

  if (result.canceled || !result.filePaths.length) return { success: true, cancelled: true, attachments: [] }

  const attachments = result.filePaths
    .filter((filePath) => !secretFilePattern.test(filePath))
    .map((filePath) =>
      toPickedAttachment(
        filePath,
        kind === 'image' || imageFilePattern.test(filePath) ? 'image' : 'file'
      )
    )

  return { success: true, attachments }
}

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
      frame: false,
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
      latestPayload = null
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

  ipcMain.handle('builder-window-minimize', async () => {
    builderWindow?.minimize()
    return { success: true }
  })

  ipcMain.handle('builder-window-maximize-toggle', async () => {
    if (!builderWindow) return { success: false }
    if (builderWindow.isMaximized()) builderWindow.unmaximize()
    else builderWindow.maximize()
    return { success: true, maximized: builderWindow.isMaximized() }
  })

  ipcMain.handle('builder-window-pick-attachments', async (_, { kind }: { kind: AttachmentKind }) => {
    try {
      return await pickAttachments(kind)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Attachment pick failed.'
      }
    }
  })
}
