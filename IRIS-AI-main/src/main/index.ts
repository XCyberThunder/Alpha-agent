import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  globalShortcut,
  screen,
  session,
  safeStorage,
  systemPreferences,
  dialog,
  Tray,
  Menu
} from 'electron'
import path, { join } from 'path'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/alpha.png?asset'

import registerIpcHandlers from './logic/alpha-memory-save'
import registerSystemHandlers from './logic/get-system-info'
import registerFileSearch from './logic/file-search'
import registerFileOps from './logic/file-ops'
import registerFileWrite from './logic/file-write'
import registerFileRead from './logic/file-read'
import registerFileOpen from './logic/file-open'
import registerDirLoader from './logic/dir-load'
import registerFileScanner from './logic/file-launcher'
import registerAppLauncher from './logic/app-launcher'
import registerNotesHandlers from './logic/notes-manager'
import registerWebAgent from './logic/web-agent'
import registerGhostControl from './logic/ghost-control'
import registerterminalControl from './logic/terminal-control'
import registerGalleryHandlers from './logic/gallery-manager'
import registerGmailHandlers from './logic/gmail-manager'
import registerLocationHandlers from './logic/live-location'
import registerAdbHandlers from './logic/adb-manager'
import registerRealityHacker from './logic/reality-hacker'
import registerAlphaCoder from './services/alpha-coder'
import registerProjectBuilder from './services/project-builder'
import registerTelekinesis from './logic/telekinesis'
import registerPermanentMemory from './logic/permanent-memory'
import registerWormhole from './services/wormhole'
import registerOracle from './services/RAG-oracle'
import registerDeepResearch from './services/deep-research'
import registerWidgetMaker from './auto/widget-manager'
import registerWebsiteBuilder from './auto/website-builder'
import registerWorkflowManager from './workflow/workflow-manager'
import registerDropZoneControl from './handlers/SmartDropZone-Handler'
import registerScreenPeeler from './handlers/ScreenPeeler-handler'
import registerPhantomKeyboard from './handlers/PhantomControl-handler'
import registerSecurityVault from './security/Security'
import registerLockSystem from './security/lock-system'
import { autoUpdater } from 'electron-updater'

app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('alpha', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('alpha')
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isOverlayMode = false
let isOverlayChatOpen = false
let isQuitting = false

const secureConfigPath = join(app.getPath('userData'), 'alpha_secure_vault.json')

function encryptVaultValue(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64')
  }
  return Buffer.from(value).toString('base64')
}

function decryptVaultValue(value?: string): string {
  if (!value) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
  return Buffer.from(value, 'base64').toString('utf8')
}

function readSecureVault(): Record<string, any> {
  if (!fs.existsSync(secureConfigPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(secureConfigPath, 'utf8'))
  } catch (err) {
    return {}
  }
}

type ApiKeyGroup =
  | 'geminiBrain'
  | 'geminiAgent'
  | 'tavily'
  | 'exa'
  | 'firecrawl'
  | 'groq'
  | 'glm'
  | 'kimi'
  | 'openrouter'
type ApiKeyStatus = 'empty' | 'active' | 'available' | 'disabled' | 'failed' | 'rate-limited'
type ApiKeySlot = {
  slot: number
  key?: string
  enabled: boolean
  status: ApiKeyStatus
  lastFailureReason?: string
  lastCheckedAt?: string
  lastUsedAt?: string
}

const apiKeyGroups: ApiKeyGroup[] = [
  'geminiBrain',
  'geminiAgent',
  'tavily',
  'exa',
  'firecrawl',
  'groq',
  'glm',
  'kimi',
  'openrouter'
]

const maskApiKey = (key = '') => {
  if (!key) return ''
  if (key.length <= 10) return `${key.slice(0, 2)}***${key.slice(-2)}`
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

const normalizeKeySlots = (secureData: Record<string, any>) => {
  const keySlots = secureData.keySlots || {}
  for (const group of apiKeyGroups) {
    const slots = Array.isArray(keySlots[group]) ? keySlots[group] : []
    keySlots[group] = [1, 2, 3].map((slot) => {
      const existing = slots.find((item: ApiKeySlot) => item?.slot === slot) || {}
      return {
        slot,
        key: existing.key || '',
        enabled: typeof existing.enabled === 'boolean' ? existing.enabled : true,
        status: existing.status || (existing.key ? 'available' : 'empty'),
        lastFailureReason: existing.lastFailureReason || '',
        lastCheckedAt: existing.lastCheckedAt || '',
        lastUsedAt: existing.lastUsedAt || ''
      }
    })
  }
  secureData.keySlots = keySlots
  return keySlots as Record<ApiKeyGroup, ApiKeySlot[]>
}

const decryptKeySlot = (slot: ApiKeySlot) => decryptVaultValue(slot.key)

const getKeyStatuses = (secureData: Record<string, any>) => {
  const keySlots = normalizeKeySlots(secureData)
  return Object.fromEntries(
    apiKeyGroups.map((group) => [
      group,
      keySlots[group].map((slot) => {
        const key = decryptKeySlot(slot)
        return {
          slot: slot.slot,
          enabled: slot.enabled,
          status: slot.enabled ? slot.status : 'disabled',
          maskedKey: maskApiKey(key),
          hasKey: Boolean(key),
          lastFailureReason: slot.lastFailureReason || '',
          lastCheckedAt: slot.lastCheckedAt || '',
          lastUsedAt: slot.lastUsedAt || ''
        }
      })
    ])
  )
}

const getActiveKeySlot = (secureData: Record<string, any>, group: ApiKeyGroup) => {
  const keySlots = normalizeKeySlots(secureData)
  const slots = keySlots[group] || []
  const preferredSlot = secureData.activeKeySlots?.[group]
  const usable = slots.filter((slot) => slot.enabled && decryptKeySlot(slot))
  if (!usable.length) return null
  return (
    usable.find((slot) => slot.slot === preferredSlot && slot.status !== 'failed' && slot.status !== 'rate-limited') ||
    usable.find((slot) => slot.status === 'active') ||
    usable.find((slot) => slot.status === 'available') ||
    usable[0]
  )
}

const markActiveKeySlot = (secureData: Record<string, any>, group: ApiKeyGroup, slotNumber: number) => {
  const keySlots = normalizeKeySlots(secureData)
  secureData.activeKeySlots = secureData.activeKeySlots || {}
  secureData.activeKeySlots[group] = slotNumber
  keySlots[group] = keySlots[group].map((slot) => ({
    ...slot,
    status:
      slot.slot === slotNumber
        ? 'active'
        : slot.status === 'active'
          ? decryptKeySlot(slot)
            ? 'available'
            : 'empty'
          : slot.status
  }))
}


const defaultPlaywrightSettings = {
  enabled: false,
  browser: 'chromium',
  profilePath: '',
  headless: false,
  lastTestedAt: '',
  lastStatus: 'unknown'
}

const normalizePlaywrightSettings = (secureData: Record<string, any>) => {
  const current = secureData.playwrightSettings || {}
  secureData.playwrightSettings = {
    ...defaultPlaywrightSettings,
    ...current,
    browser: ['chromium', 'chrome', 'edge'].includes(current.browser)
      ? current.browser
      : defaultPlaywrightSettings.browser,
    enabled: Boolean(current.enabled),
    headless: Boolean(current.headless),
    profilePath: typeof current.profilePath === 'string' ? current.profilePath : ''
  }
  return secureData.playwrightSettings
}
const rotateKeySlot = (secureData: Record<string, any>, group: ApiKeyGroup) => {
  const keySlots = normalizeKeySlots(secureData)
  const slots = keySlots[group].filter(
    (slot) => slot.enabled && decryptKeySlot(slot) && slot.status !== 'failed' && slot.status !== 'rate-limited'
  )
  if (!slots.length) return null
  const current = secureData.activeKeySlots?.[group]
  const currentIndex = slots.findIndex((slot) => slot.slot === current)
  const next = slots[(currentIndex + 1 + slots.length) % slots.length]
  markActiveKeySlot(secureData, group, next.slot)
  return next
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    title: 'alpha',
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    frame: false,
    transparent: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    setOverlayMode(true)
    mainWindow?.show()
  })

  mainWindow.on('minimize' as any, (event) => {
    if (isQuitting) return
    event.preventDefault()
    setOverlayMode(true)
  })

  ipcMain.on('window-min', () => setOverlayMode(true))
  ipcMain.on('window-close', () => mainWindow?.close())
  ipcMain.on('window-max', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow() {
  if (!mainWindow) return
  mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function createTray() {
  if (tray) return
  tray = new Tray(icon)
  tray.setToolTip('alpha is running in background')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open alpha',
        click: () => showMainWindow()
      },
      {
        label: 'Mute Voice',
        click: () => mainWindow?.webContents.send('tray-mute-voice')
      },
      {
        label: 'Restart AI',
        click: () => mainWindow?.webContents.send('tray-restart-ai')
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => showMainWindow())
}

app.on('second-instance', (event, commandLine) => {
  if (!event) {
  }
  if (mainWindow) {
    showMainWindow()
    const url = commandLine.find((arg) => arg.startsWith('alpha://'))
    if (url) {
      mainWindow.webContents.send('oauth-callback', url)
    }
  }
})

function toggleOverlayMode() {
  setOverlayMode(!isOverlayMode)
}

function setOverlayMode(enabled: boolean) {
  if (!mainWindow) return
  if (isOverlayMode === enabled && enabled) {
    applyOverlayBounds()
    return
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  if (!enabled) {
    isOverlayChatOpen = false
    mainWindow.setFullScreen(false)
    mainWindow.setResizable(true)
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setSkipTaskbar(false)
    mainWindow.setBounds({ width: 950, height: 670 })
    mainWindow.center()
    mainWindow.webContents.send('overlay-mode', false)
  } else {
    mainWindow.setFullScreen(false)
    applyOverlayBounds(width, height)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setSkipTaskbar(true)
    mainWindow.setResizable(false)
    mainWindow.show()
    mainWindow.webContents.send('overlay-mode', true)
  }
  isOverlayMode = enabled
}

function applyOverlayBounds(displayWidth?: number, displayHeight?: number) {
  if (!mainWindow) return
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize
  const screenWidth = displayWidth || width
  const screenHeight = displayHeight || height
  const w = isOverlayChatOpen ? 420 : 390
  const h = isOverlayChatOpen ? 360 : 76
  mainWindow.setBounds({
    width: w,
    height: h,
    x: Math.floor(screenWidth / 2 - w / 2),
    y: screenHeight - h - 50
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.thunder.alpha')

  const appUpdateConfigPath = join(process.resourcesPath, 'app-update.yml')
  const canCheckForUpdates = !is.dev && fs.existsSync(appUpdateConfigPath)

  autoUpdater.autoDownload = canCheckForUpdates
  autoUpdater.autoInstallOnAppQuit = true

  if (canCheckForUpdates) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('Auto-updater check skipped:', err)
    })
  }

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Found',
      message: `Neural Core Update Found: v${info.version}. Downloading in background...`
    })
  })

  autoUpdater.on('error', (err) => {
    console.warn('Auto-updater error:', err == null ? 'unknown error' : err)
  })

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'New version downloaded! The system will now force reboot to apply the patch.',
        buttons: ['Execute Restart']
      })
      .then(() => {
        setImmediate(() => {
          app.removeAllListeners('window-all-closed')
          autoUpdater.quitAndInstall(false, true)
        })
      })
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowedPermissions = [
      'media',
      'audioCapture',
      'videoCapture',
      'desktopVideoCapture',
      'microphone',
      'camera'
    ]
    if (allowedPermissions.includes(permission)) {
      callback(true)
    } else {
      callback(false)
    }
  })

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const allowedPermissions = [
      'media',
      'audioCapture',
      'videoCapture',
      'desktopVideoCapture',
      'microphone',
      'camera'
    ]
    return allowedPermissions.includes(permission)
  })

  if (process.platform === 'darwin') {
    if (systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
      systemPreferences.askForMediaAccess('microphone')
    }
    if (systemPreferences.getMediaAccessStatus('camera') !== 'granted') {
      systemPreferences.askForMediaAccess('camera')
    }
  }

  ipcMain.handle(
    'secure-save-keys',
    async (_, { groqKey, geminiKey, openrouterKey, openrouterModel }) => {
    try {
      const secureData = readSecureVault()

      if (typeof groqKey === 'string') secureData.groq = encryptVaultValue(groqKey)
      if (typeof geminiKey === 'string') secureData.gemini = encryptVaultValue(geminiKey)
      if (typeof openrouterKey === 'string') secureData.openrouter = encryptVaultValue(openrouterKey)
      if (typeof openrouterModel === 'string') secureData.openrouterModel = openrouterModel
      const keySlots = normalizeKeySlots(secureData)
      if (typeof geminiKey === 'string' && geminiKey.trim()) {
        keySlots.geminiBrain[0].key = encryptVaultValue(geminiKey.trim())
        keySlots.geminiBrain[0].enabled = true
        keySlots.geminiBrain[0].status = 'available'
        markActiveKeySlot(secureData, 'geminiBrain', 1)
      }
      if (typeof openrouterKey === 'string' && openrouterKey.trim()) {
        keySlots.openrouter[0].key = encryptVaultValue(openrouterKey.trim())
        keySlots.openrouter[0].enabled = true
        keySlots.openrouter[0].status = 'available'
        markActiveKeySlot(secureData, 'openrouter', 1)
      }
      delete secureData.deepgram

      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
    }
  )

  ipcMain.handle('secure-get-keys', async () => {
    if (!fs.existsSync(secureConfigPath)) return null
    try {
      const data = readSecureVault()
      const brainSlot = getActiveKeySlot(data, 'geminiBrain')
      const agentSlot = getActiveKeySlot(data, 'geminiAgent')
      const openRouterSlot = getActiveKeySlot(data, 'openrouter')
      return {
        groqKey: decryptVaultValue(data.groq),
        geminiKey: decryptKeySlot(brainSlot || ({} as ApiKeySlot)) || decryptVaultValue(data.gemini),
        geminiBrainKey: decryptKeySlot(brainSlot || ({} as ApiKeySlot)) || decryptVaultValue(data.gemini),
        geminiBrainSlot: brainSlot?.slot || null,
        geminiAgentKey: decryptKeySlot(agentSlot || ({} as ApiKeySlot)),
        geminiAgentSlot: agentSlot?.slot || null,
        openrouterKey: decryptKeySlot(openRouterSlot || ({} as ApiKeySlot)) || decryptVaultValue(data.openrouter),
        openrouterSlot: openRouterSlot?.slot || null,
        openrouterModel: data.openrouterModel || 'glm-5.2',
        playwrightSettings: normalizePlaywrightSettings(data),
        keySlots: getKeyStatuses(data)
      }
    } catch (err) {
      return null
    }
  })

  ipcMain.handle('key-manager-list-statuses', async () => {
    const secureData = readSecureVault()
    return {
      success: true,
      statuses: getKeyStatuses(secureData),
      openrouterModel: secureData.openrouterModel || 'glm-5.2',
      playwrightSettings: normalizePlaywrightSettings(secureData)
    }
  })

  ipcMain.handle('key-manager-save-slot', async (_, { group, slot, key }) => {
    try {
      if (!apiKeyGroups.includes(group) || ![1, 2, 3].includes(Number(slot))) {
        return { success: false, error: 'Invalid key slot.' }
      }
      const secureData = readSecureVault()
      const keySlots = normalizeKeySlots(secureData)
      const target = keySlots[group as ApiKeyGroup].find((item) => item.slot === Number(slot))
      if (!target) return { success: false, error: 'Slot not found.' }
      if (typeof key === 'string' && key.trim()) {
        target.key = encryptVaultValue(key.trim())
        target.status = 'available'
        target.lastFailureReason = ''
        target.lastCheckedAt = new Date().toISOString()
      }
      target.enabled = true
      if (!secureData.activeKeySlots?.[group]) markActiveKeySlot(secureData, group, Number(slot))
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return { success: true, statuses: getKeyStatuses(secureData) }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('key-manager-set-enabled', async (_, { group, slot, enabled }) => {
    try {
      if (!apiKeyGroups.includes(group) || ![1, 2, 3].includes(Number(slot))) {
        return { success: false, error: 'Invalid key slot.' }
      }
      const secureData = readSecureVault()
      const keySlots = normalizeKeySlots(secureData)
      const target = keySlots[group as ApiKeyGroup].find((item) => item.slot === Number(slot))
      if (!target) return { success: false, error: 'Slot not found.' }
      target.enabled = Boolean(enabled)
      target.status = target.enabled ? (decryptKeySlot(target) ? 'available' : 'empty') : 'disabled'
      if (!target.enabled && secureData.activeKeySlots?.[group] === Number(slot)) {
        rotateKeySlot(secureData, group)
      }
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return { success: true, statuses: getKeyStatuses(secureData) }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('key-manager-get-active-key', async (_, group: ApiKeyGroup) => {
    try {
      if (!apiKeyGroups.includes(group)) return { success: false, error: 'Invalid key group.' }
      const secureData = readSecureVault()
      const target = getActiveKeySlot(secureData, group)
      if (!target) return { success: false, key: '', slot: null }
      target.lastUsedAt = new Date().toISOString()
      markActiveKeySlot(secureData, group, target.slot)
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return { success: true, key: decryptKeySlot(target), slot: target.slot }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('key-manager-rotate-next-key', async (_, { group, reason }) => {
    try {
      if (!apiKeyGroups.includes(group)) return { success: false, error: 'Invalid key group.' }
      const secureData = readSecureVault()
      const next = rotateKeySlot(secureData, group)
      if (next) {
        next.lastFailureReason = ''
        next.lastUsedAt = new Date().toISOString()
      }
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return {
        success: Boolean(next),
        key: next ? decryptKeySlot(next) : '',
        slot: next?.slot || null,
        statuses: getKeyStatuses(secureData)
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('key-manager-mark-failed', async (_, { group, slot, reason }) => {
    try {
      if (!apiKeyGroups.includes(group) || ![1, 2, 3].includes(Number(slot))) {
        return { success: false, error: 'Invalid key slot.' }
      }
      const secureData = readSecureVault()
      const keySlots = normalizeKeySlots(secureData)
      const target = keySlots[group as ApiKeyGroup].find((item) => item.slot === Number(slot))
      if (!target) return { success: false, error: 'Slot not found.' }
      target.status = 'failed'
      target.lastFailureReason = String(reason || 'Provider failure')
      target.lastCheckedAt = new Date().toISOString()
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return { success: true, statuses: getKeyStatuses(secureData) }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('key-manager-mark-rate-limited', async (_, { group, slot }) => {
    try {
      if (!apiKeyGroups.includes(group) || ![1, 2, 3].includes(Number(slot))) {
        return { success: false, error: 'Invalid key slot.' }
      }
      const secureData = readSecureVault()
      const keySlots = normalizeKeySlots(secureData)
      const target = keySlots[group as ApiKeyGroup].find((item) => item.slot === Number(slot))
      if (!target) return { success: false, error: 'Slot not found.' }
      target.status = 'rate-limited'
      target.lastFailureReason = 'Rate limit or quota reached'
      target.lastCheckedAt = new Date().toISOString()
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return { success: true, statuses: getKeyStatuses(secureData) }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('key-manager-test-key', async (_, { group, slot }) => {
    try {
      if (!apiKeyGroups.includes(group) || ![1, 2, 3].includes(Number(slot))) {
        return { success: false, error: 'Invalid key slot.' }
      }
      const secureData = readSecureVault()
      const keySlots = normalizeKeySlots(secureData)
      const target = keySlots[group as ApiKeyGroup].find((item) => item.slot === Number(slot))
      const key = target ? decryptKeySlot(target) : ''
      if (!target || !key) return { success: false, error: 'No key saved in this slot.' }
      target.status = target.enabled ? 'available' : 'disabled'
      target.lastCheckedAt = new Date().toISOString()
      target.lastFailureReason = ''
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return { success: true, status: target.status, maskedKey: maskApiKey(key), statuses: getKeyStatuses(secureData) }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })


  ipcMain.handle('playwright-settings-get', async () => {
    const secureData = readSecureVault()
    return { success: true, settings: normalizePlaywrightSettings(secureData) }
  })

  ipcMain.handle('playwright-settings-save', async (_, settings) => {
    try {
      const secureData = readSecureVault()
      secureData.playwrightSettings = {
        ...normalizePlaywrightSettings(secureData),
        enabled: Boolean(settings?.enabled),
        browser: ['chromium', 'chrome', 'edge'].includes(settings?.browser) ? settings.browser : 'chromium',
        profilePath: typeof settings?.profilePath === 'string' ? settings.profilePath : '',
        headless: Boolean(settings?.headless)
      }
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return { success: true, settings: secureData.playwrightSettings }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('playwright-settings-clear-profile', async () => {
    try {
      const secureData = readSecureVault()
      const settings = normalizePlaywrightSettings(secureData)
      settings.profilePath = ''
      settings.lastStatus = 'profile-cleared'
      secureData.playwrightSettings = settings
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return { success: true, settings }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('playwright-settings-test-launch', async () => {
    try {
      const secureData = readSecureVault()
      const settings = normalizePlaywrightSettings(secureData)
      settings.lastTestedAt = new Date().toISOString()
      settings.lastStatus = settings.enabled ? 'ready' : 'disabled'
      secureData.playwrightSettings = settings
      fs.writeFileSync(secureConfigPath, JSON.stringify(secureData))
      return {
        success: true,
        settings,
        message: settings.enabled
          ? `${settings.browser} automation profile is ready.`
          : 'Playwright is disabled. Enable it before launch tests.'
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('check-keys-exist', () => {
    return fs.existsSync(secureConfigPath)
  })

  ipcMain.handle('get-launch-on-startup', () => {
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('set-launch-on-startup', (_, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath
    })
    return app.getLoginItemSettings().openAtLogin
  })

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }
    delete responseHeaders['content-security-policy']
    delete responseHeaders['x-content-security-policy']
    delete responseHeaders['access-control-allow-origin']

    callback({
      responseHeaders,
      statusLine: details.statusLine
    })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (mainWindow && url.startsWith('alpha://')) {
      mainWindow.webContents.send('oauth-callback', url)
    }
  })

  registerLockSystem()
  registerSecurityVault()
  registerPhantomKeyboard()
  registerScreenPeeler()
  registerDropZoneControl(ipcMain)
  registerWorkflowManager()
  registerWebsiteBuilder()
  registerWidgetMaker()
  registerDeepResearch({ ipcMain })
  registerOracle({ ipcMain })
  registerWormhole({ ipcMain })
  registerPermanentMemory({ ipcMain, app })
  registerTelekinesis({ ipcMain })
  registerAlphaCoder({ ipcMain, app })
  registerProjectBuilder({ ipcMain })
  registerRealityHacker(ipcMain)
  registerAdbHandlers(ipcMain)
  registerLocationHandlers(ipcMain)
  registerGmailHandlers(ipcMain)
  registerGalleryHandlers(ipcMain)
  registerterminalControl(ipcMain)
  registerGhostControl(ipcMain)
  registerWebAgent(ipcMain)
  registerNotesHandlers(ipcMain)
  registerAppLauncher(ipcMain)
  registerDirLoader(ipcMain)
  registerFileOpen(ipcMain)
  registerFileSearch(ipcMain)
  registerFileRead(ipcMain)
  registerFileWrite(ipcMain)
  registerFileOps(ipcMain)
  registerFileScanner(ipcMain)
  registerSystemHandlers(ipcMain)
  registerIpcHandlers({ ipcMain, app })

  ipcMain.handle('get-screen-source', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    return sources[0]?.id
  })

  createWindow()
  createTray()

  globalShortcut.register('CommandOrControl+Shift+I', () => toggleOverlayMode())
  ipcMain.on('toggle-overlay', () => toggleOverlayMode())
  ipcMain.on('set-overlay-chat-mode', (_event, expanded: boolean) => {
    isOverlayChatOpen = Boolean(expanded)
    if (isOverlayMode) applyOverlayBounds()
  })
  ipcMain.on('activate-background-mode', () => setTimeout(() => setOverlayMode(true), 500))

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
