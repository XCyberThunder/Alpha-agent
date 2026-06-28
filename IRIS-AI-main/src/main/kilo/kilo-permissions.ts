import path from 'path'
import { KiloPermissionMode, KiloTaskOperation } from './kilo-types'

const blockedRoots = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  '.ssh',
  '.aws',
  '.gnupg',
  'appdata\\local\\google\\chrome\\user data',
  'appdata\\local\\microsoft\\edge\\user data',
  'appdata\\roaming\\mozilla\\firefox',
  'credentials',
  'credential'
]

const blockedCommandPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\b/i, reason: 'Destructive recursive delete blocked.' },
  { pattern: /\bdel\s+\/s\b/i, reason: 'Recursive delete blocked.' },
  { pattern: /\bformat\b/i, reason: 'Disk format blocked.' },
  { pattern: /\bshutdown\b/i, reason: 'Shutdown blocked.' },
  { pattern: /\breg\s+delete\b/i, reason: 'Registry delete blocked.' },
  { pattern: /\bcredential\b/i, reason: 'Credential access blocked.' },
  { pattern: /\bcookie\b/i, reason: 'Browser cookie access blocked.' },
  { pattern: /\bpowershell\b.*\b(invoke-webrequest|iwr|curl)\b.*\|\s*(iex|powershell)/i, reason: 'Download-and-execute blocked.' }
]

const installPatterns = /\b(npm|pnpm|yarn|pip|pip3|gradle|cargo)\s+(install|add|update)\b/i
const buildPatterns = /\b(npm|pnpm|yarn)\s+run\s+(build|test|lint)\b|\bgradle\s+build\b|\bpython\s+-m\s+pytest\b/i
const deletePatterns = /\b(rm|del|rmdir|remove-item)\b/i
const gitPushPatterns = /\bgit\s+push\b/i

export const normalizeProjectPath = (root: string, candidate: string) => {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return {
    resolvedRoot,
    resolvedCandidate,
    insideRoot:
      resolvedCandidate === resolvedRoot ||
      resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  }
}

export const isBlockedPath = (candidate: string) => {
  const normalized = path.resolve(candidate).toLowerCase()
  return blockedRoots.some((segment) => normalized.includes(segment))
}

export const ensureProjectScopedPath = (root: string, candidate: string) => {
  const normalized = normalizeProjectPath(root, candidate)
  if (!normalized.insideRoot) {
    return {
      allowed: false,
      error: 'Path project root ke bahar ja raha hai.'
    }
  }
  if (isBlockedPath(normalized.resolvedCandidate)) {
    return {
      allowed: false,
      error: 'Requested path protected system/private location me hai.'
    }
  }
  return {
    allowed: true,
    path: normalized.resolvedCandidate
  }
}

export const classifyCommand = (command: string) => {
  const trimmed = command.trim()
  for (const blocked of blockedCommandPatterns) {
    if (blocked.pattern.test(trimmed)) {
      return { allowed: false, level: 'blocked' as const, reason: blocked.reason }
    }
  }

  if (gitPushPatterns.test(trimmed)) {
    return { allowed: true, level: 'approval' as const, reason: 'git push explicit approval maangta hai.' }
  }
  if (deletePatterns.test(trimmed)) {
    return { allowed: true, level: 'approval' as const, reason: 'Delete command approval maangta hai.' }
  }
  if (installPatterns.test(trimmed)) {
    return { allowed: true, level: 'approval' as const, reason: 'Dependency install approval maangta hai.' }
  }
  if (buildPatterns.test(trimmed)) {
    return { allowed: true, level: 'safe' as const }
  }

  return { allowed: true, level: 'safe' as const }
}

export const evaluatePermission = (
  mode: KiloPermissionMode,
  operation: KiloTaskOperation,
  detail?: string
) => {
  if (operation === 'git-push') {
    return {
      allowed: false,
      needsApproval: true,
      reason: detail || 'Git push explicit user approval ke bina allowed nahi hai.'
    }
  }

  if (mode === 'full') {
    if (operation === 'dependency-install') {
      return {
        allowed: false,
        needsApproval: true,
        reason: 'Package install abhi bhi explicit approval maangta hai.'
      }
    }
    return { allowed: true, needsApproval: false }
  }

  if (mode === 'approve') {
    if (operation === 'file-edit' || operation === 'patch-apply') {
      return { allowed: true, needsApproval: false }
    }
    return {
      allowed: false,
      needsApproval: true,
      reason: detail || 'Ye action potential unsafe hai aur approval maangta hai.'
    }
  }

  return {
    allowed: false,
    needsApproval: true,
    reason: detail || 'Ask for approval mode me ye action confirm karna hoga.'
  }
}
