const activateCodingMode = async () => {
  await window.electron.ipcRenderer.invoke('set-volume', 80)
  await window.electron.ipcRenderer.invoke('open-app', 'vscode')
  await window.electron.ipcRenderer.invoke(
    'google-search',
    'https://www.youtube.com/results?search_query=lofi+chill+radio+live'
  )

  await new Promise((r) => setTimeout(r, 6000))

  try {
    const screen = await window.electron.ipcRenderer.invoke('get-screen-size')
    const targetX = Math.round(screen.width * 0.35)
    const targetY = Math.round(screen.height * 0.3)
    await window.electron.ipcRenderer.invoke('ghost-click-coordinate', { x: targetX, y: targetY })
  } catch (e) {
    await window.electron.ipcRenderer.invoke('ghost-sequence', [{ type: 'click' }])
  }

  return 'Coding Mode Active: Volume 80%, VS Code Open, Lofi Playing.'
}

const inferShell = (command: string, shell?: string) => {
  if (shell) return shell
  const lowered = command.toLowerCase()
  if (
    lowered.startsWith('wsl ') ||
    lowered.includes('kali') ||
    lowered.includes('nmap ') ||
    lowered.includes('gobuster ') ||
    lowered.includes('ffuf ')
  ) {
    return 'wsl'
  }
  if (lowered.startsWith('cmd ') || lowered.includes(' /c ')) return 'cmd'
  return 'powershell'
}

const trimForGemini = (text: string, limit = 3600) => {
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, 1200)}\n...\n${text.slice(text.length - 2200)}` : text
}

const analyzeTerminalResult = (command: string, shell: string, res: any) => {
  const combined = `${res.output || ''}\n${res.error || ''}`.toLowerCase()
  const hints: string[] = []
  let category = res.success ? 'success' : 'unknown failure'

  if (/command not found|not recognized|is not recognized|not found/.test(combined)) {
    category = 'missing command or tool'
    hints.push('Check whether the tool is installed and available in PATH.')
    if (shell === 'wsl' || shell === 'kali') hints.push('For Kali/WSL, verify the distro is installed and update apt package indexes if needed.')
  }
  if (/permission denied|access is denied|unauthorized|operation not permitted/.test(combined)) {
    category = 'permission issue'
    hints.push('Retry from an elevated shell only if the task is trusted and local.')
  }
  if (/no such file|cannot find the path|path not found|enoent/.test(combined)) {
    category = 'path or cwd issue'
    hints.push('Verify the working directory and file paths before retrying.')
  }
  if (/failed to connect|network is unreachable|temporary failure|timed out|could not resolve|name resolution/.test(combined)) {
    category = 'network or DNS issue'
    hints.push('Check connectivity, target reachability, DNS, VPN/proxy, and scope.')
  }
  if (/syntax error|unexpected token|parse error|invalid option|unknown option|unrecognized option/.test(combined)) {
    category = 'syntax or flag issue'
    hints.push('Check command syntax and tool version. Use realtime lookup for updated flags if unsure.')
  }
  if (/module not found|cannot find module|missing|dependency|package .* not found/.test(combined)) {
    category = 'dependency issue'
    hints.push('Install or restore missing dependencies, then rerun the original task.')
  }
  if (/wsl.*not.*installed|no installed distributions|distribution.*not.*found|kali-linux/.test(combined)) {
    category = 'WSL/Kali routing issue'
    hints.push('Verify WSL is installed and the Kali distro name matches `wsl -l -v`.')
  }

  if (!hints.length && !res.success) {
    hints.push('Summarize the output, identify likely cause, and ask for one safe retry or run a diagnostic command.')
  }

  return {
    category,
    hints,
    output: trimForGemini(res.output || ''),
    error: trimForGemini(res.error || '')
  }
}

const runTerminal = async (command: string, path?: string, shell?: string) => {
  try {
    const selectedShell = inferShell(command, shell)
    const res = await window.electron.ipcRenderer.invoke('run-shell-command', {
      command,
      cwd: path,
      shell: selectedShell
    })

    const analysis = analyzeTerminalResult(command, selectedShell, res)

    try {
      await window.electron.ipcRenderer.invoke(
        'save-core-memory',
        [
          `Terminal workflow update: shell=${selectedShell}`,
          path ? `cwd=${path}` : 'cwd=default',
          `command=${command}`,
          `status=${res.success ? 'completed' : 'failed'}`,
          `category=${analysis.category}`,
          analysis.hints[0] ? `next=${analysis.hints[0]}` : ''
        ].join(' | ')
      )
    } catch (e) {}

    return [
      `[TERMINAL_RESULT]`,
      `shell=${selectedShell}`,
      `cwd=${res.cwd || path || 'default'}`,
      `command=${command}`,
      `success=${Boolean(res.success)}`,
      `exit_code=${res.code}`,
      `diagnosis=${analysis.category}`,
      analysis.output ? `stdout:\n${analysis.output}` : '',
      analysis.error ? `stderr:\n${analysis.error}` : '',
      analysis.hints.length ? `recovery_hints:\n- ${analysis.hints.join('\n- ')}` : '',
      res.success
        ? 'Continue the workflow from this result. Summarize only what matters.'
        : 'Do not stop passively. Explain the likely cause, choose a safe next diagnostic/fix command, and continue only when appropriate.'
    ]
      .filter(Boolean)
      .join('\n')
  } catch (e) {
    return 'Terminal workflow could not start cleanly. Try specifying PowerShell, CMD, or WSL/Kali.'
  }
}

const openInVsCode = async (path: string) => {
  try {
    return (await window.electron.ipcRenderer.invoke('open-in-vscode', path)).success
      ? 'Opened in VS Code.'
      : 'Failed to open VS Code.'
  } catch (e) {
    return 'Error'
  }
}

export { activateCodingMode, runTerminal, openInVsCode }
