import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import {
  CodingExecutionAgent,
  CodingTask,
  CodingTaskResult,
  KiloCommandRun,
  KiloHealthResult,
  KiloPermissionMode,
  KiloSettings,
  KiloTaskRecord,
  KiloTaskStatus
} from './kilo-types'
import { classifyCommand, ensureProjectScopedPath, evaluatePermission } from './kilo-permissions'
import { applyUnifiedDiff, ensureBackupTag, getGitSafetyState, sanitizeBackupSlug } from './kilo-git-safety'
import KiloTaskStore from './kilo-task-store'
import { executeWithKiloRunner, kiloHealthCheck } from './kilo-runner'

const DEFAULT_KILO_SETTINGS: KiloSettings = {
  enabled: false,
  executionMode: 'adapter-stub',
  commandPath: '',
  workingDirectoryPolicy: 'project-only',
  timeoutMs: 120000,
  defaultPermissionMode: 'ask',
  autoGitCheckpoint: true,
  autoBuildTest: false,
  autoCommit: false,
  lastHealthStatus: 'unknown',
  lastHealthCheckAt: ''
}

const textFileExtensions = new Set([
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.txt',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.xml',
  '.yml',
  '.yaml'
])

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', 'exports'])

const debugKilo = (stage: string, payload: Record<string, unknown>) => {
  console.info(`[KILO] ${stage}`, payload)
}

export default class KiloService implements CodingExecutionAgent {
  private readonly rootPath: string
  private readonly settingsPath: string
  private readonly taskStore: KiloTaskStore
  private readonly runningChildren = new Map<string, ChildProcessWithoutNullStreams>()
  private readonly runningControllers = new Map<string, AbortController>()

  constructor() {
    this.rootPath = path.join(app.getPath('userData'), 'kilo')
    this.settingsPath = path.join(this.rootPath, 'settings.json')
    if (!fs.existsSync(this.rootPath)) {
      fs.mkdirSync(this.rootPath, { recursive: true })
    }
    this.taskStore = new KiloTaskStore(path.join(this.rootPath, 'tasks'))
  }

  getSettings(): KiloSettings {
    try {
      if (!fs.existsSync(this.settingsPath)) return { ...DEFAULT_KILO_SETTINGS }
      const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Partial<KiloSettings>
      return {
        ...DEFAULT_KILO_SETTINGS,
        ...data,
        enabled: Boolean(data.enabled),
        timeoutMs:
          typeof data.timeoutMs === 'number' && Number.isFinite(data.timeoutMs)
            ? Math.max(15000, Math.min(600000, data.timeoutMs))
            : DEFAULT_KILO_SETTINGS.timeoutMs
      }
    } catch {
      return { ...DEFAULT_KILO_SETTINGS }
    }
  }

  saveSettings(input: Partial<KiloSettings>) {
    const next = {
      ...this.getSettings(),
      ...input
    }
    fs.writeFileSync(this.settingsPath, JSON.stringify(next, null, 2), 'utf8')
    return next
  }

  async health(): Promise<KiloHealthResult> {
    const settings = this.getSettings()
    const result = await kiloHealthCheck(settings)
    this.saveSettings({
      lastHealthCheckAt: new Date().toISOString(),
      lastHealthStatus: result.success ? 'healthy' : 'error',
      lastError: result.success ? '' : result.message
    })
    return result
  }

  async testConfiguration() {
    const health = await this.health()
    if (!health.success) {
      return { success: false, message: health.message }
    }
    return {
      success: true,
      message: `Kilo ${health.executionMode} execution route ready hai.`
    }
  }

  listTasks() {
    return this.taskStore.list()
  }

  getTaskStatus(taskId: string) {
    return this.taskStore.read(taskId)
  }

  clearTaskHistory() {
    this.taskStore.clear()
    return { success: true }
  }

  async openTaskFolder() {
    const response = await this.taskStore.openFolder()
    return { success: !response, path: this.taskStore.getRootPath(), error: response || '' }
  }

  cancelTask(taskId: string) {
    const child = this.runningChildren.get(taskId)
    const controller = this.runningControllers.get(taskId)
    if (controller) controller.abort()
    if (child && !child.killed) {
      child.kill()
    }
    this.runningChildren.delete(taskId)
    this.runningControllers.delete(taskId)
    const existing = this.taskStore.read(taskId)
    if (existing) {
      this.taskStore.save({
        ...existing,
        status: 'cancelled',
        completedAt: new Date().toISOString(),
        errors: [...existing.errors, 'Task cancelled by user.']
      })
    }
    return { success: true, taskId }
  }

  async applyPatch(taskId: string, projectRoot: string, patch: string, permissionMode?: KiloPermissionMode) {
    const settings = this.getSettings()
    const mode = permissionMode || settings.defaultPermissionMode
    const permission = evaluatePermission(mode, 'patch-apply')
    if (!permission.allowed) {
      return {
        success: false,
        taskId,
        needsApproval: Boolean(permission.needsApproval),
        error: permission.reason || 'Patch apply approval required.'
      }
    }

    const patchTarget = ensureProjectScopedPath(projectRoot, projectRoot)
    if (!patchTarget.allowed) {
      return { success: false, taskId, error: patchTarget.error }
    }

    const patchPath = path.join(projectRoot, `.alpha-kilo-${taskId}.patch`)
    fs.writeFileSync(patchPath, patch, 'utf8')
    try {
      await applyUnifiedDiff(projectRoot, patchPath)
      return { success: true, taskId }
    } catch (error: any) {
      return { success: false, taskId, error: error?.message || 'Patch apply nahi hua.' }
    } finally {
      if (fs.existsSync(patchPath)) fs.unlinkSync(patchPath)
    }
  }

  async runCommand(
    taskId: string,
    projectRoot: string,
    command: string,
    permissionMode?: KiloPermissionMode
  ): Promise<{ success: boolean; command: string; output?: string; error?: string; exitCode?: number | null; needsApproval?: boolean }> {
    const settings = this.getSettings()
    const mode = permissionMode || settings.defaultPermissionMode
    const classification = classifyCommand(command)
    if (!classification.allowed) {
      return { success: false, command, error: classification.reason }
    }

    const operation =
      /\bgit\s+push\b/i.test(command)
        ? 'git-push'
        : /\binstall\b/i.test(command)
          ? 'dependency-install'
          : /\btest\b/i.test(command)
            ? 'test'
            : /\bbuild\b/i.test(command)
              ? 'build'
              : 'command'

    const permission = evaluatePermission(mode, operation, classification.reason)
    if (!permission.allowed) {
      return {
        success: false,
        command,
        needsApproval: Boolean(permission.needsApproval),
        error: permission.reason || 'Command approval required.'
      }
    }

    const scoped = ensureProjectScopedPath(projectRoot, projectRoot)
    if (!scoped.allowed) {
      return { success: false, command, error: scoped.error }
    }

    return new Promise((resolve) => {
      const child = spawn('cmd.exe', ['/c', command], {
        cwd: projectRoot,
        windowsHide: true
      })
      this.runningChildren.set(taskId, child)
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.on('error', (error) => {
        this.runningChildren.delete(taskId)
        resolve({ success: false, command, error: error.message })
      })
      child.on('close', (code) => {
        this.runningChildren.delete(taskId)
        resolve({
          success: code === 0,
          command,
          output: stdout,
          error: stderr || undefined,
          exitCode: code
        })
      })
    })
  }

  async executeCodingTask(task: CodingTask): Promise<CodingTaskResult> {
    const settings = this.getSettings()
    const taskId = `kilo-${Date.now()}`
    const now = new Date().toISOString()
    const permissionMode = task.permissionMode || settings.defaultPermissionMode
    const baseRecord: KiloTaskRecord = {
      taskId,
      prompt: task.prompt,
      projectRoot: task.projectRoot,
      projectId: task.projectId,
      status: 'inspecting',
      startedAt: now,
      selectedFiles: task.selectedFiles || [],
      filesChanged: [],
      commandsRun: [],
      errors: [],
      provider: 'Kilo Code'
    }
    this.taskStore.save(baseRecord)

    if (!settings.enabled) {
      return this.finishTask(baseRecord, {
        success: false,
        taskId,
        status: 'failed',
        filesChanged: [],
        commandsRun: [],
        error: 'Kilo Code disabled hai. Settings me enable karo ya normal Builder provider use karo.'
      })
    }

    const scopedRoot = ensureProjectScopedPath(task.projectRoot, task.projectRoot)
    if (!scopedRoot.allowed) {
      return this.finishTask(baseRecord, {
        success: false,
        taskId,
        status: 'failed',
        filesChanged: [],
        commandsRun: [],
        error: scopedRoot.error
      })
    }

    const gitState = await getGitSafetyState(task.projectRoot)
    if (gitState.available && gitState.dirty && permissionMode === 'ask') {
      return this.finishTask(baseRecord, {
        success: false,
        taskId,
        status: 'awaiting_approval',
        filesChanged: [],
        commandsRun: [],
        error: 'Repo me uncommitted changes hain. Backup commit karu ya task stop karu?',
        needsApproval: true
      })
    }
    let backupTag = ''
    if (settings.autoGitCheckpoint && gitState.available) {
      const tagResult = await ensureBackupTag(task.projectRoot, sanitizeBackupSlug(task.prompt))
      if (tagResult.success) backupTag = tagResult.tagName
    }

    const currentFiles = task.currentFiles?.length ? task.currentFiles : this.readProjectFiles(task.projectRoot)
    const controller = new AbortController()
    this.runningControllers.set(taskId, controller)

    debugKilo('execute-task', {
      taskId,
      projectRoot: task.projectRoot,
      promptLength: task.prompt.length,
      selectedFiles: task.selectedFiles?.length || 0,
      executionMode: settings.executionMode
    })

    const runnerResult = await executeWithKiloRunner(
      settings,
      {
        ...task,
        permissionMode,
        currentFiles
      },
      controller.signal
    )

    this.runningControllers.delete(taskId)

    if (!runnerResult.success) {
      return this.finishTask(baseRecord, {
        success: false,
        taskId,
        status: 'failed',
        filesChanged: [],
        commandsRun: [],
        error: runnerResult.message || runnerResult.error || 'Kilo task failed.',
        backupTag
      })
    }

    const filesChanged: string[] = []
    const commandRuns: KiloCommandRun[] = []

    if (runnerResult.patch) {
      const patchResult = await this.applyPatch(taskId, task.projectRoot, runnerResult.patch, permissionMode)
      if (!patchResult.success) {
        return this.finishTask(baseRecord, {
          success: false,
          taskId,
          status: patchResult.needsApproval ? 'awaiting_approval' : 'failed',
          filesChanged,
          commandsRun: commandRuns,
          error: patchResult.error,
          needsApproval: patchResult.needsApproval,
          backupTag
        })
      }
    }

    if (runnerResult.files?.length) {
      const permission = evaluatePermission(permissionMode, 'file-edit')
      if (!permission.allowed) {
        return this.finishTask(baseRecord, {
          success: false,
          taskId,
          status: 'awaiting_approval',
          filesChanged,
          commandsRun: commandRuns,
          error: permission.reason || 'File edits approval required.',
          needsApproval: true,
          backupTag
        })
      }
      for (const file of runnerResult.files) {
        const target = ensureProjectScopedPath(task.projectRoot, path.join(task.projectRoot, file.path))
        if (!target.allowed) {
          return this.finishTask(baseRecord, {
            success: false,
            taskId,
            status: 'failed',
            filesChanged,
            commandsRun: commandRuns,
            error: target.error,
            backupTag
          })
        }
        const targetPath = target.path as string
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, file.content, 'utf8')
        filesChanged.push(file.path)
      }
    }

    for (const command of runnerResult.commands || []) {
      const commandResult = await this.runCommand(taskId, task.projectRoot, command, permissionMode)
      if (!commandResult.success) {
        return this.finishTask(baseRecord, {
          success: false,
          taskId,
          status: commandResult.needsApproval ? 'awaiting_approval' : 'failed',
          filesChanged,
          commandsRun: commandRuns,
          error: commandResult.error,
          needsApproval: commandResult.needsApproval,
          backupTag
        })
      }
      commandRuns.push({
        command,
        stdout: commandResult.output || '',
        stderr: commandResult.error || '',
        exitCode: commandResult.exitCode ?? 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      })
    }

    const resultingFiles = this.readProjectFiles(task.projectRoot)

    return this.finishTask(baseRecord, {
      success: true,
      taskId,
      status: 'completed',
      plan: runnerResult.plan,
      summary: runnerResult.summary || runnerResult.message,
      filesChanged,
      resultingFiles,
      commandsRun: commandRuns,
      stdout: commandRuns.map((item) => item.stdout).filter(Boolean).join('\n\n'),
      stderr: commandRuns.map((item) => item.stderr).filter(Boolean).join('\n\n'),
      exitCode: commandRuns.length ? commandRuns[commandRuns.length - 1].exitCode : 0,
      backupTag
    })
  }

  private finishTask(record: KiloTaskRecord, result: CodingTaskResult) {
    this.taskStore.save({
      ...record,
      status: result.status,
      completedAt: new Date().toISOString(),
      filesChanged: result.filesChanged,
      commandsRun: result.commandsRun,
      buildResult: result.buildResult,
      testResult: result.testResult,
      errors: result.error ? [...record.errors, result.error] : record.errors,
      summary: result.summary,
      backupTag: result.backupTag,
      gitCommit: result.commitHash
    })
    return result
  }

  private readProjectFiles(projectRoot: string) {
    const collected: Array<{ path: string; content: string }> = []
    const walk = (currentPath: string) => {
      for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (ignoredDirectories.has(entry.name)) continue
          walk(path.join(currentPath, entry.name))
          continue
        }
        const extension = path.extname(entry.name).toLowerCase()
        if (!textFileExtensions.has(extension)) continue
        const absolute = path.join(currentPath, entry.name)
        const relative = path.relative(projectRoot, absolute).replace(/\\/g, '/')
        if (relative === 'project.json') continue
        collected.push({
          path: relative,
          content: fs.readFileSync(absolute, 'utf8')
        })
      }
    }
    walk(projectRoot)
    return collected
  }
}
