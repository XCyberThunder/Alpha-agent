import { IpcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { exec, spawn } from 'child_process'

const PROTECTED_PROCESSES = [
  'explorer.exe',
  'dwm.exe',
  'svchost.exe',
  'lsass.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'taskmgr.exe',
  'system',
  'registry'
]

const envPath = (...parts: string[]) => path.join(...parts.filter(Boolean))

const candidatePaths = {
  chrome: [
    envPath(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    envPath(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    envPath(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ],
  brave: [
    envPath(process.env.ProgramFiles || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    envPath(process.env['ProgramFiles(x86)'] || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    envPath(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
  ],
  whatsapp: [
    envPath(process.env.LOCALAPPDATA || '', 'WhatsApp', 'WhatsApp.exe'),
    envPath(process.env.ProgramFiles || '', 'WindowsApps', 'WhatsApp.exe'),
    envPath(process.env['ProgramFiles(x86)'] || '', 'WhatsApp', 'WhatsApp.exe')
  ]
}

const APP_ALIASES: Record<string, string> = {
  vscode: 'code',
  code: 'code',
  'visual studio code': 'code',
  terminal: 'wt',
  powershell: 'powershell',
  cmd: 'cmd',
  kali: 'wsl -d kali-linux',
  wsl: 'wsl',
  git: 'start git-bash',
  mongo: 'mongodbcompass',
  mongodb: 'mongodbcompass',
  postman: 'postman',
  edge: 'msedge',
  firefox: 'firefox',
  discord: 'Update.exe --processStart Discord.exe',
  spotify: 'start spotify:',
  telegram: 'start telegram:',
  tlauncher: 'TLauncher',
  minecraft: 'MinecraftLauncher',
  'cheat engine': 'Cheat Engine',
  steam: 'start steam:',
  'epic games': 'com.epicgames.launcher:',
  'live wallpaper': 'livelywpf',
  lively: 'livelywpf',
  notepad: 'notepad',
  calculator: 'calc',
  settings: 'start ms-settings:',
  explorer: 'explorer',
  files: 'explorer',
  'task manager': 'taskmgr',
  camera: 'start microsoft.windows.camera:',
  photos: 'start microsoft.windows.photos:'
}

const PROCESS_NAMES: Record<string, string> = {
  vscode: 'code.exe',
  code: 'code.exe',
  'visual studio code': 'code.exe',
  chrome: 'chrome.exe',
  'google chrome': 'chrome.exe',
  edge: 'msedge.exe',
  brave: 'brave.exe',
  firefox: 'firefox.exe',
  notepad: 'notepad.exe',
  cmd: 'cmd.exe',
  powershell: 'powershell.exe',
  terminal: 'WindowsTerminal.exe',
  whatsapp: 'WhatsApp.exe',
  discord: 'Discord.exe',
  spotify: 'Spotify.exe',
  telegram: 'Telegram.exe',
  steam: 'steam.exe',
  'epic games': 'EpicGamesLauncher.exe',
  camera: 'WindowsCamera.exe',
  calculator: 'CalculatorApp.exe',
  settings: 'SystemSettings.exe',
  'task manager': 'Taskmgr.exe',
  photos: 'Microsoft.Photos.exe',
  explorer: 'explorer.exe',
  files: 'explorer.exe'
}

const normalizeAppName = (appName: string) => {
  const lower = appName.toLowerCase().trim()
  if (lower.includes('google chrome') || lower === 'chrome') return 'chrome'
  if (lower.includes('brave')) return 'brave'
  if (lower.includes('whatsapp')) return 'whatsapp'
  if (lower.includes('vs code') || lower.includes('vscode') || lower === 'code') return 'vscode'
  if (lower.includes('powershell')) return 'powershell'
  if (lower === 'cmd' || lower.includes('command prompt')) return 'cmd'
  if (lower.includes('kali')) return 'kali'
  if (lower.includes('wsl')) return 'wsl'
  return lower
}

const existingPath = (paths: string[]) => paths.find((item) => item && fs.existsSync(item))

export default function registerAppLauncher(ipcMain: IpcMain) {
  ipcMain.removeHandler('open-app')
  ipcMain.handle('open-app', async (_event, appName: string) => {
    return new Promise((resolve) => {
      const startedAt = Date.now()
      const lowerName = normalizeAppName(appName)

      if (lowerName === 'chrome') {
        return launchKnownExecutable('chrome', appName, resolve, startedAt)
      }

      if (lowerName === 'brave') {
        return launchKnownExecutable('brave', appName, resolve, startedAt)
      }

      if (lowerName === 'whatsapp') {
        return launchWhatsAppApp(appName, resolve, startedAt)
      }

      const command = APP_ALIASES[lowerName]
      if (command) {
        executeCommand(command, appName, resolve, startedAt)
      } else {
        launchViaPowerShell(appName, resolve, startedAt)
      }
    })
  })

  ipcMain.removeHandler('close-app')
  ipcMain.handle('close-app', async (_event, appName: string) => {
    return new Promise((resolve) => {
      const lowerName = normalizeAppName(appName)
      let processName = PROCESS_NAMES[lowerName]

      if (!processName) {
        processName = appName.endsWith('.exe') ? appName : `${appName}.exe`
      }

      if (PROTECTED_PROCESSES.includes(processName.toLowerCase())) {
        resolve({
          success: false,
          error: `Security Protocol: I cannot close '${appName}' (System Critical Process). Doing so would crash your PC.`
        })
        return
      }

      const cmd = `taskkill /IM "${processName}" /F /T`

      exec(cmd, (error) => {
        if (error) {
          resolve({ success: false, error: `Could not close ${appName}. Is it running?` })
        } else {
          resolve({ success: true, message: `Terminated ${appName}` })
        }
      })
    })
  })
}

function launcherLog(input: string, type: string, target: string, startedAt: number, pathValue = '') {
  console.debug(
    `[LAUNCHER] input="${input}" type="${type}" target="${target}" path="${pathValue}" durationMs=${Date.now() - startedAt}`
  )
}

function launchKnownExecutable(appKey: 'chrome' | 'brave', appName: string, resolve: any, startedAt: number) {
  const exePath = existingPath(candidatePaths[appKey])
  if (!exePath) {
    const fallbackName = appKey === 'chrome' ? 'Google Chrome' : 'Brave'
    return launchViaPowerShell(fallbackName, resolve, startedAt, appKey)
  }

  try {
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore' })
    child.unref()
    launcherLog(appName, 'APP', appKey, startedAt, exePath)
    resolve({ success: true, message: `Opened ${appKey}` })
  } catch {
    launcherLog(appName, 'APP', appKey, startedAt, exePath)
    resolve({ success: false, error: `${appKey === 'chrome' ? 'Chrome' : 'Brave'} installed path nahi mila.` })
  }
}

function launchWhatsAppApp(appName: string, resolve: any, startedAt: number) {
  const exePath = existingPath(candidatePaths.whatsapp)
  if (exePath) {
    try {
      const child = spawn(exePath, [], { detached: true, stdio: 'ignore' })
      child.unref()
      launcherLog(appName, 'APP', 'whatsapp', startedAt, exePath)
      return resolve({ success: true, message: 'Opened WhatsApp app' })
    } catch {
      launcherLog(appName, 'APP', 'whatsapp', startedAt, exePath)
      return resolve({ success: false, error: 'WhatsApp app installed nahi mila. WhatsApp Web open karu?' })
    }
  }

  launchViaPowerShell('WhatsApp', (result: any) => {
    launcherLog(appName, 'APP', 'whatsapp', startedAt, 'StartApps')
    if (result?.success) resolve({ success: true, message: 'Opened WhatsApp app' })
    else resolve({ success: false, error: 'WhatsApp app installed nahi mila. WhatsApp Web open karu?' })
  }, startedAt, 'whatsapp')
}

function executeCommand(command: string, appName: string, resolve: any, startedAt = Date.now()) {
  exec(command, (error) => {
    launcherLog(appName, 'APP', command, startedAt)
    if (error) {
      launchViaPowerShell(appName, resolve, startedAt)
    } else {
      resolve({ success: true, message: `Opened ${appName}` })
    }
  })
}

function launchViaPowerShell(appName: string, resolve: any, startedAt = Date.now(), target = appName) {
  const safeName = appName.replace(/'/g, "''")
  const psCommand = `powershell -NoProfile -Command "Get-StartApps | Where-Object { $_.Name -like '*${safeName}*' } | Select-Object -First 1 -ExpandProperty AppID"`

  exec(psCommand, (error, stdout) => {
    if (error) {
      launcherLog(appName, 'APP', target, startedAt, 'StartApps')
      resolve({
        success: false,
        error: `Could not find '${appName}' on this system. Try opening it manually once.`
      })
      return
    }

    const appId = stdout.trim()

    if (appId) {
      const launchCmd = `start explorer "shell:AppsFolder\\${appId}"`

      exec(launchCmd, (launchErr) => {
        launcherLog(appName, 'APP', target, startedAt, `shell:AppsFolder\\${appId}`)
        if (launchErr) {
          resolve({ success: false, error: `Found app but could not launch: ${launchErr.message}` })
        } else {
          resolve({ success: true, message: `Opened ${appName} via System Search` })
        }
      })
    } else {
      launcherLog(appName, 'APP', target, startedAt, 'StartApps')
      resolve({
        success: false,
        error: `Could not find '${appName}' on this system. Try opening it manually once.`
      })
    }
  })
}
