import fs from 'fs'
import path from 'path'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { promisify } from 'util'
import { app, BrowserWindow, IpcMain, safeStorage, shell } from 'electron'

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
  providerUsed: string
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
  baseUrl?: string
  modelId?: string
  providerMode?: 'zenmux' | 'custom-compatible' | 'direct-zai' | 'zai-chat' | 'zai-coding' | 'zai-compatible'
  lastFailureReason?: string
  lastCheckedAt?: string
  lastUsedAt?: string
}

type ProviderName = 'glm' | 'zai' | 'gemini' | 'openrouter' | 'kimi' | 'groq'

type ProviderResult =
  | { success: true; payload: any; providerLabel: string }
  | { success: false; code: string; message: string; providerLabel: string }

const execFileAsync = promisify(execFile)
const activeProjectProcesses = new Map<string, ChildProcessWithoutNullStreams>()

const PROJECT_MODEL = 'glm-5.2'
const ZENMUX_DEFAULT_BASE_URL = 'https://zenmux.ai/api/v1'
const ZENMUX_DEFAULT_MODEL_ID = 'z-ai/glm-5.2-free'
const ZAI_DEFAULT_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
const ZAI_DEFAULT_MODEL_ID = 'glm-4.5v'

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

const extractCodeBlockFiles = (raw: string): ProjectFile[] => {
  const files: ProjectFile[] = []
  const blockPattern = /```([a-zA-Z0-9+#.-]*)\s*([\s\S]*?)```/g
  let match: RegExpExecArray | null
  let index = 0

  while ((match = blockPattern.exec(raw))) {
    const language = (match[1] || '').toLowerCase()
    const content = (match[2] || '').trim()
    if (!content) continue
    const extension =
      language.includes('html')
        ? 'html'
        : language.includes('css')
          ? 'css'
          : language.includes('javascript') || language === 'js'
            ? 'js'
            : language.includes('typescript') || language === 'ts'
              ? 'ts'
              : language.includes('python') || language === 'py'
                ? 'py'
                : language.includes('java')
                  ? 'java'
                  : language.includes('cpp') || language.includes('c++')
                    ? 'cpp'
                    : language === 'c'
                      ? 'c'
                      : 'txt'
    const defaultName =
      extension === 'html'
        ? 'index.html'
        : extension === 'css'
          ? 'style.css'
          : extension === 'js'
            ? 'script.js'
            : `generated-${index + 1}.${extension}`
    files.push({ path: defaultName, content })
    index += 1
  }

  return files
}

const createFallbackWebsiteFiles = (prompt: string): ProjectFile[] => {
  const lower = prompt.toLowerCase()
  const escapedPrompt = prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')

  if (/\bcalculator\b/.test(lower)) {
    return [
      {
        path: 'index.html',
        content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>ALPHA Calculator</title><link rel="stylesheet" href="style.css"/></head><body><main class="calc-shell"><section class="calc-card"><p class="eyebrow">ALPHA Calculator</p><h1>Glass Calculator</h1><div class="display" id="display">0</div><div class="keys"><button data-value="7">7</button><button data-value="8">8</button><button data-value="9">9</button><button data-value="/">/</button><button data-value="4">4</button><button data-value="5">5</button><button data-value="6">6</button><button data-value="*">*</button><button data-value="1">1</button><button data-value="2">2</button><button data-value="3">3</button><button data-value="-">-</button><button data-value="0">0</button><button data-value=".">.</button><button data-action="clear">C</button><button data-value="+">+</button><button class="equals" data-action="equals">=</button></div></section></main><script src="script.js"></script></body></html>`
      },
      {
        path: 'style.css',
        content: `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#22d3ee20,transparent 25%),radial-gradient(circle at bottom right,#a855f720,transparent 30%),#020617;color:#e2e8f0;font-family:Inter,Segoe UI,sans-serif}.calc-card{width:min(420px,92vw);padding:28px;border-radius:28px;border:1px solid rgba(125,211,252,.25);background:rgba(15,23,42,.64);backdrop-filter:blur(22px);box-shadow:0 28px 80px rgba(2,6,23,.55)}.eyebrow{text-transform:uppercase;letter-spacing:.32em;color:#67e8f9;font-size:11px}.display{margin:20px 0;padding:22px;border-radius:20px;background:rgba(255,255,255,.06);text-align:right;font-size:42px;font-weight:700}.keys{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}button{height:58px;border:none;border-radius:18px;background:rgba(255,255,255,.08);color:#fff;font-size:18px;cursor:pointer}.equals{grid-column:span 4;background:linear-gradient(135deg,#22d3ee,#8b5cf6)}`
      },
      {
        path: 'script.js',
        content: `const display=document.getElementById('display');let expression='';document.querySelectorAll('button').forEach((button)=>{button.addEventListener('click',()=>{const action=button.dataset.action;const value=button.dataset.value;if(action==='clear'){expression='';display.textContent='0';return}if(action==='equals'){try{expression=String(Function('return '+expression)());display.textContent=expression}catch{display.textContent='Error';expression=''}return}expression+=value;display.textContent=expression})})`
      },
      {
        path: 'README.md',
        content: `# Calculator Website\n\nPrompt: ${prompt}\n`
      }
    ]
  }

  if (/\bsolar|planet|orbit|space\b/.test(lower)) {
    return [
      {
        path: 'index.html',
        content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Solar System Showcase</title><link rel="stylesheet" href="style.css"/></head><body><main class="space-shell"><section class="hero"><p class="eyebrow">ALPHA Cosmic Builder</p><h1>Solar System Experience</h1><p class="lede">${escapedPrompt}</p><div class="system"><div class="sun"></div><div class="orbit mercury"><span></span></div><div class="orbit earth"><span></span></div><div class="orbit neptune"><span></span></div></div></section><section class="cards"><article><h2>Interactive Orbits</h2><p>Planet rings animate around a glowing core.</p></article><article><h2>Mission Feed</h2><p>Use Builder chat to add planets, facts, or parallax sections.</p></article><article><h2>Presentation Ready</h2><p>Responsive cosmic layout with glass telemetry cards.</p></article></section></main><script src="script.js"></script></body></html>`
      },
      {
        path: 'style.css',
        content: `*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#38bdf81f,transparent 26%),radial-gradient(circle at 80% 10%,#7c3aed2c,transparent 24%),#020617;color:#e2e8f0;font-family:Inter,Segoe UI,sans-serif}.space-shell{padding:32px;display:grid;gap:24px}.hero,.cards article{border:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.58);backdrop-filter:blur(22px);border-radius:30px;box-shadow:0 24px 90px rgba(2,6,23,.6)}.hero{padding:36px;min-height:72vh;display:grid;align-content:start;gap:16px}.eyebrow{text-transform:uppercase;letter-spacing:.32em;color:#7dd3fc;font-size:11px}.lede{max-width:760px;color:#cbd5e1}.system{position:relative;height:420px;display:grid;place-items:center}.sun{width:96px;height:96px;border-radius:50%;background:radial-gradient(circle,#fde68a,#f97316);box-shadow:0 0 80px #f59e0b}.orbit{position:absolute;border:1px solid rgba(125,211,252,.25);border-radius:50%;animation:spin 12s linear infinite}.orbit span{position:absolute;top:50%;left:100%;width:18px;height:18px;border-radius:50%;transform:translate(-50%,-50%)}.mercury{width:160px;height:160px}.mercury span{background:#fca5a5}.earth{width:260px;height:260px;animation-duration:18s}.earth span{background:#38bdf8}.neptune{width:360px;height:360px;animation-duration:24s}.neptune span{background:#818cf8}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.cards article{padding:24px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:900px){.cards{grid-template-columns:1fr}.system{height:320px}}`
      },
      {
        path: 'script.js',
        content: `document.body.dataset.prompt=${JSON.stringify(prompt)}`
      },
      { path: 'README.md', content: `# Solar System Website\n\nPrompt: ${prompt}\n` }
    ]
  }

  if (/\bportfolio\b/.test(lower)) {
    return [
      {
        path: 'index.html',
        content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Portfolio Website</title><link rel="stylesheet" href="style.css"/></head><body><main class="portfolio-shell"><section class="hero"><p class="eyebrow">ALPHA Portfolio</p><h1>Creative Developer Portfolio</h1><p>${escapedPrompt}</p><a href="#projects" class="cta">View Projects</a></section><section class="grid"><article><h2>About</h2><p>Short founder introduction with focus areas and workflow.</p></article><article id="projects"><h2>Projects</h2><p>Three featured case studies, metrics, and stack chips.</p></article><article><h2>Contact</h2><p>Email, socials, and availability panel in glass layout.</p></article></section></main><script src="script.js"></script></body></html>`
      },
      {
        path: 'style.css',
        content: `*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#020617,#0f172a);color:#f8fafc;font-family:Inter,Segoe UI,sans-serif}.portfolio-shell{padding:32px;display:grid;gap:24px}.hero,.grid article{border:1px solid rgba(125,211,252,.18);background:rgba(15,23,42,.55);border-radius:28px;backdrop-filter:blur(24px);padding:32px}.eyebrow{text-transform:uppercase;letter-spacing:.32em;color:#67e8f9;font-size:11px}.cta{display:inline-flex;margin-top:18px;padding:12px 18px;border-radius:999px;background:linear-gradient(135deg,#22d3ee,#8b5cf6);color:#fff;text-decoration:none}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}@media(max-width:900px){.grid{grid-template-columns:1fr}}`
      },
      {
        path: 'script.js',
        content: `console.log('Portfolio builder ready')`
      },
      { path: 'README.md', content: `# Portfolio Website\n\nPrompt: ${prompt}\n` }
    ]
  }

  return [
    {
      path: 'index.html',
      content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>ALPHA Builder Preview</title><link rel="stylesheet" href="style.css"/></head><body><main class="stage"><section class="hero"><div class="orb orb-a"></div><div class="orb orb-b"></div><p class="eyebrow">ALPHA Website Builder</p><h1>AI Local LLM Presentation</h1><p class="lede">${escapedPrompt}</p><div class="actions"><button id="pulseBtn">Start Demo</button><span class="status">Prompt-aware local preview ready</span></div></section><section class="cards"><article><strong>Glassmotion Panels</strong><span>Prompt-aware presentation sections with cyber glass styling.</span></article><article><strong>AI Workflow</strong><span>Use Coding Agent chat to refine hero, cards, or animations.</span></article><article><strong>Live Builder</strong><span>Preview, code, split, and visual edit modes are ready.</span></article></section></main><script src="script.js"></script></body></html>`
    },
    {
      path: 'style.css',
      content: `*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Inter,Segoe UI,system-ui,sans-serif;background:radial-gradient(circle at 20% 10%,rgba(34,211,238,.22),transparent 32%),radial-gradient(circle at 85% 15%,rgba(99,102,241,.2),transparent 30%),#020617;color:#eaf6ff;overflow-x:hidden}.stage{min-height:100vh;padding:clamp(28px,5vw,72px);display:grid;align-content:center;gap:28px}.hero{position:relative;overflow:hidden;min-height:54vh;border:1px solid rgba(125,211,252,.22);background:linear-gradient(145deg,rgba(15,23,42,.62),rgba(8,13,28,.34));backdrop-filter:blur(24px);border-radius:32px;padding:clamp(32px,6vw,74px);box-shadow:0 28px 100px rgba(0,0,0,.42),inset 0 1px rgba(255,255,255,.12);transform-style:preserve-3d}.orb{position:absolute;width:260px;height:260px;border-radius:50%;filter:blur(26px);opacity:.38;animation:float 8s ease-in-out infinite}.orb-a{right:8%;top:8%;background:#22d3ee}.orb-b{left:10%;bottom:4%;background:#a855f7;animation-delay:-3s}.eyebrow{letter-spacing:.28em;text-transform:uppercase;color:#67e8f9;font-size:12px}h1{font-size:clamp(42px,8vw,96px);line-height:.92;margin:18px 0;max-width:920px}.lede{max-width:780px;color:#bfd8ee;font-size:clamp(16px,2vw,22px);line-height:1.7}.actions{display:flex;align-items:center;gap:18px;margin-top:30px;flex-wrap:wrap}button{border:1px solid rgba(103,232,249,.35);background:linear-gradient(135deg,rgba(34,211,238,.28),rgba(168,85,247,.22));color:white;padding:14px 22px;border-radius:18px;font-weight:800;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.18)}.status{color:#93c5fd}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.cards article{min-height:150px;border:1px solid rgba(255,255,255,.12);background:rgba(15,23,42,.42);backdrop-filter:blur(18px);border-radius:24px;padding:24px;display:flex;flex-direction:column;gap:12px;box-shadow:inset 0 1px rgba(255,255,255,.08)}.cards strong{color:#67e8f9;font-size:20px}.cards span{color:#cbd5e1;line-height:1.6}@keyframes float{50%{transform:translate3d(20px,-24px,40px) scale(1.08)}}@media(max-width:760px){.cards{grid-template-columns:1fr}h1{font-size:44px}}`
    },
    {
      path: 'script.js',
      content: `const button=document.getElementById('pulseBtn');let active=false;button?.addEventListener('click',()=>{active=!active;button.textContent=active?'Presentation Running':'Start Demo';document.body.style.setProperty('--pulse',active?'1':'0');});`
    },
    {
      path: 'README.md',
      content: `# ALPHA Builder Project\n\nPrompt: ${prompt}\n\nThis project shell is created immediately so the Builder can open even while provider selection or fallback is pending.\n`
    }
  ]
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

  if (typeof payload?.rawText === 'string') {
    const codeBlockFiles = extractCodeBlockFiles(payload.rawText)
    if (codeBlockFiles.length) {
      const hasReadme = codeBlockFiles.some((file) => file.path.toLowerCase() === 'readme.md')
      return hasReadme
        ? codeBlockFiles
        : [
            ...codeBlockFiles,
            {
              path: 'README.md',
              content: `# ALPHA generated project\n\nPrompt: ${prompt}\n`
            }
          ]
    }
  }

  if (projectType === 'website') {
    return createFallbackWebsiteFiles(prompt)
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

const normalizeCompatibleBaseUrl = (baseUrl: string) => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

const normalizeGeminiText = (data: any) =>
  (data?.candidates?.[0]?.content?.parts || [])
    .map((part: any) => part?.text || '')
    .join('')
    .trim()

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
        baseUrl:
          typeof existing.baseUrl === 'string' && existing.baseUrl.trim()
            ? existing.baseUrl
            : ZENMUX_DEFAULT_BASE_URL,
        modelId:
          typeof existing.modelId === 'string' && existing.modelId.trim()
            ? existing.modelId
            : ZENMUX_DEFAULT_MODEL_ID,
        providerMode:
          existing.providerMode === 'custom-compatible' || existing.providerMode === 'direct-zai'
            ? existing.providerMode
            : 'zenmux',
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

  const normalizeZaiSlots = (secureData: Record<string, any>): KeySlot[] => {
    const keySlots = secureData.keySlots || {}
    const slots = Array.isArray(keySlots.zai) ? keySlots.zai : []
    keySlots.zai = [1, 2, 3].map((slot) => {
      const existing = slots.find((item: KeySlot) => item?.slot === slot) || {}
      return {
        slot,
        key: existing.key || '',
        enabled: typeof existing.enabled === 'boolean' ? existing.enabled : true,
        status: existing.status || (existing.key ? 'available' : 'empty'),
        baseUrl:
          typeof existing.baseUrl === 'string' && existing.baseUrl.trim()
            ? existing.baseUrl
            : ZAI_DEFAULT_BASE_URL,
        modelId:
          typeof existing.modelId === 'string' && existing.modelId.trim()
            ? existing.modelId
            : ZAI_DEFAULT_MODEL_ID,
        providerMode:
          existing.providerMode === 'zai-chat' || existing.providerMode === 'zai-compatible'
            ? existing.providerMode
            : 'zai-coding',
        lastFailureReason: existing.lastFailureReason || '',
        lastCheckedAt: existing.lastCheckedAt || '',
        lastUsedAt: existing.lastUsedAt || ''
      }
    })
    secureData.keySlots = keySlots
    return keySlots.zai
  }

  const markActiveZaiSlot = (secureData: Record<string, any>, slotNumber: number) => {
    const slots = normalizeZaiSlots(secureData)
    secureData.activeKeySlots = secureData.activeKeySlots || {}
    secureData.activeKeySlots.zai = slotNumber
    secureData.keySlots.zai = slots.map((slot) => ({
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

  const getActiveZaiSlot = (secureData: Record<string, any>) => {
    const slots = normalizeZaiSlots(secureData)
    const preferredSlot = secureData.activeKeySlots?.zai
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
    markActiveZaiSlot(secureData, selected.slot)
    return selected
  }

  const rotateZaiSlot = (secureData: Record<string, any>) => {
    const slots = normalizeZaiSlots(secureData).filter(
      (slot) => slot.enabled && decryptVaultValue(slot.key) && slot.status !== 'failed' && slot.status !== 'rate-limited'
    )
    if (!slots.length) return null
    const current = secureData.activeKeySlots?.zai
    const currentIndex = slots.findIndex((slot) => slot.slot === current)
    const next = slots[(currentIndex + 1 + slots.length) % slots.length]
    markActiveZaiSlot(secureData, next.slot)
    return next
  }

  const markZaiFailure = (secureData: Record<string, any>, slotNumber: number, status: string, reason: string) => {
    const slots = normalizeZaiSlots(secureData)
    secureData.keySlots.zai = slots.map((slot) =>
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
  const buildProjectSystemPrompt = (providerLabel: string) =>
    [
      `You are ALPHA coding engine using ${providerLabel}.`,
      'Return strict JSON only.',
      'Schema:',
      '{"projectName":"string","projectType":"string","summary":"string","files":[{"path":"relative/path","content":"file contents"}]}',
      'Never wrap output in markdown.',
      'For websites include at least index.html, style.css, script.js, README.md.',
      'For website prompts, make the page visibly functional and previewable immediately.',
      'For a calculator website, return a working calculator UI with glassmorphism styling and JavaScript interactions.',
      'For non-website projects include a practical starter file and README.md.'
    ].join(' ')

  const buildProjectUserPrompt = (prompt: string, currentFiles?: ProjectFile[]) =>
    currentFiles?.length
      ? `Update this existing project for the request.\nRequest: ${prompt}\nCurrent files:\n${JSON.stringify(currentFiles)}`
      : `Create a project for this request.\nRequest: ${prompt}`

  const parseProviderPayload = (content: string, providerLabel: string): ProviderResult => {
    const parsed = extractJson(content)
    if (!parsed) {
      return {
        success: true,
        payload: {
          projectName: 'alpha-builder-project',
          projectType: 'website',
          summary: `${providerLabel} returned text instead of project JSON.`,
          rawText: content,
          files: extractCodeBlockFiles(content)
        },
        providerLabel
      }
    }
    return { success: true, payload: parsed, providerLabel }
  }

  const callGeminiProjectProvider = async (prompt: string, currentFiles?: ProjectFile[]): Promise<ProviderResult> => {
    const secureData = readSecureVault()
    const geminiSlot = secureData.keySlots?.geminiBrain?.find((slot: KeySlot) => {
      const key = decryptVaultValue(slot?.key)
      return slot?.enabled && key
    })
    const geminiKey = decryptVaultValue(geminiSlot?.key) || decryptVaultValue(secureData.gemini)
    if (!geminiKey) {
      return {
        success: false,
        code: 'GEMINI_MISSING_KEY',
        message: 'Gemini key missing hai. Gemini key/settings check karo ya OpenRouter/Kimi choose karo.',
        providerLabel: 'Gemini'
      }
    }

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
        encodeURIComponent(geminiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildProjectSystemPrompt('Gemini 2.5 Flash') }] },
          contents: [{ role: 'user', parts: [{ text: buildProjectUserPrompt(prompt, currentFiles) }] }],
          generationConfig: { temperature: 0.35, maxOutputTokens: 4096 }
        })
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      const exactMessage =
        response.status === 401 || response.status === 403
          ? 'Gemini auth failed. Gemini key/settings check karo ya OpenRouter/Kimi choose karo.'
          : response.status === 429
            ? 'Gemini rate limit/quota hit hua. Dusra fallback choose karo.'
            : `Gemini provider error ${response.status}: ${errorBody.slice(0, 180)}`
      return { success: false, code: `GEMINI_${response.status}`, message: exactMessage, providerLabel: 'Gemini' }
    }

    const data = await response.json()
    return parseProviderPayload(normalizeGeminiText(data), 'Gemini')
  }

  const callCompatibleProvider = async (
    prompt: string,
    currentFiles: ProjectFile[] | undefined,
    config: { endpoint: string; key: string; model: string; providerLabel: string; headers?: Record<string, string> }
  ): Promise<ProviderResult> => {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.key}`,
        ...(config.headers || {})
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.35,
        messages: [
          { role: 'system', content: buildProjectSystemPrompt(config.providerLabel) },
          { role: 'user', content: buildProjectUserPrompt(prompt, currentFiles) }
        ]
      })
    })

    if (!response.ok) {
      const body = await response.text()
      let message = `${config.providerLabel} provider error ${response.status}: ${body.slice(0, 180)}`
      if (response.status === 401 || response.status === 403) {
        message = `${config.providerLabel} auth failed. API key/settings check karo.`
      } else if (response.status === 404) {
        message = `${config.providerLabel} model invalid lag raha hai. Model/settings check karo.`
      } else if (response.status === 429) {
        message = `${config.providerLabel} rate limit/quota hit hua.`
      }
      return { success: false, code: `${config.providerLabel.toUpperCase()}_${response.status}`, message, providerLabel: config.providerLabel }
    }

    const data = await response.json()
    return parseProviderPayload(data?.choices?.[0]?.message?.content?.trim() || '', config.providerLabel)
  }

  const callGlm = async (prompt: string, currentFiles?: ProjectFile[]): Promise<ProviderResult> => {
    const secureData = readSecureVault()
    const activeSlot = getActiveGlmSlot(secureData)
    if (!activeSlot) {
      writeSecureVault(secureData)
      return {
        success: false,
        code: 'MISSING_GLM_KEY',
        message: 'GLM 5.2 key configured nahi hai. Gemini fallback use karu ya pehle GLM key add karni hai?',
        providerLabel: 'GLM 5.2'
      }
    }

    const key = decryptVaultValue(activeSlot.key).trim()
    const providerMode = activeSlot.providerMode || 'zenmux'
    const baseUrl = activeSlot.baseUrl || ZENMUX_DEFAULT_BASE_URL
    const modelId = activeSlot.modelId || ZENMUX_DEFAULT_MODEL_ID
    writeSecureVault(secureData)

    try {
      const endpoint =
        providerMode === 'direct-zai'
          ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
          : normalizeCompatibleBaseUrl(baseUrl)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          ...(providerMode === 'direct-zai'
            ? {
                'HTTP-Referer': 'https://alpha.local',
                'X-Title': 'alpha'
              }
            : {})
        },
        body: JSON.stringify({
          model: modelId,
          temperature: 0.35,
          messages: [
            { role: 'system', content: buildProjectSystemPrompt('GLM 5.2') },
            { role: 'user', content: buildProjectUserPrompt(prompt, currentFiles) }
          ]
        })
      })

      if (!response.ok) {
        const body = await response.text()
        const failureStatus = response.status === 429 ? 'rate-limited' : 'failed'
        const secureDataOnFailure = readSecureVault()
        const errorMessage =
          response.status === 401 || response.status === 403
            ? 'ZenMux/GLM auth failed. API key ya model ID check karo.'
            : response.status === 404
              ? 'GLM model ID invalid lag raha hai. Settings me model ID check karo.'
              : `GLM provider error ${response.status}: ${body.slice(0, 180)}`
        markGlmFailure(secureDataOnFailure, activeSlot.slot, failureStatus, errorMessage)
        rotateGlmSlot(secureDataOnFailure)
        writeSecureVault(secureDataOnFailure)
        return {
          success: false,
          code: response.status === 404 ? 'GLM_MODEL_INVALID' : response.status === 401 || response.status === 403 ? 'GLM_AUTH_FAILED' : 'GLM_REQUEST_FAILED',
          message: errorMessage,
          providerLabel: providerMode === 'zenmux' ? 'ZenMux Compatible GLM' : 'GLM 5.2'
        }
      }

      const data = await response.json()
      const content = data?.choices?.[0]?.message?.content?.trim() || ''
      const parsed = parseProviderPayload(content, providerMode === 'zenmux' ? 'ZenMux Compatible GLM' : 'GLM 5.2')
      if (!parsed.success) return parsed

      const secureDataOnSuccess = readSecureVault()
      markActiveGlmSlot(secureDataOnSuccess, activeSlot.slot)
      writeSecureVault(secureDataOnSuccess)
      return parsed
    } catch (error: any) {
      const secureDataOnFailure = readSecureVault()
      markGlmFailure(secureDataOnFailure, activeSlot.slot, 'failed', error?.message || 'GLM request failed')
      rotateGlmSlot(secureDataOnFailure)
      writeSecureVault(secureDataOnFailure)
      return {
        success: false,
        code: 'GLM_NETWORK_ERROR',
        message: error?.message || 'GLM network request failed.',
        providerLabel: 'GLM 5.2'
      }
    }
  }

  const callZai = async (prompt: string, currentFiles?: ProjectFile[]): Promise<ProviderResult> => {
    const secureData = readSecureVault()
    const activeSlot = getActiveZaiSlot(secureData)
    if (!activeSlot) {
      writeSecureVault(secureData)
      return {
        success: false,
        code: 'MISSING_ZAI_KEY',
        message: 'Z.AI configured nahi hai. Settings me Z.AI Coding Provider check karo.',
        providerLabel: 'Z.AI'
      }
    }

    const key = decryptVaultValue(activeSlot.key).trim()
    const providerMode = activeSlot.providerMode || 'zai-coding'
    const baseUrl = activeSlot.baseUrl || ZAI_DEFAULT_BASE_URL
    const modelId = activeSlot.modelId || ZAI_DEFAULT_MODEL_ID
    writeSecureVault(secureData)

    try {
      const endpoint =
        providerMode === 'zai-compatible'
          ? normalizeCompatibleBaseUrl(baseUrl)
          : `${baseUrl.replace(/\/+$/, '')}/chat/completions`

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: modelId,
          temperature: 0.35,
          messages: [
            { role: 'system', content: buildProjectSystemPrompt('Z.AI Coding Provider') },
            { role: 'user', content: buildProjectUserPrompt(prompt, currentFiles) }
          ]
        })
      })

      if (!response.ok) {
        const body = await response.text()
        const secureDataOnFailure = readSecureVault()
        const failureStatus = response.status === 429 ? 'rate-limited' : 'failed'
        const errorMessage =
          response.status === 401 || response.status === 403
            ? 'Z.AI auth failed. API key ya model ID check karo.'
            : response.status === 404
              ? 'Z.AI model ID invalid lag raha hai. Settings me model ID check karo.'
              : `Z.AI provider error ${response.status}: ${body.slice(0, 180)}`
        markZaiFailure(secureDataOnFailure, activeSlot.slot, failureStatus, errorMessage)
        rotateZaiSlot(secureDataOnFailure)
        writeSecureVault(secureDataOnFailure)
        return {
          success: false,
          code: response.status === 404 ? 'ZAI_MODEL_INVALID' : response.status === 401 || response.status === 403 ? 'ZAI_AUTH_FAILED' : 'ZAI_REQUEST_FAILED',
          message: errorMessage,
          providerLabel: 'Z.AI'
        }
      }

      const data = await response.json()
      const content =
        data?.choices?.[0]?.message?.content?.trim() ||
        data?.output_text?.trim?.() ||
        ''
      const parsed = parseProviderPayload(content, 'Z.AI')
      const secureDataOnSuccess = readSecureVault()
      markActiveZaiSlot(secureDataOnSuccess, activeSlot.slot)
      writeSecureVault(secureDataOnSuccess)
      return parsed
    } catch (error: any) {
      const secureDataOnFailure = readSecureVault()
      markZaiFailure(secureDataOnFailure, activeSlot.slot, 'failed', error?.message || 'Z.AI request failed')
      rotateZaiSlot(secureDataOnFailure)
      writeSecureVault(secureDataOnFailure)
      return {
        success: false,
        code: 'ZAI_NETWORK_ERROR',
        message: error?.message || 'Z.AI network request failed.',
        providerLabel: 'Z.AI'
      }
    }
  }

  const callProvider = async (
    provider: ProviderName,
    prompt: string,
    currentFiles?: ProjectFile[]
  ): Promise<ProviderResult> => {
    if (provider === 'glm') {
      const glmResult = await callGlm(prompt, currentFiles)
      if (glmResult.success) return glmResult
      const zaiResult = await callZai(prompt, currentFiles)
      if (zaiResult.success) {
        return {
          ...zaiResult,
          providerLabel: 'Z.AI'
        }
      }
      return {
        success: false,
        code: 'GLM_ZAI_UNAVAILABLE',
        message: `GLM aur Z.AI configured nahi hai. Kaunsa fallback use karna hai? Gemini / OpenRouter / Kimi / Groq / Cancel\n\nGLM: ${glmResult.message}\nZ.AI: ${zaiResult.message}`,
        providerLabel: 'GLM -> Z.AI'
      }
    }
    if (provider === 'zai') return callZai(prompt, currentFiles)
    if (provider === 'gemini') return callGeminiProjectProvider(prompt, currentFiles)

    const secureData = readSecureVault()
    const slots = secureData.keySlots?.[provider] || []
    const active = slots.find((slot: KeySlot) => slot?.enabled && decryptVaultValue(slot?.key))
    const key = decryptVaultValue(active?.key)
    if (!key) {
      return {
        success: false,
        code: `${provider.toUpperCase()}_MISSING_KEY`,
        message: `${provider} key missing hai. Settings me provider config check karo.`,
        providerLabel: provider
      }
    }

    if (provider === 'openrouter') {
      return callCompatibleProvider(prompt, currentFiles, {
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        key,
        model: secureData.openrouterModel || 'glm-5.2',
        providerLabel: 'OpenRouter',
        headers: { 'HTTP-Referer': 'https://alpha.local', 'X-Title': 'alpha' }
      })
    }

    if (provider === 'groq') {
      return callCompatibleProvider(prompt, currentFiles, {
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        key,
        model: 'llama-3.1-8b-instant',
        providerLabel: 'Groq'
      })
    }

    if (provider === 'kimi') {
      return callCompatibleProvider(prompt, currentFiles, {
        endpoint: 'https://api.moonshot.ai/v1/chat/completions',
        key,
        model: 'moonshot-v1-8k',
        providerLabel: 'Kimi'
      })
    }

    return {
      success: false,
      code: 'UNSUPPORTED_PROVIDER',
      message: `${provider} provider currently unsupported.`,
      providerLabel: provider
    }
  }

  const writeProjectState = (
    projectId: string,
    projectName: string,
    prompt: string,
    files: ProjectFile[],
    providerUsed: string
  ) => {
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
      providerUsed,
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

  const emitTerminalEvent = (payload: Record<string, any>) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('builder-terminal-event', payload)
    })
  }

  ipcMain.handle('project-builder-create', async (_, { prompt, provider = 'glm' }) => {
    const projectType = detectProjectType(prompt || '')
    const generated = await callProvider(provider, prompt || '')
    if (!generated.success) {
      const projectName = guessProjectName(prompt || 'website builder', projectType)
      const files = normalizeFiles({ files: [] }, prompt || '', projectType)
      const state = writeProjectState(projectName, projectName, prompt || '', files, generated.providerLabel)
      return {
        success: true,
        state,
        previewHtml: inlinePreviewHtml(state.files),
        providerError: generated.message,
        providerCode: generated.code
      }
    }

    const payload = generated.payload || {}
    const projectName = slugify(payload.projectName || guessProjectName(prompt || '', projectType))
    const files = normalizeFiles(payload, prompt || '', projectType)
    const state = writeProjectState(projectName, projectName, prompt || '', files, generated.providerLabel)

    return {
      success: true,
      state,
      previewHtml: inlinePreviewHtml(state.files)
    }
  })

  ipcMain.handle('project-builder-update', async (_, { projectId, prompt, provider }) => {
    const existing = readProjectState(projectId)
    const generated = await callProvider(
      provider || ((existing.metadata.providerUsed || '').toLowerCase().includes('gemini')
        ? 'gemini'
        : (existing.metadata.providerUsed || '').toLowerCase().includes('z.ai')
          ? 'zai'
        : (existing.metadata.providerUsed || '').toLowerCase().includes('openrouter')
          ? 'openrouter'
          : (existing.metadata.providerUsed || '').toLowerCase().includes('kimi')
            ? 'kimi'
            : (existing.metadata.providerUsed || '').toLowerCase().includes('groq')
              ? 'groq'
              : 'glm'),
      prompt || '',
      existing.files
    )
    if (!generated.success) {
      const fallbackFiles = normalizeFiles({ files: existing.files }, prompt || '', existing.metadata.type)
      const state = writeProjectState(
        projectId,
        existing.metadata.name,
        prompt || '',
        fallbackFiles.length ? fallbackFiles : existing.files,
        existing.metadata.providerUsed || generated.providerLabel
      )
      return {
        success: true,
        state,
        previewHtml: inlinePreviewHtml(state.files),
        providerError: generated.message,
        providerCode: generated.code
      }
    }

    const payload = generated.payload || {}
    const files = normalizeFiles(payload, prompt || '', existing.metadata.type)
    const state = writeProjectState(
      projectId,
      existing.metadata.name,
      prompt || '',
      files,
      generated.providerLabel
    )

    return {
      success: true,
      state,
      previewHtml: inlinePreviewHtml(state.files)
    }
  })

  ipcMain.handle('project-builder-save-file', async (_, { projectId, filePath, content }) => {
    try {
      const existing = readProjectState(projectId)
      const files = existing.files.map((file) =>
        file.path === filePath ? { ...file, content: String(content || '') } : file
      )
      const state = writeProjectState(
        projectId,
        existing.metadata.name,
        existing.metadata.lastPrompt,
        files,
        existing.metadata.providerUsed
      )
      return {
        success: true,
        state,
        previewHtml: inlinePreviewHtml(state.files)
      }
    } catch (error: any) {
      return { success: false, error: error?.message || 'File save failed.' }
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

  ipcMain.handle('project-builder-run-command', async (_, { projectId, command }) => {
    try {
      const state = readProjectState(projectId)
      const projectPath = state.metadata.projectPath
      const trimmedCommand = String(command || '').trim()
      if (!trimmedCommand) return { success: false, error: 'Command is empty.' }

      const existing = activeProjectProcesses.get(projectId)
      if (existing && !existing.killed) {
        return { success: false, error: 'A command is already running for this project.' }
      }

      const child = spawn('cmd.exe', ['/c', trimmedCommand], {
        cwd: projectPath,
        windowsHide: true
      })
      const runId = `${projectId}-${Date.now()}`
      activeProjectProcesses.set(projectId, child)

      emitTerminalEvent({ projectId, runId, type: 'start', command: trimmedCommand })
      child.stdout.on('data', (chunk) => {
        emitTerminalEvent({ projectId, runId, type: 'stdout', chunk: String(chunk) })
      })
      child.stderr.on('data', (chunk) => {
        emitTerminalEvent({ projectId, runId, type: 'stderr', chunk: String(chunk) })
      })
      child.on('close', (code) => {
        activeProjectProcesses.delete(projectId)
        emitTerminalEvent({ projectId, runId, type: 'exit', exitCode: code ?? 0 })
      })

      return { success: true, runId, command: trimmedCommand }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Project command failed to start.' }
    }
  })

  ipcMain.handle('project-builder-stop-command', async (_, { projectId }) => {
    const child = activeProjectProcesses.get(projectId)
    if (!child) return { success: false, error: 'No running command for this project.' }
    child.kill()
    activeProjectProcesses.delete(projectId)
    emitTerminalEvent({ projectId, type: 'stopped' })
    return { success: true }
  })
}
