import { IpcMain, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import path from 'path'

export default function registerSystemControl(ipcMain: IpcMain) {

  const sanitizePath = (inputPath: string) => {
    let clean = path.normalize(inputPath)
    if (clean.endsWith(path.sep)) clean = clean.slice(0, -1)
    return clean
  }

  const resolveShell = (command: string, shell?: string) => {
    const requested = (shell || '').toLowerCase()
    const lowered = command.toLowerCase()

    if (requested === 'cmd') return { file: 'cmd.exe', args: ['/d', '/s', '/c', command], label: 'CMD' }
    if (requested === 'wsl' || requested === 'kali' || lowered.startsWith('wsl ') || lowered.includes('kali')) {
      const distroArgs = requested === 'kali' ? ['-d', 'kali-linux'] : []
      return {
        file: 'wsl.exe',
        args: [...distroArgs, 'bash', '-lc', command.replace(/^wsl\s+/i, '')],
        label: requested === 'kali' ? 'KALI/WSL' : 'WSL'
      }
    }

    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      label: 'POWERSHELL'
    }
  }

  ipcMain.handle('run-shell-command', async (_event, { command, cwd, shell }) => {
    return new Promise((resolve) => {
      const safeCwd = cwd ? sanitizePath(cwd) : undefined

      const win = BrowserWindow.getAllWindows()[0]
      const resolved = resolveShell(command, shell)
      let stdoutBuffer = ''
      let stderrBuffer = ''
      const appendCapped = (current: string, next: string) => {
        const combined = current + next
        return combined.length > 24000 ? combined.slice(combined.length - 24000) : combined
      }

      if (win) {
        win.webContents.send(
          'terminal-data',
          `\r\n\x1b[36m[alpha ${resolved.label}] ${safeCwd || process.cwd()}>\x1b[0m ${command}\r\n`
        )
      }

      const child = spawn(resolved.file, resolved.args, {
        cwd: safeCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })

      child.stdout.on('data', (data) => {
        const output = data.toString()
        stdoutBuffer = appendCapped(stdoutBuffer, output)
        if (win) win.webContents.send('terminal-data', output)
      })

      child.stderr.on('data', (data) => {
        const output = data.toString()
        stderrBuffer = appendCapped(stderrBuffer, output)
        if (win) win.webContents.send('terminal-data', `\x1b[31m${output}\x1b[0m`)
      })

      child.on('close', (code) => {
        const msg = `\r\n[Process exited with code ${code}]\r\n`
        if (win) win.webContents.send('terminal-data', msg)
        resolve({
          success: code === 0,
          code,
          command,
          cwd: safeCwd || process.cwd(),
          shell: resolved.label,
          output: stdoutBuffer.trim(),
          error: stderrBuffer.trim()
        })
      })

      child.on('error', (err) => {
        if (win) win.webContents.send('terminal-data', `\x1b[31mTerminal launch failed. Try PowerShell, CMD, or WSL/Kali setup.\x1b[0m`)
        resolve({
          success: false,
          code: -1,
          command,
          cwd: safeCwd || process.cwd(),
          shell: resolved.label,
          output: '',
          error: err.message
        })
      })
    })
  })
}
