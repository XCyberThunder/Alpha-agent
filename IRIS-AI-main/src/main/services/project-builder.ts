import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app, IpcMain, safeStorage, shell } from 'electron'

type ProjectFile = {
  path: string
  content: string
}

type ProjectMetadata = {
  id: string
  name: string
  type: string
  createdAt: string
  updatedAt: string
  modelUsed: string
  files: string[]
  lastPrompt: string
  projectPath: string
}

type ProjectState = {
  metadata: ProjectMetadata
  files: ProjectFile[]
}

type KeySlot = {
  slot: number
  key?: string
  enabled: boolean
  status: string
  lastFailureReason?: string
  lastCheckedAt?: string
  lastUsedAt?: string
}

const execFileAsync = promisify(execFile)

const PROJECT_MODEL = 'glm-5.2'

const projectTypeRules: Array<{ type: string; pattern: RegExp }> = [
  { type: 'website', pattern: /\b(website|landing page|portfolio|frontend|html|css|javascript site)\b/i },
  { type: 'react', pattern: /\breact\b/i },
  { type: 'electron', pattern: /\belectron\b/i },
  { type: 'node', pattern: /\bnode(\.js)?\b/i },
  { type: 'python', pattern: /\bpython\b/i },
  { type: 'typescript', pattern: /\btypescript|\bts\b/i },
  { type: 'javascript', pattern: /\bjavascript|\bjs\b/i },
  { type: 'java', pattern: /\bjava\b/i },
  { type: 'cpp', pattern: /\bc\+\+|\bcpp\b/i },
  { type: 'c', pattern: /\bc(?:\s+code)?\b/i }
]

const ensureDir = (targetPath: string) => {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true })
  }
}

const slugify = (input: string) =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'alpha-project'

const detectProjectType = (prompt: string) => {
  for (const rule of projectTypeRules) {
    if (rule.pattern.test(prompt)) return rule.type
  }
  return 'website'
}

const guessProjectName = (prompt: string, type: string) => {
  const cleaned = prompt
    .replace(/\b(banao|banado|create|make|build|generate|please|alpha|project|website|simple)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return slugify(cleaned || `${type}-project`)
}

const loadJson = (value: string) => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const extractJson = (raw: string) => {
  const direct = loadJson(raw)
  if (direct) return direct

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const parsed = loadJson(fenced[1].trim())
    if (parsed) return parsed
  }

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return loadJson(raw.slice(start, end + 1))
  }

  return null
}

const inlinePreviewHtml = (files: ProjectFile[]) => {
  const htmlFile =
    files.find((file) => file.path === 'index.html') ||
    files.find((file) => file.path.endsWith('/index.html'))

  if (!htmlFile) return ''

  let html = htmlFile.content
  const cssFile =
    files.find((file) => file.path === 'style.css') ||
    files.find((file) => file.path.endsWith('/style.css'))
  const jsFile =
    files.find((file) => file.path === 'script.js') ||
    files.find((file) => file.path.endsWith('/script.js'))

  if (cssFile) {
    html = html.replace(
      /<link[^>]+href=["'][^"']*style\.css["'][^>]*>/i,
      `<style>\n${cssFile.content}\n</style>`
    )
  }

  if (jsFile) {
    html = html.replace(
      /<script[^>]+src=["'][^"']*script\.js["'][^>]*><\/script>/i,
      `<script>\n${jsFile.content}\n</script>`
    )
  }

  return html
}

const normalizeFiles = (payload: any, prompt: string, projectType: string): ProjectFile[] => {
  const incoming = Array.isArray(payload?.files) ? payload.files : []
  const files = incoming
    .filter((file) => typeof file?.path === 'string' && typeof file?.content === 'string')
    .map((file) => ({
      path: file.path.replace(/\\/g, '/').replace(/^\/+/, ''),
      content: file.content
    }))

  if (files.length) return files

  if (projectType === 'website') {
    return [
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>alpha project</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">alpha builder fallback</p>
        <h1>${prompt}</h1>
        <p>A minimal project scaffold was created because the GLM response did not include files.</p>
      </section>
    </main>
    <script src="script.js"></script>
  </body>
</html>`
      },
      {
        path: 'style.css',
        content:
          'body{margin:0;font-family:Inter,system-ui;background:#07111f;color:#e6f2ff}.shell{min-height:100vh;display:grid;place-items:center;padding:48px}.hero{max-width:720px;background:rgba(9,22,42,.72);border:1px solid rgba(103,232,249,.18);border-radius:24px;padding:32px;backdrop-filter:blur(18px)}.eyebrow{text-transform:uppercase;letter-spacing:.16em;color:#67e8f9;font-size:12px}'
      },
      {
        path: 'script.js',
        content: "console.log('alpha project scaffold ready')"
      },
      {
        path: 'README.md',
        content: `# alpha project\n\nPrompt: ${prompt}\n`
      }
    ]
  }

  return [
    {
      path: 'README.md',
      content: `# alpha project\n\nPrompt: ${prompt}\n\nProject type: ${projectType}\n`
    }
  ]
}

const safeProjectFilePath = (projectPath: string, relativeFilePath: string) => {
  const resolved = path.resolve(projectPath, relativeFilePath)
  if (!resolved.startsWith(projectPath)) {
    throw new Error(`Unsafe file path rejected: ${relativeFilePath}`)
  }
  return resolved
}

export default function registerProjectBuilder({ ipcMain }: { ipcMain: IpcMain }) {
  const userDataPath = app.getPath('userData')
  const projectsRoot = path.resolve(userDataPath, 'projects')
  const secureConfigPath = path.join(userDataPath, 'alpha_secure_vault.json')
  ensureDir(projectsRoot)

  const decryptVaultValue = (value?: string) => {
    if (!value) return ''
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    }
    return Buffer.from(value, 'base64').toString('utf8')
  }

  const readSecureVault = () => {
    if (!fs.existsSync(secureConfigPath)) return {}
    try {
      return JSON.parse(fs.readFileSync(secureConfigPath, 'utf8'))
    } catch {
      return {}
    }
  }

  const writeSecureVault = (data: Record<string, any>) => {
    fs.writeFileSync(secureConfigPath, JSON.stringify(data))
  }

  const normalizeGlmSlots = (secureData: Record<string, any>): KeySlot[] => {
    const keySlots = secureData.keySlots || {}
    const slots = Array.isArray(keySlots.glm) ? keySlots.glm : []
    keySlots.glm = [1, 2, 3].map((slot) => {
      const existing = slots.find((item: KeySlot) => item?.slot === slot) || {}
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
    secureData.keySlots = keySlots
    return keySlots.glm
  }

  const markActiveGlmSlot = (secureData: Record<string, any>, slotNumber: number) => {
    const slots = normalizeGlmSlots(secureData)
    secureData.activeKeySlots = secureData.activeKeySlots || {}
    secureData.activeKeySlots.glm = slotNumber
    secureData.keySlots.glm = slots.map((slot) => ({
      ...slot,
      status:
        slot.slot === slotNumber
          ? 'active'
          : slot.status === 'active'
            ? decryptVaultValue(slot.key)
              ? 'available'
              : 'empty'
            : slot.status
    }))
  }

  const getActiveGlmSlot = (secureData: Record<string, any>) => {
    const slots = normalizeGlmSlots(secureData)
    const preferredSlot = secureData.activeKeySlots?.glm
    const usable = slots.filter((slot) => slot.enabled && decryptVaultValue(slot.key))
    if (!usable.length) return null
    const selected =
      usable.find(
        (slot) => slot.slot === preferredSlot && slot.status !== 'failed' && slot.status !== 'rate-limited'
      ) ||
      usable.find((slot) => slot.status === 'active') ||
      usable.find((slot) => slot.status === 'available') ||
      usable[0]
    selected.lastUsedAt = new Date().toISOString()
    markActiveGlmSlot(secureData, selected.slot)
    return selected
  }

  const rotateGlmSlot = (secureData: Record<string, any>) => {
    const slots = normalizeGlmSlots(secureData).filter(
      (slot) => slot.enabled && decryptVaultValue(slot.key) && slot.status !== 'failed' && slot.status !== 'rate-limited'
    )
    if (!slots.length) return null
    const current = secureData.activeKeySlots?.glm
    const currentIndex = slots.findIndex((slot) => slot.slot === current)
    const next = slots[(currentIndex + 1 + slots.length) % slots.length]
    markActiveGlmSlot(secureData, next.slot)
    return next
  }

  const markGlmFailure = (secureData: Record<string, any>, slotNumber: number, status: string, reason: string) => {
    const slots = normalizeGlmSlots(secureData)
    secureData.keySlots.glm = slots.map((slot) =>
      slot.slot === slotNumber
        ? {
            ...slot,
            status,
            lastFailureReason: reason,
            lastCheckedAt: new Date().toISOString()
          }
        : slot
    )
  }

  const callGlm = async (prompt: string, currentFiles?: ProjectFile[]) => {
    const secureData = readSecureVault()
    const activeSlot = getActiveGlmSlot(secureData)
    if (!activeSlot) {
      writeSecureVault(secureData)
      return {
        success: false as const,
        code: 'MISSING_GLM_KEY',
        message: 'GLM 5.2 key configured nahi hai. Gemini fallback use karu ya pehle GLM key add karni hai?'
      }
    }

    const key = decryptVaultValue(activeSlot.key).trim()
    writeSecureVault(secureData)

    const systemPrompt = [
      'You are ALPHA coding engine using GLM 5.2.',
      'Return strict JSON only.',
      'Schema:',
      '{"projectName":"string","projectType":"string","summary":"string","files":[{"path":"relative/path","content":"file contents"}]}',
      'Never wrap output in markdown.',
      'For websites include at least index.html, style.css, script.js, README.md.',
      'For non-website projects include a practical starter file and README.md.'
    ].join(' ')

    const userPrompt = currentFiles?.length
      ? `Update this existing project for the request.\nRequest: ${prompt}\nCurrent files:\n${JSON.stringify(currentFiles)}`
      : `Create a project for this request.\nRequest: ${prompt}`

    try {
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: PROJECT_MODEL,
          temperature: 0.35,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      })

      if (!response.ok) {
        const failureStatus = response.status === 429 ? 'rate-limited' : 'failed'
        const secureDataOnFailure = readSecureVault()
        markGlmFailure(
          secureDataOnFailure,
          activeSlot.slot,
          failureStatus,
          `GLM HTTP ${response.status}`
        )
        rotateGlmSlot(secureDataOnFailure)
        writeSecureVault(secureDataOnFailure)
        return {
          success: false as const,
          code: 'GLM_REQUEST_FAILED',
          message: `GLM request failed with status ${response.status}.`
        }
      }

      const data = await response.json()
      const content = data?.choices?.[0]?.message?.content?.trim() || ''
      const parsed = extractJson(content)
      if (!parsed) {
        return {
          success: false as const,
          code: 'GLM_INVALID_RESPONSE',
          message: 'GLM did not return valid project JSON.'
        }
      }

      const secureDataOnSuccess = readSecureVault()
      markActiveGlmSlot(secureDataOnSuccess, activeSlot.slot)
      writeSecureVault(secureDataOnSuccess)

      return {
        success: true as const,
        payload: parsed
      }
    } catch (error: any) {
      const secureDataOnFailure = readSecureVault()
      markGlmFailure(secureDataOnFailure, activeSlot.slot, 'failed', error?.message || 'GLM request failed')
      rotateGlmSlot(secureDataOnFailure)
      writeSecureVault(secureDataOnFailure)
      return {
        success: false as const,
        code: 'GLM_NETWORK_ERROR',
        message: error?.message || 'GLM network request failed.'
      }
    }
  }

  const writeProjectState = (projectId: string, projectName: string, prompt: string, files: ProjectFile[]) => {
    const projectPath = path.join(projectsRoot, projectId)
    ensureDir(projectPath)
    ensureDir(path.join(projectPath, 'exports'))

    for (const file of files) {
      const targetFile = safeProjectFilePath(projectPath, file.path)
      ensureDir(path.dirname(targetFile))
      fs.writeFileSync(targetFile, file.content, 'utf8')
    }

    const existingMetaPath = path.join(projectPath, 'project.json')
    const existingMeta = fs.existsSync(existingMetaPath)
      ? (loadJson(fs.readFileSync(existingMetaPath, 'utf8')) as ProjectMetadata | null)
      : null

    const now = new Date().toISOString()
    const metadata: ProjectMetadata = {
      id: projectId,
      name: projectName,
      type: detectProjectType(prompt),
      createdAt: existingMeta?.createdAt || now,
      updatedAt: now,
      modelUsed: PROJECT_MODEL,
      files: files.map((file) => file.path),
      lastPrompt: prompt,
      projectPath
    }

    fs.writeFileSync(existingMetaPath, JSON.stringify(metadata, null, 2), 'utf8')

    return {
      metadata,
      files
    }
  }

  const readProjectState = (projectId: string): ProjectState => {
    const projectPath = path.join(projectsRoot, projectId)
    const metaPath = path.join(projectPath, 'project.json')
    if (!fs.existsSync(metaPath)) {
      throw new Error('Project not found.')
    }

    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectMetadata
    const files = metadata.files
      .map((relativePath) => {
        const absolutePath = safeProjectFilePath(projectPath, relativePath)
        if (!fs.existsSync(absolutePath)) return null
        return {
          path: relativePath,
          content: fs.readFileSync(absolutePath, 'utf8')
        }
      })
      .filter(Boolean) as ProjectFile[]

    return { metadata, files }
  }

  ipcMain.handle('project-builder-create', async (_, { prompt }) => {
    const projectType = detectProjectType(prompt || '')
    const generated = await callGlm(prompt || '')
    if (!generated.success) return generated

    const payload = generated.payload || {}
    const projectName = slugify(payload.projectName || guessProjectName(prompt || '', projectType))
    const files = normalizeFiles(payload, prompt || '', projectType)
    const state = writeProjectState(projectName, projectName, prompt || '', files)

    return {
      success: true,
      state,
      previewHtml: inlinePreviewHtml(state.files)
    }
  })

  ipcMain.handle('project-builder-update', async (_, { projectId, prompt }) => {
    const existing = readProjectState(projectId)
    const generated = await callGlm(prompt || '', existing.files)
    if (!generated.success) return generated

    const payload = generated.payload || {}
    const files = normalizeFiles(payload, prompt || '', existing.metadata.type)
    const state = writeProjectState(projectId, existing.metadata.name, prompt || '', files)

    return {
      success: true,
      state,
      previewHtml: inlinePreviewHtml(state.files)
    }
  })

  ipcMain.handle('project-builder-read', async (_, { projectId }) => {
    try {
      const state = readProjectState(projectId)
      return { success: true, state, previewHtml: inlinePreviewHtml(state.files) }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Project not found.' }
    }
  })

  ipcMain.handle('project-builder-export-zip', async (_, { projectId }) => {
    try {
      const state = readProjectState(projectId)
      const projectPath = state.metadata.projectPath
      const exportPath = path.join(projectPath, 'exports', `${state.metadata.name}.zip`)
      if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath)

      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Compress-Archive -Path "${projectPath}\\*" -DestinationPath "${exportPath}" -Force`
      ])

      return { success: true, exportPath }
    } catch (error: any) {
      return { success: false, error: error?.message || 'ZIP export failed.' }
    }
  })

  ipcMain.handle('project-builder-open-folder', async (_, { projectId }) => {
    try {
      const state = readProjectState(projectId)
      await shell.openPath(state.metadata.projectPath)
      return { success: true, projectPath: state.metadata.projectPath }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Folder open failed.' }
    }
  })

  ipcMain.handle('project-builder-open-vscode', async (_, { projectId }) => {
    try {
      const state = readProjectState(projectId)
      await execFileAsync('cmd.exe', ['/c', 'code', state.metadata.projectPath])
      return { success: true, projectPath: state.metadata.projectPath }
    } catch (error: any) {
      return { success: false, error: error?.message || 'VS Code open failed. Check that VS Code is installed and `code` is available.' }
    }
  })

  ipcMain.handle('project-builder-copy-path', async (_, { projectId }) => {
    try {
      const state = readProjectState(projectId)
      return { success: true, projectPath: state.metadata.projectPath }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Project path unavailable.' }
    }
  })
}
