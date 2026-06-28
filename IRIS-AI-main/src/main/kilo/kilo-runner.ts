import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { CodingTask, KiloHealthResult, KiloSettings } from './kilo-types'

export type KiloRunnerResult = {
  success: boolean
  message: string
  plan?: string[]
  files?: Array<{ path: string; content: string }>
  patch?: string
  commands?: string[]
  summary?: string
  rawOutput?: string
  error?: string
}

const parseStructuredOutput = (raw: string): KiloRunnerResult => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {
      success: false,
      message: 'Kilo output empty aaya.'
    }
  }

  try {
    const data = JSON.parse(trimmed)
    return {
      success: true,
      message: data.message || 'Kilo task complete.',
      plan: Array.isArray(data.plan) ? data.plan.map(String) : undefined,
      files: Array.isArray(data.files)
        ? data.files
            .filter((item) => item && typeof item.path === 'string' && typeof item.content === 'string')
            .map((item) => ({ path: item.path, content: item.content }))
        : undefined,
      patch: typeof data.patch === 'string' ? data.patch : undefined,
      commands: Array.isArray(data.commands) ? data.commands.map(String) : undefined,
      summary: typeof data.summary === 'string' ? data.summary : undefined,
      rawOutput: trimmed
    }
  } catch {
    const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    if (fencedJson) {
      try {
        const data = JSON.parse(fencedJson.trim())
        return {
          success: true,
          message: data.message || 'Kilo task complete.',
          plan: Array.isArray(data.plan) ? data.plan.map(String) : undefined,
          files: Array.isArray(data.files)
            ? data.files
                .filter((item) => item && typeof item.path === 'string' && typeof item.content === 'string')
                .map((item) => ({ path: item.path, content: item.content }))
            : undefined,
          patch: typeof data.patch === 'string' ? data.patch : undefined,
          commands: Array.isArray(data.commands) ? data.commands.map(String) : undefined,
          summary: typeof data.summary === 'string' ? data.summary : undefined,
          rawOutput: trimmed
        }
      } catch {
        return {
          success: false,
          message: 'Kilo output parse nahi hua.',
          rawOutput: trimmed
        }
      }
    }

    return {
      success: false,
      message: 'Kilo ne structured output return nahi kiya.',
      rawOutput: trimmed
    }
  }
}

const runCliHealth = async (commandPath: string, timeoutMs: number) => {
  return new Promise<KiloHealthResult>((resolve) => {
    const child = spawn('cmd.exe', ['/c', commandPath, '--version'], {
      windowsHide: true
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({
        success: false,
        configured: true,
        executionMode: 'cli',
        commandPath,
        message: 'Kilo CLI health check timeout hua.'
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({
        success: false,
        configured: true,
        executionMode: 'cli',
        commandPath,
        message: error.message
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        success: code === 0,
        configured: true,
        executionMode: 'cli',
        commandPath,
        message: code === 0 ? (output.trim() || 'Kilo CLI reachable.') : `Kilo CLI exit code ${code}.`,
        details: output.trim()
      })
    })
  })
}

export const kiloHealthCheck = async (settings: KiloSettings): Promise<KiloHealthResult> => {
  if (!settings.enabled) {
    return {
      success: false,
      configured: false,
      executionMode: settings.executionMode,
      commandPath: settings.commandPath,
      message: 'Kilo Code disabled hai.'
    }
  }

  if (!settings.commandPath.trim()) {
    return {
      success: false,
      configured: false,
      executionMode: settings.executionMode,
      message: 'Kilo command/path configured nahi hai.'
    }
  }

  if (settings.executionMode === 'adapter-stub') {
    return {
      success: false,
      configured: true,
      executionMode: 'adapter-stub',
      commandPath: settings.commandPath,
      message: 'Kilo adapter configured nahi hai.'
    }
  }

  if (settings.executionMode === 'local-service') {
    try {
      const endpoint = `${settings.commandPath.replace(/\/+$/, '')}/health`
      const response = await fetch(endpoint)
      const body = await response.text()
      return {
        success: response.ok,
        configured: true,
        executionMode: 'local-service',
        commandPath: settings.commandPath,
        message: response.ok ? (body.trim() || 'Kilo local service reachable.') : `Local service error ${response.status}.`,
        details: body.slice(0, 240)
      }
    } catch (error: any) {
      return {
        success: false,
        configured: true,
        executionMode: 'local-service',
        commandPath: settings.commandPath,
        message: error?.message || 'Kilo local service unreachable.'
      }
    }
  }

  return runCliHealth(settings.commandPath, settings.timeoutMs)
}

export const executeWithKiloRunner = async (
  settings: KiloSettings,
  task: CodingTask,
  abortSignal?: AbortSignal
): Promise<KiloRunnerResult> => {
  if (!settings.commandPath.trim()) {
    return {
      success: false,
      message: 'Kilo Code configured nahi hai. Settings me Kilo command/path add karo ya normal Builder provider use karo.'
    }
  }

  if (settings.executionMode === 'adapter-stub') {
    return {
      success: false,
      message: 'Kilo adapter configured nahi hai.'
    }
  }

  if (settings.executionMode === 'local-service') {
    try {
      const endpoint = `${settings.commandPath.replace(/\/+$/, '')}/execute`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
        signal: abortSignal
      })
      const body = await response.text()
      if (!response.ok) {
        return {
          success: false,
          message: `Kilo local service error ${response.status}.`,
          rawOutput: body
        }
      }
      return parseStructuredOutput(body)
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Kilo local service request failed.'
      }
    }
  }

  const payloadPath = path.join(os.tmpdir(), `alpha-kilo-task-${Date.now()}.json`)
  fs.writeFileSync(payloadPath, JSON.stringify(task, null, 2), 'utf8')

  return new Promise<KiloRunnerResult>((resolve) => {
    const child = spawn('cmd.exe', ['/c', settings.commandPath], {
      windowsHide: true,
      env: {
        ...process.env,
        ALPHA_KILO_TASK_PATH: payloadPath
      }
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({
        success: false,
        message: 'Kilo CLI timeout hua.'
      })
    }, settings.timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      if (fs.existsSync(payloadPath)) {
        fs.unlinkSync(payloadPath)
      }
    }

    abortSignal?.addEventListener('abort', () => {
      child.kill()
      cleanup()
      resolve({
        success: false,
        message: 'Kilo task cancelled.'
      })
    })

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      cleanup()
      resolve({
        success: false,
        message: error.message
      })
    })
    child.on('close', (code) => {
      cleanup()
      if (code !== 0 && !stdout.trim()) {
        resolve({
          success: false,
          message: stderr.trim() || `Kilo CLI exit code ${code}.`
        })
        return
      }
      const parsed = parseStructuredOutput(stdout || stderr)
      resolve(
        parsed.success
          ? parsed
          : {
              ...parsed,
              rawOutput: `${stdout}\n${stderr}`.trim()
            }
      )
    })

    child.stdin.write(JSON.stringify(task))
    child.stdin.end()
  })
}
