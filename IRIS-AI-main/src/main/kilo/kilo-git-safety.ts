import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type GitSafetyState = {
  available: boolean
  branch: string
  commit: string
  dirty: boolean
  changedFiles: string[]
  hasRemote: boolean
}

const runGit = async (projectRoot: string, args: string[]) => {
  return execFileAsync('git', ['-C', projectRoot, ...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  })
}

export const getGitSafetyState = async (projectRoot: string): Promise<GitSafetyState> => {
  try {
    const [{ stdout: branchStdout }, { stdout: commitStdout }, { stdout: statusStdout }, remoteResult] =
      await Promise.all([
        runGit(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
        runGit(projectRoot, ['rev-parse', 'HEAD']),
        runGit(projectRoot, ['status', '--short']),
        runGit(projectRoot, ['remote']).catch(() => ({ stdout: '' }))
      ])

    const changedFiles = statusStdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3).trim())

    return {
      available: true,
      branch: branchStdout.trim(),
      commit: commitStdout.trim(),
      dirty: changedFiles.length > 0,
      changedFiles,
      hasRemote: Boolean(remoteResult.stdout.trim())
    }
  } catch {
    return {
      available: false,
      branch: '',
      commit: '',
      dirty: false,
      changedFiles: [],
      hasRemote: false
    }
  }
}

export const sanitizeBackupSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task'

export const ensureBackupTag = async (projectRoot: string, slug: string) => {
  const safeSlug = sanitizeBackupSlug(slug)
  const tagName = `backup-before-kilo-${safeSlug}`
  try {
    const { stdout } = await runGit(projectRoot, ['tag', '--list', tagName])
    if (!stdout.trim()) {
      await runGit(projectRoot, ['tag', tagName])
    }
    return { success: true, tagName }
  } catch (error: any) {
    return { success: false, tagName, error: error?.message || 'Backup tag create nahi hua.' }
  }
}

export const applyUnifiedDiff = async (projectRoot: string, patchPath: string) => {
  await runGit(projectRoot, ['apply', '--check', patchPath])
  await runGit(projectRoot, ['apply', '--whitespace=nowarn', patchPath])
}
