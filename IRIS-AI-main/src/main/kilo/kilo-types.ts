export type KiloExecutionMode = 'cli' | 'local-service' | 'adapter-stub'

export type KiloPermissionMode = 'ask' | 'approve' | 'full'

export type KiloWorkingDirectoryPolicy = 'project-only' | 'workspace-only' | 'user-approved'

export type KiloTaskStatus =
  | 'idle'
  | 'inspecting'
  | 'checking_git'
  | 'reading_files'
  | 'planning'
  | 'awaiting_approval'
  | 'applying_patch'
  | 'running_commands'
  | 'running_build'
  | 'running_tests'
  | 'fixing_errors'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type KiloTaskOperation =
  | 'file-edit'
  | 'file-delete'
  | 'patch-apply'
  | 'command'
  | 'dependency-install'
  | 'build'
  | 'test'
  | 'git-commit'
  | 'git-push'

export type KiloSettings = {
  enabled: boolean
  executionMode: KiloExecutionMode
  commandPath: string
  workingDirectoryPolicy: KiloWorkingDirectoryPolicy
  timeoutMs: number
  defaultPermissionMode: KiloPermissionMode
  autoGitCheckpoint: boolean
  autoBuildTest: boolean
  autoCommit: boolean
  lastHealthCheckAt?: string
  lastHealthStatus?: string
  lastError?: string
}

export type CodingTask = {
  prompt: string
  projectRoot: string
  projectId?: string
  currentFiles?: Array<{ path: string; content: string }>
  selectedFiles?: string[]
  permissionMode?: KiloPermissionMode
  source?: 'builder' | 'chat' | 'hermes'
  allowBuild?: boolean
  allowTests?: boolean
  allowInstall?: boolean
}

export type KiloTaskProgress = {
  status: KiloTaskStatus
  message: string
  startedAt: string
  updatedAt: string
}

export type KiloCommandRun = {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  startedAt: string
  completedAt: string
}

export type CodingTaskResult = {
  success: boolean
  taskId: string
  status: KiloTaskStatus
  plan?: string[]
  summary?: string
  filesChanged: string[]
  resultingFiles?: Array<{ path: string; content: string }>
  commandsRun: KiloCommandRun[]
  stdout?: string
  stderr?: string
  exitCode?: number | null
  buildResult?: string
  testResult?: string
  commitHash?: string
  backupTag?: string
  error?: string
  needsApproval?: boolean
  approvalReason?: string
}

export type KiloTaskRecord = {
  taskId: string
  prompt: string
  projectRoot: string
  projectId?: string
  status: KiloTaskStatus
  startedAt: string
  completedAt?: string
  selectedFiles: string[]
  filesChanged: string[]
  commandsRun: KiloCommandRun[]
  buildResult?: string
  testResult?: string
  errors: string[]
  summary?: string
  gitCommit?: string
  backupTag?: string
  provider?: string
}

export type KiloHealthResult = {
  success: boolean
  executionMode: KiloExecutionMode
  configured: boolean
  message: string
  commandPath?: string
  details?: string
}

export interface CodingExecutionAgent {
  executeCodingTask(task: CodingTask): Promise<CodingTaskResult>
}
