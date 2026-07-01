import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { spawn, type ChildProcessWithoutNullStreams, execFile } from 'child_process'
import { promisify } from 'util'
import { app, BrowserWindow, dialog, type IpcMain, shell as electronShell } from 'electron'

type WorkspaceNode = {
  name: string
  path: string
  type: 'file' | 'folder'
  ext?: string
  children?: WorkspaceNode[]
}

type WorkspaceSummary = {
  name: string
  path: string
  lastOpenedAt: string
  available: boolean
}

type WorkspaceSnapshot = {
  path: string
  name: string
  tree: WorkspaceNode[]
  branch: string | null
}

type WorkspaceSearchResult = {
  filePath: string
  fileName: string
  line: number
  preview: string
}

type BuilderWorkspaceStore = {
  lastWorkspacePath: string | null
  recentWorkspaces: WorkspaceSummary[]
}

type TerminalSession = {
  id: string
  process: ChildProcessWithoutNullStreams
  webContentsId: number
}

const execFileAsync = promisify(execFile)
const STORE_FILE = path.join(app.getPath('userData'), 'builder-workspace.json')
const MAX_RECENT = 12
const terminalSessions = new Map<string, TerminalSession>()
const SEARCH_IGNORES = new Set(['node_modules', '.git', 'dist', 'build', '.alpha-backups'])

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const ensureStore = (): BuilderWorkspaceStore => {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      const initial: BuilderWorkspaceStore = { lastWorkspacePath: null, recentWorkspaces: [] }
      fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf8')
      return initial
    }
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as Partial<BuilderWorkspaceStore>
    return {
      lastWorkspacePath: parsed.lastWorkspacePath || null,
      recentWorkspaces: Array.isArray(parsed.recentWorkspaces) ? parsed.recentWorkspaces : []
    }
  } catch {
    return { lastWorkspacePath: null, recentWorkspaces: [] }
  }
}

const writeStore = (store: BuilderWorkspaceStore) => {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8')
}

const normalizeRecent = (items: WorkspaceSummary[]) =>
  items
    .filter((item) => item.path)
    .reduce<WorkspaceSummary[]>((acc, item) => {
      if (acc.some((entry) => entry.path === item.path)) return acc
      acc.push(item)
      return acc
    }, [])
    .slice(0, MAX_RECENT)

const updateRecentWorkspace = (workspacePath: string) => {
  const store = ensureStore()
  const summary: WorkspaceSummary = {
    name: path.basename(workspacePath) || workspacePath,
    path: workspacePath,
    lastOpenedAt: new Date().toISOString(),
    available: fs.existsSync(workspacePath)
  }
  store.lastWorkspacePath = workspacePath
  store.recentWorkspaces = normalizeRecent([summary, ...store.recentWorkspaces.filter((item) => item.path !== workspacePath)])
  writeStore(store)
  return store
}

const refreshRecentAvailability = () => {
  const store = ensureStore()
  store.recentWorkspaces = store.recentWorkspaces.map((item) => ({
    ...item,
    available: fs.existsSync(item.path)
  }))
  if (store.lastWorkspacePath && !fs.existsSync(store.lastWorkspacePath)) {
    store.lastWorkspacePath = null
  }
  writeStore(store)
  return store
}

const isDirectory = async (targetPath: string) => {
  try {
    const stats = await fsp.stat(targetPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

const sortNodes = (nodes: WorkspaceNode[]) => {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const node of nodes) {
    if (node.children) sortNodes(node.children)
  }
}

const readWorkspaceTree = async (rootPath: string): Promise<WorkspaceNode[]> => {
  const readDirRecursive = async (dirPath: string): Promise<WorkspaceNode[]> => {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    const nodes: WorkspaceNode[] = []

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isSymbolicLink()) continue

      if (entry.isDirectory()) {
        if (SEARCH_IGNORES.has(entry.name)) continue
        const children = await readDirRecursive(fullPath)
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: 'folder',
          children
        })
      } else if (entry.isFile()) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          ext: path.extname(entry.name).replace(/^\./, '').toLowerCase()
        })
      }
    }

    sortNodes(nodes)
    return nodes
  }

  return readDirRecursive(rootPath)
}

const isProbablyBinary = (buffer: Buffer) => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000))
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}

const searchWorkspace = async (workspacePath: string, query: string): Promise<WorkspaceSearchResult[]> => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  const results: WorkspaceSearchResult[] = []

  const walk = async (dirPath: string): Promise<void> => {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SEARCH_IGNORES.has(entry.name)) continue
        await walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue

      try {
        const stats = await fsp.stat(fullPath)
        if (stats.size > 1024 * 1024) continue
        const raw = await fsp.readFile(fullPath)
        if (isProbablyBinary(raw)) continue
        const text = raw.toString('utf8')
        const lines = text.split(/\r?\n/)
        lines.forEach((lineText, index) => {
          if (!lineText.toLowerCase().includes(normalizedQuery)) return
          results.push({
            filePath: fullPath,
            fileName: path.basename(fullPath),
            line: index + 1,
            preview: lineText.trim().slice(0, 240)
          })
        })
      } catch {
        // ignore unreadable files
      }
    }
  }

  await walk(workspacePath)
  return results.slice(0, 500)
}

const getGitBranch = async (workspacePath: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('git', ['-C', workspacePath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      windowsHide: true
    })
    const branch = stdout.trim()
    return branch || null
  } catch {
    return null
  }
}

const buildWorkspaceSnapshot = async (workspacePath: string): Promise<WorkspaceSnapshot> => {
  const tree = await readWorkspaceTree(workspacePath)
  const branch = await getGitBranch(workspacePath)
  return {
    path: workspacePath,
    name: path.basename(workspacePath) || workspacePath,
    tree,
    branch
  }
}

const assertInsideWorkspace = (workspacePath: string, targetPath: string) => {
  const relative = path.relative(workspacePath, targetPath)
  if (!relative || relative === '') return
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Target path is outside the current workspace.')
  }
}

const assertNotWorkspaceRoot = (workspacePath: string, targetPath: string) => {
  const normalizedWorkspace = path.resolve(workspacePath)
  const normalizedTarget = path.resolve(targetPath)
  if (normalizedWorkspace === normalizedTarget) {
    throw new Error('Workspace root cannot be deleted.')
  }
}

const pickWindow = () => BrowserWindow.getFocusedWindow()

const sendTerminalEvent = (webContentsId: number, payload: Record<string, unknown>) => {
  const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === webContentsId)
  if (!window || window.isDestroyed()) return
  window.webContents.send('builder-workspace-terminal-event', payload)
}

const resolveShell = () => {
  if (process.platform === 'win32') {
    const pwsh = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (fs.existsSync(pwsh)) return { command: pwsh, args: ['-NoLogo'] }
    return { command: process.env.ComSpec || 'cmd.exe', args: [] }
  }

  const preferred = process.env.SHELL
  if (preferred) return { command: preferred, args: [] }
  return { command: '/bin/bash', args: [] }
}

const disposeTerminalSession = (sessionId: string) => {
  const session = terminalSessions.get(sessionId)
  if (!session) return
  try {
    session.process.kill()
  } catch {
    // ignore
  }
  terminalSessions.delete(sessionId)
}

export default function registerBuilderWorkspace(ipcMain: IpcMain) {
  ipcMain.handle('builder-workspace:get-state', async () => {
    const store = refreshRecentAvailability()
    let workspace: WorkspaceSnapshot | null = null

    if (store.lastWorkspacePath && fs.existsSync(store.lastWorkspacePath) && (await isDirectory(store.lastWorkspacePath))) {
      workspace = await buildWorkspaceSnapshot(store.lastWorkspacePath)
    }

    return {
      success: true,
      workspace,
      lastWorkspacePath: store.lastWorkspacePath,
      recentWorkspaces: store.recentWorkspaces
    }
  })

  ipcMain.handle('builder-workspace:open-folder-dialog', async () => {
    const parent = pickWindow()
    const result = await (parent
      ? dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }))

    if (result.canceled || !result.filePaths.length) {
      return { success: true, cancelled: true }
    }

    const workspacePath = result.filePaths[0]
    const snapshot = await buildWorkspaceSnapshot(workspacePath)
    const store = updateRecentWorkspace(workspacePath)
    return {
      success: true,
      workspace: snapshot,
      lastWorkspacePath: store.lastWorkspacePath,
      recentWorkspaces: store.recentWorkspaces
    }
  })

  ipcMain.handle('builder-workspace:open-workspace', async (_, { workspacePath }: { workspacePath: string }) => {
    if (!workspacePath || !(await isDirectory(workspacePath))) {
      return { success: false, error: 'Workspace folder not found.' }
    }

    const snapshot = await buildWorkspaceSnapshot(workspacePath)
    const store = updateRecentWorkspace(workspacePath)
    return {
      success: true,
      workspace: snapshot,
      lastWorkspacePath: store.lastWorkspacePath,
      recentWorkspaces: store.recentWorkspaces
    }
  })

  ipcMain.handle('builder-workspace:clear-recents', async () => {
    const store = ensureStore()
    store.recentWorkspaces = []
    writeStore(store)
    return { success: true, recentWorkspaces: [] as WorkspaceSummary[] }
  })

  ipcMain.handle('builder-workspace:open-file-dialog', async (_, { workspacePath }: { workspacePath?: string }) => {
    const parent = pickWindow()
    const result = await (parent
      ? dialog.showOpenDialog(parent, {
          properties: ['openFile'],
          defaultPath: workspacePath && fs.existsSync(workspacePath) ? workspacePath : undefined
        })
      : dialog.showOpenDialog({
          properties: ['openFile'],
          defaultPath: workspacePath && fs.existsSync(workspacePath) ? workspacePath : undefined
        }))

    if (result.canceled || !result.filePaths.length) {
      return { success: true, cancelled: true }
    }

    const filePath = result.filePaths[0]
    const content = await fsp.readFile(filePath, 'utf8')
    return {
      success: true,
      file: {
        path: filePath,
        name: path.basename(filePath),
        content
      }
    }
  })

  ipcMain.handle('builder-workspace:read-file', async (_, { filePath }: { filePath: string }) => {
    try {
      const content = await fsp.readFile(filePath, 'utf8')
      return {
        success: true,
        file: {
          path: filePath,
          name: path.basename(filePath),
          content
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read file.'
      }
    }
  })

  ipcMain.handle(
    'builder-workspace:write-file',
    async (_, { filePath, content }: { filePath: string; content: string }) => {
      try {
        await fsp.writeFile(filePath, content, 'utf8')
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to write file.'
        }
      }
    }
  )

  ipcMain.handle(
    'builder-workspace:create-file',
    async (
      _,
      { workspacePath, parentPath, name }: { workspacePath: string; parentPath?: string; name: string }
    ) => {
      try {
        if (!(await isDirectory(workspacePath))) {
          return { success: false, error: 'Workspace folder not found.' }
        }

        const basePath = parentPath && fs.existsSync(parentPath) ? parentPath : workspacePath
        assertInsideWorkspace(workspacePath, basePath)
        const filePath = path.join(basePath, name)
        assertInsideWorkspace(workspacePath, filePath)

        if (fs.existsSync(filePath)) {
          return { success: false, error: 'File already exists.' }
        }

        await fsp.writeFile(filePath, '', 'utf8')
        const workspace = await buildWorkspaceSnapshot(workspacePath)
        return {
          success: true,
          workspace,
          file: {
            path: filePath,
            name: path.basename(filePath),
            content: ''
          }
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create file.'
        }
      }
    }
  )

  ipcMain.handle(
    'builder-workspace:create-folder',
    async (
      _,
      { workspacePath, parentPath, name }: { workspacePath: string; parentPath?: string; name: string }
    ) => {
      try {
        if (!(await isDirectory(workspacePath))) {
          return { success: false, error: 'Workspace folder not found.' }
        }

        const basePath = parentPath && fs.existsSync(parentPath) ? parentPath : workspacePath
        assertInsideWorkspace(workspacePath, basePath)
        const folderPath = path.join(basePath, name)
        assertInsideWorkspace(workspacePath, folderPath)

        if (fs.existsSync(folderPath)) {
          return { success: false, error: 'Folder already exists.' }
        }

        await fsp.mkdir(folderPath, { recursive: false })
        const workspace = await buildWorkspaceSnapshot(workspacePath)
        return { success: true, workspace }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create folder.'
        }
      }
    }
  )

  ipcMain.handle(
    'builder-workspace:delete-path',
    async (_, { targetPath, workspacePath }: { targetPath: string; workspacePath?: string | null }) => {
      try {
        if (!targetPath || !fs.existsSync(targetPath)) {
          return { success: false, error: 'Selected path not found.' }
        }

        const resolvedTarget = path.resolve(targetPath)
        let workspace: WorkspaceSnapshot | null = null

        if (workspacePath) {
          if (!(await isDirectory(workspacePath))) {
            return { success: false, error: 'Workspace folder not found.' }
          }
          assertInsideWorkspace(workspacePath, resolvedTarget)
          assertNotWorkspaceRoot(workspacePath, resolvedTarget)
        }

        const stats = await fsp.stat(resolvedTarget)
        if (stats.isDirectory()) {
          await fsp.rm(resolvedTarget, { recursive: true, force: false })
        } else {
          await fsp.unlink(resolvedTarget)
        }

        if (workspacePath && fs.existsSync(workspacePath)) {
          workspace = await buildWorkspaceSnapshot(workspacePath)
        }

        return {
          success: true,
          deletedPath: resolvedTarget,
          workspace
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete path.'
        }
      }
    }
  )

  ipcMain.handle('builder-workspace:refresh', async (_, { workspacePath }: { workspacePath: string }) => {
    try {
      if (!(await isDirectory(workspacePath))) {
        return { success: false, error: 'Workspace folder not found.' }
      }
      const workspace = await buildWorkspaceSnapshot(workspacePath)
      return { success: true, workspace }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh workspace.'
      }
    }
  })

  ipcMain.handle(
    'builder-workspace:search',
    async (_, { workspacePath, query }: { workspacePath?: string; query: string }) => {
      try {
        if (!workspacePath || !(await isDirectory(workspacePath))) {
          return { success: false, error: 'Open a folder to search.' }
        }
        const results = await searchWorkspace(workspacePath, query)
        return { success: true, results }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Search failed.'
        }
      }
    }
  )

  ipcMain.handle('builder-workspace:reveal-path', async (_, { targetPath }: { targetPath: string }) => {
    try {
      electronShell.showItemInFolder(targetPath)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reveal path.'
      }
    }
  })

  ipcMain.handle('builder-workspace:terminal-open', async (event, { workspacePath }: { workspacePath?: string }) => {
    const cwd =
      workspacePath && fs.existsSync(workspacePath) && fs.statSync(workspacePath).isDirectory()
        ? workspacePath
        : app.getPath('documents')
    const { command, args } = resolveShell()
    const sessionId = makeId()
    const child = spawn(command, args, {
      cwd,
      stdio: 'pipe',
      windowsHide: true,
      env: process.env
    })

    terminalSessions.set(sessionId, {
      id: sessionId,
      process: child,
      webContentsId: event.sender.id
    })

    child.stdout.on('data', (chunk) => {
      sendTerminalEvent(event.sender.id, {
        sessionId,
        type: 'stdout',
        text: chunk.toString()
      })
    })

    child.stderr.on('data', (chunk) => {
      sendTerminalEvent(event.sender.id, {
        sessionId,
        type: 'stderr',
        text: chunk.toString()
      })
    })

    child.on('close', (exitCode) => {
      sendTerminalEvent(event.sender.id, {
        sessionId,
        type: 'exit',
        exitCode
      })
      terminalSessions.delete(sessionId)
    })

    child.on('error', (error) => {
      sendTerminalEvent(event.sender.id, {
        sessionId,
        type: 'error',
        text: error.message
      })
    })

    return {
      success: true,
      sessionId,
      shell: path.basename(command),
      cwd
    }
  })

  ipcMain.handle(
    'builder-workspace:terminal-input',
    async (_, { sessionId, input }: { sessionId: string; input: string }) => {
      const session = terminalSessions.get(sessionId)
      if (!session) return { success: false, error: 'Terminal session not found.' }
      session.process.stdin.write(input)
      return { success: true }
    }
  )

  ipcMain.handle('builder-workspace:terminal-dispose', async (_, { sessionId }: { sessionId: string }) => {
    disposeTerminalSession(sessionId)
    return { success: true }
  })
}
