import fs from 'fs'
import path from 'path'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { promisify } from 'util'
import { app, BrowserWindow, IpcMain, safeStorage, shell } from 'electron'
import { getKiloService } from '../kilo/kilo-bridge'

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
  providerMode?: string
  lastFailureReason?: string
  lastCheckedAt?: string
  lastUsedAt?: string
}

type ProviderName =
  | 'glm'
  | 'zai'
  | 'gemini'
  | 'openrouter'
  | 'kimi'
  | 'groq'
  | 'kiloGateway'
  | 'routeway'

type ProviderSelection = {
  provider: ProviderName
  slot?: number
  modelId?: string
  baseUrl?: string
  providerMode?: string
  apiKey?: string
  label?: string
}

type ProviderResult =
  | { success: true; payload: any; providerLabel: string }
  | { success: false; code: string; message: string; providerLabel: string; cancelled?: boolean }

type ProviderChatResult =
  | { success: true; content: string; providerLabel: string }
  | { success: false; code: string; message: string; providerLabel: string; cancelled?: boolean }

type BuilderPromptIntent =
  | 'NORMAL_CHAT'
  | 'CODING_GENERATE'
  | 'CODING_EDIT'
  | 'RUN_COMMAND'
  | 'EXPLAIN_CODE'

type FileExtractionResult = {
  files: ProjectFile[]
  source: 'structured' | 'codeblocks' | 'fallback'
}

const execFileAsync = promisify(execFile)
const activeProjectProcesses = new Map<string, ChildProcessWithoutNullStreams>()
const activeBuilderRequests = new Map<string, AbortController>()

const PROJECT_MODEL = 'glm-5.2'
const ZENMUX_DEFAULT_BASE_URL = 'https://zenmux.ai/api/v1'
const ZENMUX_DEFAULT_MODEL_ID = 'z-ai/glm-5.2-free'
const ZAI_DEFAULT_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
const ZAI_DEFAULT_MODEL_ID = 'glm-4.5v'
const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_DEFAULT_MODEL_ID = 'openai/gpt-4.1-mini'
const KILO_GATEWAY_DEFAULT_BASE_URL = 'https://api.kilo.ai/api/gateway'
const KILO_GATEWAY_DEFAULT_MODEL_ID = 'laguna-m.1:free'
const ROUTEWAY_DEFAULT_BASE_URL = 'https://api.routeway.ai/v1'

const projectTypeRules: Array<{ type: string; pattern: RegExp }> = [
  { type: 'website', pattern: /\b(discord|youtube|chrome|browser ui|video platform|community app|chat app)\b/i },
  { type: 'website', pattern: /\b(website|landing page|portfolio|frontend|html|css|javascript site)\b/i },
  { type: 'react', pattern: /\b(react|webapp|dashboard|admin panel|saas|community dashboard)\b/i },
  { type: 'electron', pattern: /\b(electron|desktop app|windows app)\b/i },
  { type: 'node', pattern: /\bnode(\.js)?\b/i },
  { type: 'python', pattern: /\bpython\b/i },
  { type: 'typescript', pattern: /\btypescript|\bts\b/i },
  { type: 'javascript', pattern: /\bjavascript|\bjs\b/i },
  { type: 'java', pattern: /\bjava\b/i },
  { type: 'cpp', pattern: /\bc\+\+|\bcpp\b/i },
  { type: 'c', pattern: /\bc(?:\s+code)?\b/i }
]

const kiloExecutionPromptPattern =
  /\b(run build|fix errors?|debug|refactor|tests?\s+run|run tests?|build error|file edit|apply patch|lint|npm run build|npm test|package install|component banao|implement|fix this)\b/i

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

const debugBuilder = (stage: string, payload: Record<string, unknown>) => {
  const sanitized = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  )
  console.info(`[BUILDER_DEBUG] ${stage}`, sanitized)
}

const shouldUseKiloForPrompt = (prompt: string) => kiloExecutionPromptPattern.test(prompt || '')

const normalizePrompt = (prompt: string) => prompt.toLowerCase().replace(/\s+/g, ' ').trim()

const classifyBuilderPrompt = (prompt: string, currentFiles?: ProjectFile[]): BuilderPromptIntent => {
  const normalized = normalizePrompt(prompt)
  if (!normalized) return 'NORMAL_CHAT'

  if (
    /^(hey|hi|hello|hii|yo|thanks|thank you|ok|okay|hmm|hm|cool|great|nice)$/.test(normalized) ||
    /^(kya haal hai|kaise ho|how are you|what can you do)\??$/.test(normalized)
  ) {
    return 'NORMAL_CHAT'
  }

  if (
    /\b(npm|pnpm|yarn|bun|node|python|pip|gradle|cargo)\b/.test(normalized) &&
    /\b(run|start|build|test|install|chalao|execute)\b/.test(normalized)
  ) {
    return 'RUN_COMMAND'
  }

  if (
    /\b(index\.html|style\.css|script\.js|readme\.md|src\/|component|file|folder|fix|edit|update|change|modify|refactor|replace|add|remove|implement)\b/.test(
      normalized
    ) &&
    (currentFiles?.length || /\b(css|html|javascript|js|ts|tsx|react|python|java|c\+\+|cpp)\b/.test(normalized))
  ) {
    return 'CODING_EDIT'
  }

  if (
    /\b(website|web app|webapp|landing page|portfolio|dashboard|admin panel|app|project|calculator|game|discord|youtube|chrome|browser|page|ui)\b/.test(
      normalized
    ) &&
    /\b(banao|banado|bana do|build|create|generate|make|develop|design)\b/.test(normalized)
  ) {
    return 'CODING_GENERATE'
  }

  if (
    /\b(explain|samjhao|review|analyze|analysis|what is|how does|read this|understand|summary)\b/.test(normalized)
  ) {
    return 'EXPLAIN_CODE'
  }

  if (
    /\b(fix error|bug|debug|login page|feature add|responsive karo|dark theme|style update)\b/.test(normalized)
  ) {
    return currentFiles?.length ? 'CODING_EDIT' : 'CODING_GENERATE'
  }

  return 'NORMAL_CHAT'
}

const resolveProviderName = (provider: string | undefined, providerUsed: string): ProviderName => {
  if (provider === 'kiloGateway') return 'kiloGateway'
  if (provider === 'routeway') return 'routeway'
  if (provider === 'zai') return 'zai'
  if (provider === 'gemini') return 'gemini'
  if (provider === 'openrouter') return 'openrouter'
  if (provider === 'kimi') return 'kimi'
  if (provider === 'groq') return 'groq'
  if (provider === 'glm') return 'glm'

  const normalized = (providerUsed || '').toLowerCase()
  if (normalized.includes('kilo gateway')) return 'kiloGateway'
  if (normalized.includes('routeway')) return 'routeway'
  if (normalized.includes('gemini')) return 'gemini'
  if (normalized.includes('z.ai')) return 'zai'
  if (normalized.includes('openrouter')) return 'openrouter'
  if (normalized.includes('kimi')) return 'kimi'
  if (normalized.includes('groq')) return 'groq'
  return 'glm'
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
          : language.includes('tsx') || language === 'tsx'
            ? 'tsx'
            : language.includes('jsx') || language === 'jsx'
              ? 'jsx'
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
                      : ''
    if (!extension) continue
    const defaultName =
      extension === 'html'
        ? 'index.html'
        : extension === 'css'
          ? 'style.css'
          : extension === 'tsx'
            ? index === 0
              ? 'src/App.tsx'
              : `src/generated-${index + 1}.tsx`
            : extension === 'jsx'
              ? index === 0
                ? 'src/App.jsx'
                : `src/generated-${index + 1}.jsx`
          : extension === 'js'
            ? 'script.js'
            : extension === 'ts'
              ? index === 0
                ? 'src/main.ts'
                : `src/generated-${index + 1}.ts`
            : `generated-${index + 1}.${extension}`
    files.push({ path: defaultName, content })
    index += 1
  }

  return files
}

const createFallbackWebsiteFiles = (prompt: string): ProjectFile[] => {
  const lower = prompt.toLowerCase()
  const escapedPrompt = prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')

  if (/\b(car game|racing game|race game|driving game|car racing|vehicle game)\b/.test(lower)) {
    return [
      {
        path: 'index.html',
        content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>ALPHA Turbo Run</title><link rel="stylesheet" href="style.css"/></head><body><main class="game-shell"><header class="hud"><div><p class="eyebrow">ALPHA ARCADE</p><h1>Turbo Run</h1><p>${escapedPrompt}</p></div><div class="scoreboard"><span>Score</span><strong id="score">0</strong></div></header><section class="arena-wrap"><canvas id="gameCanvas" width="420" height="640" aria-label="Car game canvas"></canvas><aside class="controls"><h2>Controls</h2><p>Use left/right arrows or A/D to dodge traffic.</p><button id="restartBtn">Restart</button></aside></section></main><script src="script.js"></script></body></html>`
      },
      {
        path: 'style.css',
        content: `*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#38bdf81f,transparent 24%),radial-gradient(circle at 78% 10%,#f472b61a,transparent 24%),#050505;color:#fff;font-family:Inter,system-ui,sans-serif}.game-shell{min-height:100vh;padding:24px;display:grid;gap:18px}.hud,.arena-wrap,.controls{border:1px solid rgba(255,255,255,.08);background:linear-gradient(160deg,rgba(12,14,18,.92),rgba(15,18,26,.84));backdrop-filter:blur(24px);box-shadow:0 24px 80px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.04)}.hud{border-radius:28px;padding:24px;display:flex;align-items:end;justify-content:space-between;gap:16px}.eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:11px;color:#22d3ee}.hud h1{margin:8px 0 10px;font-size:40px}.hud p{margin:0;color:#a1a1aa;max-width:640px}.scoreboard{min-width:120px;padding:16px 18px;border-radius:22px;background:rgba(255,255,255,.04);display:grid;gap:6px;text-align:right}.scoreboard span{font-size:12px;color:#a1a1aa}.scoreboard strong{font-size:36px}.arena-wrap{border-radius:32px;padding:20px;display:grid;grid-template-columns:minmax(0,420px) 260px;gap:18px;justify-content:center;align-items:start}.controls{border-radius:26px;padding:22px}.controls h2{margin:0 0 10px}.controls p{margin:0 0 18px;color:#a1a1aa;line-height:1.6}#restartBtn{border:none;border-radius:16px;padding:12px 16px;background:linear-gradient(135deg,#22d3ee,#8b5cf6);color:#fff;font-weight:700;cursor:pointer}canvas{width:100%;max-width:420px;border-radius:26px;background:linear-gradient(180deg,#0b1220,#111827);border:1px solid rgba(255,255,255,.06);justify-self:center}@media(max-width:960px){.arena-wrap{grid-template-columns:1fr}.controls{order:-1}}`
      },
      {
        path: 'script.js',
        content: `const canvas=document.getElementById('gameCanvas');const ctx=canvas.getContext('2d');const scoreEl=document.getElementById('score');const restartBtn=document.getElementById('restartBtn');const laneWidth=100;const roadX=60;let state;const reset=()=>{state={playerLane:1,cars:[],score:0,tick:0,gameOver:false}};const spawnCar=()=>{const lane=Math.floor(Math.random()*3);state.cars.push({lane,y:-120,speed:4+Math.random()*2})};const drawRoad=()=>{ctx.fillStyle='#0f172a';ctx.fillRect(roadX,0,laneWidth*3,canvas.height);ctx.strokeStyle='rgba(255,255,255,0.18)';ctx.lineWidth=4;for(let i=1;i<3;i++){ctx.setLineDash([24,18]);ctx.beginPath();ctx.moveTo(roadX+laneWidth*i,0);ctx.lineTo(roadX+laneWidth*i,canvas.height);ctx.stroke()}ctx.setLineDash([])};const drawCar=(x,y,color)=>{ctx.fillStyle=color;ctx.fillRect(x+18,y,64,108);ctx.fillStyle='rgba(255,255,255,0.25)';ctx.fillRect(x+28,y+10,44,20)};const loop=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);drawRoad();if(!state.gameOver){state.tick+=1;if(state.tick%36===0)spawnCar();state.cars.forEach((car)=>{car.y+=car.speed;if(car.y>canvas.height+120){state.score+=10;scoreEl.textContent=String(state.score)}});state.cars=state.cars.filter((car)=>car.y<canvas.height+120);const playerX=roadX+state.playerLane*laneWidth;drawCar(playerX,500,'#22d3ee');state.cars.forEach((car)=>{const x=roadX+car.lane*laneWidth;drawCar(x,car.y,'#f472b6');if(car.lane===state.playerLane&&car.y+108>500&&car.y<608){state.gameOver=true}})}else{ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';ctx.font='bold 36px Inter';ctx.fillText('Game Over',110,280);ctx.font='16px Inter';ctx.fillText('Press Restart to play again',110,320)}requestAnimationFrame(loop)};window.addEventListener('keydown',(event)=>{if(state.gameOver)return;if(event.key==='ArrowLeft'||event.key.toLowerCase()==='a')state.playerLane=Math.max(0,state.playerLane-1);if(event.key==='ArrowRight'||event.key.toLowerCase()==='d')state.playerLane=Math.min(2,state.playerLane+1)});restartBtn?.addEventListener('click',()=>{reset();scoreEl.textContent='0'});reset();loop();`
      },
      {
        path: 'README.md',
        content: `# ALPHA Turbo Run\n\nPrompt: ${prompt}\n\nCar game fallback scaffold with canvas driving gameplay.\n`
      }
    ]
  }

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

  if (/\bdiscord|server|friend add|dm|chat app|community\b/.test(lower)) {
    return [
      {
        path: 'index.html',
        content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>ALPHA Community UI</title><link rel="stylesheet" href="style.css"/></head><body><main class="discord-shell"><aside class="server-rail"><button class="server active">A</button><button class="server">C</button><button class="server">+</button></aside><aside class="channel-panel"><div><p class="eyebrow">ALPHA HUB</p><h1>Friends & Chats</h1></div><div class="search-chip">Find friend</div><section class="friend-list"><article class="friend-card active"><strong>Thunder</strong><span>Online now</span></article><article class="friend-card"><strong>Noir</strong><span>Design sync</span></article><article class="friend-card"><strong>Rogue</strong><span>Game night</span></article></section><button class="add-friend">Add Friend</button></aside><section class="chat-panel"><header class="chat-header"><div><h2>ALPHA Community Chat</h2><p>${escapedPrompt}</p></div><button class="invite-btn">Invite</button></header><section class="message-feed"><article class="message"><strong>Thunder</strong><p>Let's ship the next update tonight.</p></article><article class="message"><strong>Noir</strong><p>UI pass is ready for preview.</p></article><article class="message user"><strong>You</strong><p>Friend add flow + direct messaging should feel instant.</p></article></section><footer class="composer"><input placeholder="Message the channel"/><button>Send</button></footer></section></main><script src="script.js"></script></body></html>`
      },
      {
        path: 'style.css',
        content: `*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#22d3ee15,transparent 22%),radial-gradient(circle at 82% 12%,#8b5cf620,transparent 20%),#050505;color:#fff;font-family:Inter,system-ui,sans-serif}.discord-shell{min-height:100vh;display:grid;grid-template-columns:84px 320px 1fr;gap:18px;padding:18px}.server-rail,.channel-panel,.chat-panel{border:1px solid rgba(255,255,255,.08);background:linear-gradient(160deg,rgba(12,14,18,.92),rgba(15,18,26,.84));backdrop-filter:blur(24px);box-shadow:0 24px 80px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.04)}.server-rail{border-radius:28px;padding:16px;display:flex;flex-direction:column;gap:12px;align-items:center}.server{width:44px;height:44px;border:none;border-radius:16px;background:rgba(255,255,255,.06);color:#fff;font-weight:700}.server.active{background:linear-gradient(135deg,#22d3ee,#8b5cf6)}.channel-panel{border-radius:30px;padding:24px;display:grid;grid-template-rows:auto auto 1fr auto;gap:16px}.eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:11px;color:#22d3ee}.channel-panel h1{margin:6px 0 0;font-size:28px}.search-chip{border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:12px 14px;background:#0c0f16;color:#a1a1aa}.friend-list{display:grid;gap:12px}.friend-card{padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.04);display:grid;gap:4px;color:#a1a1aa}.friend-card.active{border:1px solid rgba(34,211,238,.24);background:rgba(34,211,238,.08)}.add-friend,.invite-btn,.composer button{border:none;border-radius:16px;padding:12px 16px;background:linear-gradient(135deg,#22d3ee,#8b5cf6);color:#fff;font-weight:600}.chat-panel{border-radius:32px;padding:24px;display:grid;grid-template-rows:auto 1fr auto;gap:20px}.chat-header{display:flex;align-items:center;justify-content:space-between;gap:16px}.chat-header h2{margin:0 0 8px;font-size:28px}.chat-header p{margin:0;color:#a1a1aa}.message-feed{display:grid;gap:12px;align-content:start}.message{max-width:720px;padding:16px 18px;border-radius:22px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}.message.user{justify-self:end;background:rgba(139,92,246,.18);border-color:rgba(139,92,246,.26)}.message strong{display:block;margin-bottom:8px}.message p{margin:0;color:#d4d4d8;line-height:1.6}.composer{display:flex;gap:12px;padding:14px;border-radius:22px;background:#0b0d12;border:1px solid rgba(255,255,255,.07)}.composer input{flex:1;background:transparent;border:none;outline:none;color:#fff}@media(max-width:1100px){.discord-shell{grid-template-columns:1fr}.server-rail{flex-direction:row;justify-content:center}.channel-panel,.chat-panel{min-height:unset}}`
      },
      { path: 'script.js', content: `console.log('ALPHA community UI ready')` },
      { path: 'README.md', content: `# ALPHA Community Website\n\nPrompt: ${prompt}\n\nDiscord-inspired original community UI with friends, DMs, and message areas.\n` }
    ]
  }

  if (/\byoutube\b/.test(lower)) {
    return [
      {
        path: 'index.html',
        content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>ALPHA Stream Grid</title><link rel="stylesheet" href="style.css"/></head><body><main class="video-shell"><aside class="video-sidebar"><h1>ALPHA Stream</h1><nav><a>Home</a><a>Trending</a><a>Subscriptions</a><a>Library</a></nav></aside><section class="video-main"><header class="video-topbar"><div class="searchbar">Search videos, creators, playlists</div><button>Create</button></header><section class="hero-player"><div class="player-frame">Featured Player</div><div><p class="eyebrow">VIDEO PLATFORM</p><h2>Original streaming layout</h2><p>${escapedPrompt}</p></div></section><section class="video-grid"><article><div class="thumb"></div><h3>Network Security Crash Course</h3><p>12 min</p></article><article><div class="thumb"></div><h3>Glass UI Motion Pack</h3><p>9 min</p></article><article><div class="thumb"></div><h3>Creator Studio Dashboard</h3><p>17 min</p></article><article><div class="thumb"></div><h3>Alpha Channel Live</h3><p>Live</p></article></section></section></main><script src="script.js"></script></body></html>`
      },
      {
        path: 'style.css',
        content: `*{box-sizing:border-box}body{margin:0;background:#050505;color:#fff;font-family:Inter,system-ui,sans-serif}.video-shell{min-height:100vh;display:grid;grid-template-columns:250px 1fr;gap:18px;padding:18px;background:radial-gradient(circle at top,#f472b618,transparent 18%),radial-gradient(circle at 78% 10%,#22d3ee14,transparent 24%),#050505}.video-sidebar,.video-topbar,.hero-player,.video-grid article{border:1px solid rgba(255,255,255,.08);background:linear-gradient(160deg,rgba(12,14,18,.9),rgba(15,18,26,.82));backdrop-filter:blur(24px);box-shadow:0 24px 80px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.04)}.video-sidebar{border-radius:30px;padding:26px}.video-sidebar h1{margin:0 0 18px;font-size:28px}.video-sidebar nav{display:grid;gap:12px;color:#a1a1aa}.video-main{display:grid;gap:18px}.video-topbar{border-radius:24px;padding:16px;display:flex;gap:12px;align-items:center}.searchbar{flex:1;border-radius:16px;padding:14px;background:#0b0d12;color:#a1a1aa}.video-topbar button{border:none;border-radius:16px;padding:12px 16px;background:linear-gradient(135deg,#22d3ee,#8b5cf6);color:#fff}.hero-player{border-radius:30px;padding:24px;display:grid;grid-template-columns:1.2fr .8fr;gap:20px}.player-frame{min-height:280px;border-radius:26px;background:linear-gradient(160deg,#0b0d12,#111827);display:grid;place-items:center;color:#a1a1aa;border:1px solid rgba(255,255,255,.06)}.eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:11px;color:#22d3ee}.hero-player h2{font-size:34px;margin:12px 0}.hero-player p{color:#a1a1aa;line-height:1.7}.video-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.video-grid article{border-radius:24px;padding:16px}.thumb{aspect-ratio:16/9;border-radius:18px;background:linear-gradient(135deg,rgba(34,211,238,.2),rgba(139,92,246,.2));margin-bottom:14px}.video-grid h3{margin:0 0 8px;font-size:16px}.video-grid p{margin:0;color:#a1a1aa}@media(max-width:1100px){.video-shell{grid-template-columns:1fr}.hero-player{grid-template-columns:1fr}.video-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`
      },
      { path: 'script.js', content: `console.log('ALPHA stream UI ready')` },
      { path: 'README.md', content: `# ALPHA Stream Website\n\nPrompt: ${prompt}\n\nOriginal YouTube-inspired video platform UI.\n` }
    ]
  }

  if (/\bchrome|browser\b/.test(lower)) {
    return [
      {
        path: 'index.html',
        content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>ALPHA Browser UI</title><link rel="stylesheet" href="style.css"/></head><body><main class="browser-shell"><header class="browser-top"><div class="tab-row"><button class="tab active">ALPHA</button><button class="tab">Docs</button><button class="tab add">+</button></div><div class="toolbar"><button class="nav">&#10094;</button><button class="nav">&#10095;</button><button class="nav">&#8635;</button><div class="address-bar">alpha://workspace/browser-ui</div><button class="profile">User</button></div></header><section class="browser-body"><aside class="browser-side"><h2>Collections</h2><ul><li>Recent tabs</li><li>Bookmarks</li><li>Profiles</li><li>History</li></ul></aside><section class="browser-viewport"><article class="browser-hero"><p class="eyebrow">BROWSER INSPIRED</p><h1>Original ALPHA browser-style layout</h1><p>${escapedPrompt}</p></article><div class="browser-grid"><article><h3>Tab System</h3><p>Multi-tab header and quick action rail.</p></article><article><h3>Address Bar</h3><p>Search-ready top bar with original styling.</p></article><article><h3>Workspace</h3><p>Panels for cards, sites, and browsing flows.</p></article></div></section></section></main><script src="script.js"></script></body></html>`
      },
      {
        path: 'style.css',
        content: `*{box-sizing:border-box}body{margin:0;background:#050505;color:#fff;font-family:Inter,system-ui,sans-serif}.browser-shell{min-height:100vh;padding:18px;background:radial-gradient(circle at top,#22d3ee16,transparent 20%),radial-gradient(circle at 82% 10%,#8b5cf61f,transparent 20%),#050505}.browser-top,.browser-side,.browser-hero,.browser-grid article{border:1px solid rgba(255,255,255,.08);background:linear-gradient(160deg,rgba(12,14,18,.92),rgba(15,18,26,.84));backdrop-filter:blur(24px);box-shadow:0 24px 80px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.04)}.browser-top{padding:18px;border-radius:28px}.tab-row{display:flex;gap:10px;margin-bottom:12px}.tab{border:none;border-radius:16px;padding:10px 14px;background:rgba(255,255,255,.06);color:#fff}.tab.active{background:linear-gradient(135deg,#22d3ee,#8b5cf6)}.toolbar{display:flex;gap:10px;align-items:center}.nav,.profile{border:none;border-radius:14px;padding:10px 12px;background:rgba(255,255,255,.05);color:#fff}.address-bar{flex:1;padding:12px 16px;border-radius:16px;background:#0b0d12;color:#a1a1aa}.browser-body{display:grid;grid-template-columns:260px 1fr;gap:18px;margin-top:18px}.browser-side{border-radius:30px;padding:24px}.browser-side h2{margin:0 0 14px}.browser-side ul{list-style:none;padding:0;margin:0;display:grid;gap:10px;color:#a1a1aa}.browser-viewport{display:grid;gap:18px}.browser-hero{border-radius:30px;padding:28px}.eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:11px;color:#22d3ee}.browser-hero h1{font-size:42px;margin:14px 0}.browser-hero p{color:#a1a1aa;line-height:1.7}.browser-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.browser-grid article{border-radius:24px;padding:18px}.browser-grid h3{margin:0 0 8px}.browser-grid p{margin:0;color:#a1a1aa}@media(max-width:1000px){.browser-body{grid-template-columns:1fr}.browser-grid{grid-template-columns:1fr}}`
      },
      { path: 'script.js', content: `console.log('ALPHA browser UI ready')` },
      { path: 'README.md', content: `# ALPHA Browser-inspired Website\n\nPrompt: ${prompt}\n\nOriginal browser UI, not official Chrome assets.\n` }
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

const extractProviderFiles = (payload: any, prompt: string, projectType: string): FileExtractionResult => {
  if (Array.isArray(payload)) {
    payload = { files: payload }
  } else if (payload?.project && Array.isArray(payload.project.files)) {
    payload = {
      ...payload,
      projectName: payload.projectName || payload.project.name,
      projectType: payload.projectType || payload.project.type,
      summary: payload.summary || payload.project.summary,
      files: payload.project.files
    }
  }

  const incoming = Array.isArray(payload?.files) ? payload.files : []
  const files = incoming
    .filter((file) => typeof file?.path === 'string' && typeof file?.content === 'string')
    .map((file) => ({
      path: file.path.replace(/\\/g, '/').replace(/^\/+/, ''),
      content: file.content
    }))

  if (files.length) {
    debugBuilder('provider-parse', {
      projectType,
      promptLength: prompt.length,
      structuredFiles: files.length,
      fallbackUsed: false
    })
    return { files, source: 'structured' }
  }

  if (typeof payload?.rawText === 'string') {
    const codeBlockFiles = extractCodeBlockFiles(payload.rawText)
    if (codeBlockFiles.length) {
      debugBuilder('provider-parse', {
        projectType,
        promptLength: prompt.length,
        codeBlockFiles: codeBlockFiles.length,
        fallbackUsed: false
      })
      const hasReadme = codeBlockFiles.some((file) => file.path.toLowerCase() === 'readme.md')
      return {
        files: hasReadme
          ? codeBlockFiles
          : [
              ...codeBlockFiles,
              {
                path: 'README.md',
                content: `# ALPHA generated project\n\nPrompt: ${prompt}\n`
              }
            ],
        source: 'codeblocks'
      }
    }
  }

  debugBuilder('provider-parse', {
    projectType,
    promptLength: prompt.length,
    codeBlockFiles: 0,
    fallbackUsed: false,
    usableFiles: false
  })
  return { files: [], source: 'fallback' }
}

const createPromptAwareFallbackFiles = (prompt: string, projectType: string): ProjectFile[] => {
  if (projectType === 'website' || projectType === 'react') {
    debugBuilder('provider-fallback', {
      projectType,
      promptLength: prompt.length,
      fallbackUsed: true
    })
    return createFallbackWebsiteFiles(prompt)
  }

  debugBuilder('provider-fallback', {
    projectType,
    promptLength: prompt.length,
    fallbackUsed: true
  })
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

const parseProviderSelection = (
  provider: ProviderSelection | ProviderName | string | undefined,
  providerUsed?: string
): ProviderSelection => {
  if (provider && typeof provider === 'object' && 'provider' in provider) {
    return {
      provider: provider.provider,
      slot: provider.slot,
      modelId: provider.modelId,
      baseUrl: provider.baseUrl,
      providerMode: provider.providerMode,
      apiKey: provider.apiKey,
      label: provider.label
    }
  }

  return {
    provider: resolveProviderName(typeof provider === 'string' ? provider : undefined, providerUsed || '')
  }
}

const getProviderDefaults = (provider: ProviderName) => {
  switch (provider) {
    case 'glm':
      return { baseUrl: ZENMUX_DEFAULT_BASE_URL, modelId: ZENMUX_DEFAULT_MODEL_ID, providerMode: 'openai-compatible' }
    case 'zai':
      return { baseUrl: ZAI_DEFAULT_BASE_URL, modelId: ZAI_DEFAULT_MODEL_ID, providerMode: 'zai-coding' }
    case 'openrouter':
      return { baseUrl: OPENROUTER_DEFAULT_BASE_URL, modelId: OPENROUTER_DEFAULT_MODEL_ID, providerMode: 'openai-compatible' }
    case 'kiloGateway':
      return { baseUrl: KILO_GATEWAY_DEFAULT_BASE_URL, modelId: KILO_GATEWAY_DEFAULT_MODEL_ID, providerMode: 'openai-compatible' }
    case 'routeway':
      return { baseUrl: ROUTEWAY_DEFAULT_BASE_URL, modelId: '', providerMode: 'openai-compatible' }
    case 'groq':
      return { baseUrl: 'https://api.groq.com/openai/v1', modelId: 'llama-3.1-8b-instant', providerMode: 'openai-compatible' }
    case 'kimi':
      return { baseUrl: 'https://api.moonshot.ai/v1', modelId: 'moonshot-v1-8k', providerMode: 'openai-compatible' }
    case 'gemini':
      return { baseUrl: '', modelId: 'gemini-2.5-flash', providerMode: 'gemini-native' }
    default:
      return { baseUrl: '', modelId: '', providerMode: '' }
  }
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

  const normalizeCompatibleSlots = (
    secureData: Record<string, any>,
    group: 'openrouter' | 'kiloGateway' | 'routeway'
  ): KeySlot[] => {
    const keySlots = secureData.keySlots || {}
    const slots = Array.isArray(keySlots[group]) ? keySlots[group] : []
    const defaults = getProviderDefaults(group)
    const slotCount = group === 'openrouter' ? 6 : 3
    keySlots[group] = Array.from({ length: slotCount }, (_, index) => index + 1).map((slot) => {
      const existing = slots.find((item: KeySlot) => item?.slot === slot) || {}
      return {
        slot,
        key: existing.key || '',
        enabled: typeof existing.enabled === 'boolean' ? existing.enabled : true,
        status: existing.status || (existing.key ? 'available' : 'empty'),
        baseUrl:
          typeof existing.baseUrl === 'string' && existing.baseUrl.trim()
            ? existing.baseUrl.trim()
            : defaults.baseUrl,
        modelId:
          typeof existing.modelId === 'string' && existing.modelId.trim()
            ? existing.modelId.trim()
            : defaults.modelId,
        providerMode:
          typeof existing.providerMode === 'string' && existing.providerMode.trim()
            ? existing.providerMode.trim()
            : defaults.providerMode,
        lastFailureReason: existing.lastFailureReason || '',
        lastCheckedAt: existing.lastCheckedAt || '',
        lastUsedAt: existing.lastUsedAt || ''
      }
    })
    secureData.keySlots = keySlots
    return keySlots[group]
  }

  const getConfiguredCompatibleSlot = (
    secureData: Record<string, any>,
    group: 'openrouter' | 'kiloGateway' | 'routeway',
    preferredSlot?: number
  ) => {
    const slots = normalizeCompatibleSlots(secureData, group)
    const usable = slots.filter((slot) => slot.enabled && decryptVaultValue(slot.key))
    if (!usable.length) return null
    const selected =
      usable.find((slot) => slot.slot === preferredSlot && slot.status !== 'failed' && slot.status !== 'rate-limited') ||
      usable.find((slot) => slot.status === 'active') ||
      usable.find((slot) => slot.status === 'available') ||
      usable[0]
    selected.lastUsedAt = new Date().toISOString()
    return selected
  }

  const markActiveCompatibleSlot = (
    secureData: Record<string, any>,
    group: 'openrouter' | 'kiloGateway' | 'routeway',
    slotNumber: number
  ) => {
    const slots = normalizeCompatibleSlots(secureData, group)
    secureData.activeKeySlots = secureData.activeKeySlots || {}
    secureData.activeKeySlots[group] = slotNumber
    secureData.keySlots[group] = slots.map((slot) => ({
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

  const markCompatibleFailure = (
    secureData: Record<string, any>,
    group: 'openrouter' | 'kiloGateway' | 'routeway',
    slotNumber: number,
    status: string,
    reason: string
  ) => {
    const slots = normalizeCompatibleSlots(secureData, group)
    secureData.keySlots[group] = slots.map((slot) =>
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

  const getBasicProviderSlot = (
    secureData: Record<string, any>,
    group: 'groq' | 'kimi',
    preferredSlot?: number
  ) => {
    const slots = Array.isArray(secureData.keySlots?.[group]) ? secureData.keySlots[group] : []
    const usable = slots.filter((slot: KeySlot) => slot?.enabled && decryptVaultValue(slot?.key))
    if (!usable.length) return null
    return usable.find((slot: KeySlot) => slot.slot === preferredSlot) || usable[0]
  }

  const buildSelectedProviderMissingMessage = (selection: ProviderSelection) => {
    if (selection.provider === 'kiloGateway') {
      return 'Kilo Gateway API key missing hai. Settings me Kilo Gateway key add karo ya doosra model select karo.'
    }
    if (selection.provider === 'gemini') {
      return 'Gemini key missing hai. Settings me Gemini key add karo ya doosra model select karo.'
    }
    const providerLabels: Record<Exclude<ProviderName, 'kiloGateway' | 'gemini'>, string> = {
      glm: 'GLM',
      zai: 'Z.AI',
      openrouter: 'OpenRouter',
      kimi: 'Kimi',
      groq: 'Groq',
      routeway: 'Routeway'
    }
    const label =
      selection.label ||
      providerLabels[selection.provider]
    return `${label} configured nahi hai. Model settings check karo ya doosra model select karo.`
  }
  const buildProjectSystemPrompt = (
    providerLabel: string,
    prompt: string,
    projectType: string,
    currentFiles?: ProjectFile[]
  ) =>
    [
      `You are ALPHA coding engine using ${providerLabel}.`,
      `The detected project type is ${projectType}.`,
      'Return strict JSON only.',
      'Schema:',
      '{"projectName":"string","projectType":"string","summary":"string","files":[{"path":"relative/path","content":"file contents"}]}',
      'Never wrap output in markdown.',
      'Never return explanation-only answers.',
      'Do not create generated-1.txt, output.txt, response.txt, or random text dump files unless explicitly asked.',
      currentFiles?.length
        ? 'You are editing an existing project. Respect current files and return only needed updated files or a complete corrected file map.'
        : 'You are creating a fresh project from the user request.',
      'For websites include at least index.html, style.css, script.js, README.md.',
      'For React/webapp prompts prefer package.json, index.html, src/main.tsx, src/App.tsx, src/styles.css, README.md.',
      'For calculator prompts return a real working calculator UI and JS interactions.',
      /\b(car game|racing game|drive|driving|race)\b/i.test(prompt)
        ? 'For car-game requests create a game-themed project with game area or canvas, controls, score/state, and real gameplay logic. Do not return a presentation scaffold.'
        : '',
      /\bdiscord|friend add|dm|community|chat\b/i.test(prompt)
        ? 'For Discord-like requests create an original community/chat UI with server rail, friends list, message area, and add-friend flow. Do not return a generic presentation scaffold.'
        : '',
      /\byoutube\b/i.test(prompt)
        ? 'For YouTube-like requests create an original video platform style UI with sidebar, search, player or video cards. Do not return a generic presentation scaffold.'
        : '',
      /\bchrome|browser\b/i.test(prompt)
        ? 'For Chrome-like/browser-inspired requests create an original browser shell with tabs, address bar, toolbar, and content area. Do not use official logos or assets.'
        : '',
      /\badvanced|premium|3d|animated|glass|glassmorphism|badhiya\b/i.test(prompt)
        ? 'The user wants premium output. Use polished sections, meaningful styling, and interactions. Avoid a basic hero + cards scaffold unless the prompt truly asks for that.'
        : ''
    ]
      .filter(Boolean)
      .join(' ')

  const buildProjectUserPrompt = (prompt: string, projectType: string, currentFiles?: ProjectFile[]) =>
    currentFiles?.length
      ? `Update this existing project for the request.\nDetected project type: ${projectType}\nRequest: ${prompt}\nCurrent file tree:\n${currentFiles.map((file) => file.path).join('\n')}\nCurrent files:\n${JSON.stringify(currentFiles.slice(0, 12))}`
      : `Create a project for this request.\nDetected project type: ${projectType}\nRequest: ${prompt}`

  const buildChatSystemPrompt = (
    providerLabel: string,
    prompt: string,
    currentFiles?: ProjectFile[]
  ) =>
    [
      `You are ALPHA Builder assistant using ${providerLabel}.`,
      'Reply conversationally in concise plain text.',
      'Do not return project JSON, file maps, or markdown code fences unless the user explicitly asks for code snippets.',
      'If the user is greeting, answering casually is enough.',
      currentFiles?.length
        ? `You currently have project context with these files:\n${currentFiles.map((file) => file.path).slice(0, 24).join('\n')}`
        : 'No active project files are required for this reply.',
      /\b(explain|samjhao|review|analyze|summary)\b/i.test(prompt)
        ? 'Focus on explanation and guidance only. Do not edit files.'
        : 'Answer helpfully without editing files.'
    ]
      .filter(Boolean)
      .join(' ')

  const buildChatUserPrompt = (prompt: string, currentFiles?: ProjectFile[]) =>
    currentFiles?.length
      ? `Answer this builder chat message without changing files.\nUser message: ${prompt}\nRelevant file tree:\n${currentFiles.map((file) => file.path).join('\n')}`
      : `Answer this builder chat message without changing files.\nUser message: ${prompt}`

  const extractCompatibleResponseText = (data: any) => {
    const direct = data?.choices?.[0]?.message?.content
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
    if (Array.isArray(direct)) {
      const joined = direct
        .map((item) => {
          if (typeof item === 'string') return item
          if (typeof item?.text === 'string') return item.text
          return ''
        })
        .join('')
        .trim()
      if (joined) return joined
    }

    const outputText =
      data?.output_text?.trim?.() ||
      data?.response?.output_text?.trim?.() ||
      data?.result?.output_text?.trim?.()
    if (outputText) return outputText

    return ''
  }

  const parseProviderPayload = (content: string, providerLabel: string): ProviderResult => {
    debugBuilder('provider-response', {
      providerLabel,
      responseLength: content.length,
      hasCodeFence: /```/.test(content),
      hasJsonShape: content.includes('"files"') || content.includes('{')
    })
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

  const callGeminiProjectProvider = async (
    prompt: string,
    currentFiles?: ProjectFile[],
    signal?: AbortSignal
  ): Promise<ProviderResult> => {
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

    const projectType = detectProjectType(prompt)
    debugBuilder('provider-call', {
      provider: 'gemini',
      selectedModel: 'gemini-2.5-flash',
      promptLength: prompt.length,
      projectType,
      existingFiles: currentFiles?.length || 0
    })
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
          encodeURIComponent(geminiKey),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildProjectSystemPrompt('Gemini 2.5 Flash', prompt, projectType, currentFiles) }] },
            contents: [{ role: 'user', parts: [{ text: buildProjectUserPrompt(prompt, projectType, currentFiles) }] }],
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
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return {
          success: false,
          code: 'REQUEST_CANCELLED',
          message: 'Builder request cancelled.',
          providerLabel: 'Gemini',
          cancelled: true
        }
      }
      return {
        success: false,
        code: 'GEMINI_NETWORK_ERROR',
        message: error?.message || 'Gemini request failed.',
        providerLabel: 'Gemini'
      }
    }
  }

  const callOpenAICompatibleProvider = async (
    prompt: string,
    currentFiles: ProjectFile[] | undefined,
    config: {
      endpoint: string
      key: string
      model: string
      providerLabel: string
      headers?: Record<string, string>
    },
    signal?: AbortSignal
  ): Promise<ProviderResult> => {
    const projectType = detectProjectType(prompt)
    debugBuilder('provider-call', {
      provider: config.providerLabel,
      selectedModel: config.model,
      promptLength: prompt.length,
      projectType,
      existingFiles: currentFiles?.length || 0
    })
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.key}`,
          ...(config.headers || {})
        },
        signal,
        body: JSON.stringify({
          model: config.model,
          temperature: 0.35,
          messages: [
            { role: 'system', content: buildProjectSystemPrompt(config.providerLabel, prompt, projectType, currentFiles) },
            { role: 'user', content: buildProjectUserPrompt(prompt, projectType, currentFiles) }
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
      return parseProviderPayload(extractCompatibleResponseText(data), config.providerLabel)
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return {
          success: false,
          code: 'REQUEST_CANCELLED',
          message: 'Builder request cancelled.',
          providerLabel: config.providerLabel,
          cancelled: true
        }
      }
      return {
        success: false,
        code: `${config.providerLabel.toUpperCase()}_NETWORK_ERROR`,
        message: error?.message || `${config.providerLabel} request failed.`,
        providerLabel: config.providerLabel
      }
    }
  }

  const callGlm = async (
    prompt: string,
    currentFiles?: ProjectFile[],
    selection?: ProviderSelection,
    signal?: AbortSignal
  ): Promise<ProviderResult> => {
    const secureData = readSecureVault()
    const normalizedSlots = normalizeGlmSlots(secureData)
    const selectedSlot =
      selection?.slot != null
        ? normalizedSlots.find(
            (slot) =>
              slot.slot === selection.slot &&
              slot.enabled &&
              decryptVaultValue(slot.key)
          ) || null
        : getActiveGlmSlot(secureData)

    const directKey = selection?.apiKey?.trim() || ''
    if (!selectedSlot && !directKey) {
      writeSecureVault(secureData)
      return {
        success: false,
        code: 'MISSING_GLM_KEY',
        message: buildSelectedProviderMissingMessage(selection || { provider: 'glm' }),
        providerLabel: selection?.label || 'GLM 5.2'
      }
    }

    const key = directKey || decryptVaultValue(selectedSlot?.key).trim()
    const providerMode = selection?.providerMode || selectedSlot?.providerMode || 'openai-compatible'
    const baseUrl = selection?.baseUrl || selectedSlot?.baseUrl || ZENMUX_DEFAULT_BASE_URL
    const modelId = selection?.modelId || selectedSlot?.modelId || ZENMUX_DEFAULT_MODEL_ID
    const providerLabel =
      selection?.label ||
      (providerMode === 'zenmux' || providerMode === 'custom-compatible' || providerMode === 'openai-compatible'
        ? 'ZenMux Compatible GLM'
        : 'GLM 5.2')
    writeSecureVault(secureData)

    const projectType = detectProjectType(prompt)
    debugBuilder('provider-call', {
      provider: 'glm',
      selectedModel: modelId,
      promptLength: prompt.length,
      projectType,
      existingFiles: currentFiles?.length || 0
    })
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
        signal,
        body: JSON.stringify({
          model: modelId,
          temperature: 0.35,
          messages: [
            { role: 'system', content: buildProjectSystemPrompt(providerLabel, prompt, projectType, currentFiles) },
            { role: 'user', content: buildProjectUserPrompt(prompt, projectType, currentFiles) }
          ]
        })
      })

      if (!response.ok) {
        const body = await response.text()
        const failureStatus = response.status === 429 ? 'rate-limited' : 'failed'
        const errorMessage =
          response.status === 401 || response.status === 403
            ? 'ZenMux/GLM auth failed. API key ya model ID check karo.'
            : response.status === 404
              ? 'GLM model ID invalid lag raha hai. Settings me model ID check karo.'
              : `GLM provider error ${response.status}: ${body.slice(0, 180)}`
        if (selectedSlot) {
          const secureDataOnFailure = readSecureVault()
          markGlmFailure(secureDataOnFailure, selectedSlot.slot, failureStatus, errorMessage)
          writeSecureVault(secureDataOnFailure)
        }
        return {
          success: false,
          code: response.status === 404 ? 'GLM_MODEL_INVALID' : response.status === 401 || response.status === 403 ? 'GLM_AUTH_FAILED' : 'GLM_REQUEST_FAILED',
          message: errorMessage,
          providerLabel
        }
      }

      const data = await response.json()
      const content = extractCompatibleResponseText(data)
      const parsed = parseProviderPayload(content, providerLabel)
      if (!parsed.success) return parsed

      if (selectedSlot) {
        const secureDataOnSuccess = readSecureVault()
        markActiveGlmSlot(secureDataOnSuccess, selectedSlot.slot)
        writeSecureVault(secureDataOnSuccess)
      }
      return parsed
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return {
          success: false,
          code: 'REQUEST_CANCELLED',
          message: 'Builder request cancelled.',
          providerLabel,
          cancelled: true
        }
      }
      if (selectedSlot) {
        const secureDataOnFailure = readSecureVault()
        markGlmFailure(secureDataOnFailure, selectedSlot.slot, 'failed', error?.message || 'GLM request failed')
        writeSecureVault(secureDataOnFailure)
      }
      return {
        success: false,
        code: 'GLM_NETWORK_ERROR',
        message: error?.message || 'GLM network request failed.',
        providerLabel
      }
    }
  }

  const callZai = async (
    prompt: string,
    currentFiles?: ProjectFile[],
    selection?: ProviderSelection,
    signal?: AbortSignal
  ): Promise<ProviderResult> => {
    const secureData = readSecureVault()
    const normalizedSlots = normalizeZaiSlots(secureData)
    const selectedSlot =
      selection?.slot != null
        ? normalizedSlots.find(
            (slot) =>
              slot.slot === selection.slot &&
              slot.enabled &&
              decryptVaultValue(slot.key)
          ) || null
        : getActiveZaiSlot(secureData)

    const directKey = selection?.apiKey?.trim() || ''
    if (!selectedSlot && !directKey) {
      writeSecureVault(secureData)
      return {
        success: false,
        code: 'MISSING_ZAI_KEY',
        message: buildSelectedProviderMissingMessage(selection || { provider: 'zai' }),
        providerLabel: selection?.label || 'Z.AI'
      }
    }

    const key = directKey || decryptVaultValue(selectedSlot?.key).trim()
    const providerMode = selection?.providerMode || selectedSlot?.providerMode || 'zai-coding'
    const baseUrl = selection?.baseUrl || selectedSlot?.baseUrl || ZAI_DEFAULT_BASE_URL
    const modelId = selection?.modelId || selectedSlot?.modelId || ZAI_DEFAULT_MODEL_ID
    const providerLabel = selection?.label || 'Z.AI'
    writeSecureVault(secureData)

    const projectType = detectProjectType(prompt)
    debugBuilder('provider-call', {
      provider: 'zai',
      selectedModel: modelId,
      promptLength: prompt.length,
      projectType,
      existingFiles: currentFiles?.length || 0
    })
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
        signal,
        body: JSON.stringify({
          model: modelId,
          temperature: 0.35,
          messages: [
            { role: 'system', content: buildProjectSystemPrompt(providerLabel, prompt, projectType, currentFiles) },
            { role: 'user', content: buildProjectUserPrompt(prompt, projectType, currentFiles) }
          ]
        })
      })

      if (!response.ok) {
        const body = await response.text()
        const failureStatus = response.status === 429 ? 'rate-limited' : 'failed'
        const errorMessage =
          response.status === 401 || response.status === 403
            ? 'Z.AI auth failed. API key ya model ID check karo.'
            : response.status === 404
              ? 'Z.AI model ID invalid lag raha hai. Settings me model ID check karo.'
              : `Z.AI provider error ${response.status}: ${body.slice(0, 180)}`
        if (selectedSlot) {
          const secureDataOnFailure = readSecureVault()
          markZaiFailure(secureDataOnFailure, selectedSlot.slot, failureStatus, errorMessage)
          writeSecureVault(secureDataOnFailure)
        }
        return {
          success: false,
          code: response.status === 404 ? 'ZAI_MODEL_INVALID' : response.status === 401 || response.status === 403 ? 'ZAI_AUTH_FAILED' : 'ZAI_REQUEST_FAILED',
          message: errorMessage,
          providerLabel
        }
      }

      const data = await response.json()
      const content = extractCompatibleResponseText(data)
      const parsed = parseProviderPayload(content, providerLabel)
      if (selectedSlot) {
        const secureDataOnSuccess = readSecureVault()
        markActiveZaiSlot(secureDataOnSuccess, selectedSlot.slot)
        writeSecureVault(secureDataOnSuccess)
      }
      return parsed
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return {
          success: false,
          code: 'REQUEST_CANCELLED',
          message: 'Builder request cancelled.',
          providerLabel,
          cancelled: true
        }
      }
      if (selectedSlot) {
        const secureDataOnFailure = readSecureVault()
        markZaiFailure(secureDataOnFailure, selectedSlot.slot, 'failed', error?.message || 'Z.AI request failed')
        writeSecureVault(secureDataOnFailure)
      }
      return {
        success: false,
        code: 'ZAI_NETWORK_ERROR',
        message: error?.message || 'Z.AI network request failed.',
        providerLabel
      }
    }
  }

  const resolveSelectedCompatibleConfig = (
    selection: ProviderSelection
  ):
    | {
        providerLabel: string
        endpoint: string
        key: string
        model: string
        headers?: Record<string, string>
        statusGroup?: 'openrouter' | 'kiloGateway' | 'routeway'
        slot?: number
      }
    | { error: ProviderResult } => {
    const secureData = readSecureVault()
    const defaults = getProviderDefaults(selection.provider)
    const directKey = selection.apiKey?.trim() || ''

    if (selection.provider === 'openrouter' || selection.provider === 'kiloGateway' || selection.provider === 'routeway') {
      const group = selection.provider
      const chosenSlot =
        !directKey && selection.slot != null
          ? normalizeCompatibleSlots(secureData, group).find(
              (slot) => slot.slot === selection.slot && slot.enabled && decryptVaultValue(slot.key)
            ) || null
          : null
      const fallbackSlot = !directKey ? getConfiguredCompatibleSlot(secureData, group, selection.slot) : null
      const activeSlot = chosenSlot || fallbackSlot
      const key = directKey || decryptVaultValue(activeSlot?.key).trim()
      const model = selection.modelId?.trim() || activeSlot?.modelId?.trim() || defaults.modelId
      const baseUrl = selection.baseUrl?.trim() || activeSlot?.baseUrl?.trim() || defaults.baseUrl
      if (!key) {
        return {
          error: {
            success: false,
            code: `${selection.provider.toUpperCase()}_MISSING_KEY`,
            message: buildSelectedProviderMissingMessage(selection),
            providerLabel: selection.label || selection.provider
          }
        }
      }
      if (!model) {
        return {
          error: {
            success: false,
            code: `${selection.provider.toUpperCase()}_MISSING_MODEL`,
            message: 'Selected model configured nahi hai. Model settings check karo ya doosra model select karo.',
            providerLabel: selection.label || selection.provider
          }
        }
      }
      return {
        providerLabel: selection.label || `${selection.provider}`,
        endpoint: normalizeCompatibleBaseUrl(baseUrl),
        key,
        model,
        headers:
          selection.provider === 'openrouter'
            ? { 'HTTP-Referer': 'https://alpha.local', 'X-Title': 'alpha' }
            : undefined,
        statusGroup: group,
        slot: activeSlot?.slot
      }
    }

    if (selection.provider === 'groq' || selection.provider === 'kimi') {
      const slot = !directKey ? getBasicProviderSlot(secureData, selection.provider, selection.slot) : null
      const key = directKey || decryptVaultValue(slot?.key).trim()
      const model = selection.modelId?.trim() || defaults.modelId
      const baseUrl = selection.baseUrl?.trim() || defaults.baseUrl
      if (!key) {
        return {
          error: {
            success: false,
            code: `${selection.provider.toUpperCase()}_MISSING_KEY`,
            message: buildSelectedProviderMissingMessage(selection),
            providerLabel: selection.label || selection.provider
          }
        }
      }
      return {
        providerLabel: selection.label || (selection.provider === 'groq' ? 'Groq' : 'Kimi'),
        endpoint: normalizeCompatibleBaseUrl(baseUrl),
        key,
        model,
        slot: slot?.slot
      }
    }

    return {
      error: {
        success: false,
        code: 'UNSUPPORTED_PROVIDER',
        message: `${selection.provider} provider currently unsupported.`,
        providerLabel: selection.label || selection.provider
      }
    }
  }

  const callProvider = async (
    providerInput: ProviderSelection | ProviderName | string | undefined,
    prompt: string,
    currentFiles?: ProjectFile[],
    signal?: AbortSignal
  ): Promise<ProviderResult> => {
    const selection = parseProviderSelection(providerInput)

    if (selection.provider === 'glm') return callGlm(prompt, currentFiles, selection, signal)
    if (selection.provider === 'zai') return callZai(prompt, currentFiles, selection, signal)
    if (selection.provider === 'gemini') return callGeminiProjectProvider(prompt, currentFiles, signal)

    const resolved = resolveSelectedCompatibleConfig(selection)
    if ('error' in resolved) return resolved.error

    const result = await callOpenAICompatibleProvider(prompt, currentFiles, {
      endpoint: resolved.endpoint,
      key: resolved.key,
      model: resolved.model,
      providerLabel: resolved.providerLabel,
      headers: resolved.headers
    }, signal)

    if (result.success) {
      if (resolved.statusGroup && resolved.slot) {
        const secureDataOnSuccess = readSecureVault()
        markActiveCompatibleSlot(secureDataOnSuccess, resolved.statusGroup, resolved.slot)
        writeSecureVault(secureDataOnSuccess)
      }
      return result
    }

    if (resolved.statusGroup && resolved.slot) {
      const secureDataOnFailure = readSecureVault()
      markCompatibleFailure(
        secureDataOnFailure,
        resolved.statusGroup,
        resolved.slot,
        /429/.test(result.code) ? 'rate-limited' : 'failed',
        result.message
      )
      writeSecureVault(secureDataOnFailure)
    }

    return result
  }

  const callGeminiChatProvider = async (
    prompt: string,
    currentFiles?: ProjectFile[],
    signal?: AbortSignal
  ): Promise<ProviderChatResult> => {
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
        message: 'Selected provider API key missing hai.',
        providerLabel: 'Gemini'
      }
    }

    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
          encodeURIComponent(geminiKey),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildChatSystemPrompt('Gemini 2.5 Flash', prompt, currentFiles) }] },
            contents: [{ role: 'user', parts: [{ text: buildChatUserPrompt(prompt, currentFiles) }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 1536 }
          })
        }
      )

      if (!response.ok) {
        const errorBody = await response.text()
        const message =
          response.status === 401 || response.status === 403
            ? 'Gemini auth failed. Gemini key/settings check karo.'
            : response.status === 429
              ? 'Gemini rate limit/quota hit hua.'
              : `Gemini provider error ${response.status}: ${errorBody.slice(0, 180)}`
        return { success: false, code: `GEMINI_${response.status}`, message, providerLabel: 'Gemini' }
      }

      const data = await response.json()
      const content = normalizeGeminiText(data)
      return { success: true, content: content || 'Main yahan hoon. Batao kya build ya explain karna hai.', providerLabel: 'Gemini' }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return {
          success: false,
          code: 'REQUEST_CANCELLED',
          message: 'Builder request cancelled.',
          providerLabel: 'Gemini',
          cancelled: true
        }
      }
      return {
        success: false,
        code: 'GEMINI_NETWORK_ERROR',
        message: error?.message || 'Gemini request failed.',
        providerLabel: 'Gemini'
      }
    }
  }

  const callOpenAICompatibleChatProvider = async (
    prompt: string,
    currentFiles: ProjectFile[] | undefined,
    config: {
      endpoint: string
      key: string
      model: string
      providerLabel: string
      headers?: Record<string, string>
    },
    signal?: AbortSignal
  ): Promise<ProviderChatResult> => {
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.key}`,
          ...(config.headers || {})
        },
        signal,
        body: JSON.stringify({
          model: config.model,
          temperature: 0.4,
          messages: [
            { role: 'system', content: buildChatSystemPrompt(config.providerLabel, prompt, currentFiles) },
            { role: 'user', content: buildChatUserPrompt(prompt, currentFiles) }
          ]
        })
      })

      if (!response.ok) {
        const body = await response.text()
        let message = `${config.providerLabel} provider error ${response.status}: ${body.slice(0, 180)}`
        if (response.status === 401 || response.status === 403) message = `${config.providerLabel} auth failed. API key/settings check karo.`
        else if (response.status === 404) message = `${config.providerLabel} model invalid lag raha hai. Model/settings check karo.`
        else if (response.status === 429) message = `${config.providerLabel} rate limit/quota hit hua.`
        return { success: false, code: `${config.providerLabel.toUpperCase()}_${response.status}`, message, providerLabel: config.providerLabel }
      }

      const data = await response.json()
      return {
        success: true,
        content: extractCompatibleResponseText(data) || 'Main yahan hoon. Batao kya build ya explain karna hai.',
        providerLabel: config.providerLabel
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return {
          success: false,
          code: 'REQUEST_CANCELLED',
          message: 'Builder request cancelled.',
          providerLabel: config.providerLabel,
          cancelled: true
        }
      }
      return {
        success: false,
        code: `${config.providerLabel.toUpperCase()}_NETWORK_ERROR`,
        message: error?.message || `${config.providerLabel} request failed.`,
        providerLabel: config.providerLabel
      }
    }
  }

  const callProviderChat = async (
    providerInput: ProviderSelection | ProviderName | string | undefined,
    prompt: string,
    currentFiles?: ProjectFile[],
    signal?: AbortSignal
  ): Promise<ProviderChatResult> => {
    const selection = parseProviderSelection(providerInput)

    if (selection.provider === 'gemini') {
      return callGeminiChatProvider(prompt, currentFiles, signal)
    }

    if (selection.provider === 'glm') {
      const directKey = selection.apiKey?.trim() || ''
      const secureData = readSecureVault()
      const normalizedSlots = normalizeGlmSlots(secureData)
      const selectedSlot =
        selection.slot != null
          ? normalizedSlots.find((slot) => slot.slot === selection.slot && slot.enabled && decryptVaultValue(slot.key)) || null
          : getActiveGlmSlot(secureData)
      if (!selectedSlot && !directKey) {
        return {
          success: false,
          code: 'MISSING_GLM_KEY',
          message: 'Selected provider API key missing hai.',
          providerLabel: selection.label || 'GLM 5.2'
        }
      }
      const key = directKey || decryptVaultValue(selectedSlot?.key).trim()
      const providerMode = selection.providerMode || selectedSlot?.providerMode || 'openai-compatible'
      const baseUrl = selection.baseUrl || selectedSlot?.baseUrl || ZENMUX_DEFAULT_BASE_URL
      const modelId = selection.modelId || selectedSlot?.modelId || ZENMUX_DEFAULT_MODEL_ID
      const providerLabel = selection.label || 'ZenMux Compatible GLM'
      const endpoint =
        providerMode === 'direct-zai'
          ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
          : normalizeCompatibleBaseUrl(baseUrl)
      return callOpenAICompatibleChatProvider(
        prompt,
        currentFiles,
        {
          endpoint,
          key,
          model: modelId,
          providerLabel,
          headers:
            providerMode === 'direct-zai'
              ? {
                  'HTTP-Referer': 'https://alpha.local',
                  'X-Title': 'alpha'
                }
              : undefined
        },
        signal
      )
    }

    if (selection.provider === 'zai') {
      const directKey = selection.apiKey?.trim() || ''
      const secureData = readSecureVault()
      const normalizedSlots = normalizeZaiSlots(secureData)
      const selectedSlot =
        selection.slot != null
          ? normalizedSlots.find((slot) => slot.slot === selection.slot && slot.enabled && decryptVaultValue(slot.key)) || null
          : getActiveZaiSlot(secureData)
      if (!selectedSlot && !directKey) {
        return {
          success: false,
          code: 'MISSING_ZAI_KEY',
          message: 'Selected provider API key missing hai.',
          providerLabel: selection.label || 'Z.AI'
        }
      }
      const key = directKey || decryptVaultValue(selectedSlot?.key).trim()
      const providerMode = selection.providerMode || selectedSlot?.providerMode || 'zai-coding'
      const baseUrl = selection.baseUrl || selectedSlot?.baseUrl || ZAI_DEFAULT_BASE_URL
      const modelId = selection.modelId || selectedSlot?.modelId || ZAI_DEFAULT_MODEL_ID
      const endpoint =
        providerMode === 'zai-compatible'
          ? normalizeCompatibleBaseUrl(baseUrl)
          : `${baseUrl.replace(/\/+$/, '')}/chat/completions`
      return callOpenAICompatibleChatProvider(
        prompt,
        currentFiles,
        {
          endpoint,
          key,
          model: modelId,
          providerLabel: selection.label || 'Z.AI'
        },
        signal
      )
    }

    const resolved = resolveSelectedCompatibleConfig(selection)
    if ('error' in resolved) {
      const errorResult = resolved.error as Extract<ProviderResult, { success: false }>
      return {
        success: false,
        code: errorResult.code,
        message: errorResult.message,
        providerLabel: errorResult.providerLabel,
        cancelled: errorResult.cancelled
      }
    }
    return callOpenAICompatibleChatProvider(
      prompt,
      currentFiles,
      {
        endpoint: resolved.endpoint,
        key: resolved.key,
        model: resolved.model,
        providerLabel: resolved.providerLabel,
        headers: resolved.headers
      },
      signal
    )
  }

  const buildStructuredRetryPrompt = (prompt: string) =>
    `Original request: ${prompt}\n\nYour previous response was not in usable file format. Return strict JSON only using this schema: {"projectName":"string","projectType":"string","summary":"string","files":[{"path":"relative/path","content":"file contents"}]}. Do not include markdown or explanation.`

  const runAbortableBuilderRequest = async <T>(
    requestId: string | undefined,
    runner: (signal?: AbortSignal) => Promise<T>
  ) => {
    if (!requestId) {
      return runner(undefined)
    }

    const controller = new AbortController()
    activeBuilderRequests.set(requestId, controller)
    try {
      return await runner(controller.signal)
    } finally {
      activeBuilderRequests.delete(requestId)
    }
  }

  const resolveGeneratedProjectFiles = async (
    providerSelection: ProviderSelection,
    prompt: string,
    projectType: string,
    generated: Extract<ProviderResult, { success: true }>,
    currentFiles?: ProjectFile[],
    signal?: AbortSignal
  ): Promise<{
    files: ProjectFile[]
    usedFallback: boolean
    providerNotice?: string
  }> => {
    const initial = extractProviderFiles(generated.payload || {}, prompt, projectType)
    if (initial.source !== 'fallback') {
      return { files: initial.files, usedFallback: false }
    }

    const retry = await callProvider(
      providerSelection,
      buildStructuredRetryPrompt(prompt),
      currentFiles,
      signal
    )

    if (retry.success) {
      const retried = extractProviderFiles(retry.payload || {}, prompt, projectType)
      if (retried.source !== 'fallback') {
        return {
          files: retried.files,
          usedFallback: false,
          providerNotice: 'Provider ko strict file retry bheja gaya aur usable files mil gayi.'
        }
      }
    } else if (retry.cancelled) {
      throw Object.assign(new Error('Builder request cancelled.'), { name: 'AbortError' })
    }

    return {
      files: createPromptAwareFallbackFiles(prompt, projectType),
      usedFallback: true,
      providerNotice: 'Provider response usable file format me nahi tha, local prompt-aware scaffold use kiya.'
    }
  }

  const writeProjectState = (
    projectId: string,
    projectName: string,
    prompt: string,
    files: ProjectFile[],
    providerUsed: string,
    modelUsed: string = PROJECT_MODEL
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
      modelUsed,
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

  ipcMain.handle('project-builder-create', async (_, { prompt, provider = 'kiloGateway', requestId }) => {
    const intent = classifyBuilderPrompt(prompt || '')
    if (intent === 'NORMAL_CHAT' || intent === 'EXPLAIN_CODE' || intent === 'RUN_COMMAND') {
      return {
        success: false,
        error:
          intent === 'RUN_COMMAND'
            ? 'This prompt looks like a terminal command. Use Builder terminal controls instead.'
            : 'This prompt is chat/explanation only. Use Builder chat route instead.',
        code: intent === 'RUN_COMMAND' ? 'BUILDER_COMMAND_ONLY' : 'BUILDER_CHAT_ONLY'
      }
    }

    const projectType = detectProjectType(prompt || '')
    const providerSelection = parseProviderSelection(provider)
    const selectedModelId = providerSelection.modelId || getProviderDefaults(providerSelection.provider).modelId
    debugBuilder('create-request', {
      intent,
      provider: providerSelection.provider,
      modelId: selectedModelId,
      promptLength: (prompt || '').length,
      requestId
    })

    try {
      const generated = await runAbortableBuilderRequest(requestId, (signal) =>
        callProvider(providerSelection, prompt || '', undefined, signal)
      )

      if (!generated.success) {
        debugBuilder('create-result', {
          provider: providerSelection.provider,
          success: false,
          code: generated.code,
          cancelled: generated.cancelled || false
        })
        return {
          success: false,
          cancelled: generated.cancelled,
          error: generated.message,
          code: generated.code,
          providerError: generated.message,
          providerCode: generated.code
        }
      }

      const payload = generated.payload || {}
      const projectName = slugify(payload.projectName || guessProjectName(prompt || '', projectType))
      const resolved = await runAbortableBuilderRequest(requestId, (signal) =>
        resolveGeneratedProjectFiles(providerSelection, prompt || '', projectType, generated, undefined, signal)
      )
      debugBuilder('create-result', {
        provider: providerSelection.provider,
        success: true,
        responseParsedAsFiles: !resolved.usedFallback,
        fallbackUsed: resolved.usedFallback,
        files: resolved.files.length
      })
      const state = writeProjectState(
        projectName,
        projectName,
        prompt || '',
        resolved.files,
        generated.providerLabel,
        providerSelection.modelId || payload.modelId || payload.projectModel || selectedModelId || PROJECT_MODEL
      )

      return {
        success: true,
        state,
        previewHtml: inlinePreviewHtml(state.files),
        ...(resolved.providerNotice ? { providerError: resolved.providerNotice, usedFallback: resolved.usedFallback } : {})
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { success: false, cancelled: true, error: 'Builder request cancelled.', code: 'REQUEST_CANCELLED' }
      }
      throw error
    }
  })

  ipcMain.handle('project-builder-update', async (_, { projectId, prompt, provider, requestId }) => {
    const existing = readProjectState(projectId)
    const intent = classifyBuilderPrompt(prompt || '', existing.files)
    if (intent === 'NORMAL_CHAT' || intent === 'EXPLAIN_CODE' || intent === 'RUN_COMMAND') {
      return {
        success: false,
        error:
          intent === 'RUN_COMMAND'
            ? 'This prompt looks like a terminal command. Use Builder terminal controls instead.'
            : 'This prompt is chat/explanation only. Use Builder chat route instead.',
        code: intent === 'RUN_COMMAND' ? 'BUILDER_COMMAND_ONLY' : 'BUILDER_CHAT_ONLY'
      }
    }
    const kiloService = getKiloService()
    const providerSelection = parseProviderSelection(provider, existing.metadata.providerUsed)
    debugBuilder('update-request', {
      intent,
      provider: providerSelection.provider,
      modelId: providerSelection.modelId || existing.metadata.modelUsed,
      promptLength: (prompt || '').length,
      requestId,
      projectId
    })
    const kiloRequested =
      (typeof provider === 'string' && provider === 'kilo') || shouldUseKiloForPrompt(prompt || '')

    if (kiloRequested && kiloService?.getSettings().enabled) {
      const kiloResult = await kiloService.executeCodingTask({
        prompt: prompt || '',
        projectRoot: existing.metadata.projectPath,
        projectId,
        currentFiles: existing.files,
        selectedFiles: existing.files.map((file) => file.path),
        source: 'builder'
      })

      debugBuilder('kilo-route', {
        enabled: true,
        success: kiloResult.success,
        taskId: kiloResult.taskId,
        filesChanged: kiloResult.filesChanged.length,
        needsApproval: kiloResult.needsApproval || false
      })

      if (kiloResult.success && kiloResult.resultingFiles?.length) {
        const safeFiles = kiloResult.resultingFiles.filter((file) => file.path !== 'project.json')
        const state = writeProjectState(
          projectId,
          existing.metadata.name,
          prompt || '',
          safeFiles.length ? safeFiles : existing.files,
          'Kilo Code',
          existing.metadata.modelUsed || PROJECT_MODEL
        )
        return {
          success: true,
          state,
          previewHtml: inlinePreviewHtml(state.files),
          message: kiloResult.summary || `Kilo ne ${kiloResult.filesChanged.length} file update ki.`
        }
      }

      return {
        success: true,
        state: existing,
        previewHtml: inlinePreviewHtml(existing.files),
        providerError: kiloResult.error || 'Kilo task complete nahi hua.'
      }
    }

    const kiloDisabledMessage = kiloRequested
      ? 'Kilo Code disabled hai. Existing coding provider se continue kar raha hoon.'
      : ''

    const generated = await runAbortableBuilderRequest(requestId, (signal) =>
      callProvider(providerSelection, prompt || '', existing.files, signal)
    )
    if (!generated.success) {
      debugBuilder('update-result', {
        provider: providerSelection.provider,
        success: false,
        code: generated.code,
        cancelled: generated.cancelled || false
      })
      return {
        success: false,
        cancelled: generated.cancelled,
        error: kiloDisabledMessage ? `${kiloDisabledMessage}\n\n${generated.message}` : generated.message,
        code: generated.code,
        providerError: kiloDisabledMessage ? `${kiloDisabledMessage}\n\n${generated.message}` : generated.message,
        providerCode: generated.code
      }
    }

    const payload = generated.payload || {}
    const resolved = await runAbortableBuilderRequest(requestId, (signal) =>
      resolveGeneratedProjectFiles(
        providerSelection,
        prompt || '',
        existing.metadata.type,
        generated,
        existing.files,
        signal
      )
    )
    debugBuilder('update-result', {
      provider: providerSelection.provider,
      success: true,
      responseParsedAsFiles: !resolved.usedFallback,
      fallbackUsed: resolved.usedFallback,
      files: resolved.files.length
    })
    const state = writeProjectState(
      projectId,
      existing.metadata.name,
      prompt || '',
      resolved.files,
      generated.providerLabel,
      providerSelection.modelId || payload.modelId || payload.projectModel || existing.metadata.modelUsed || PROJECT_MODEL
    )

    return {
      success: true,
      state,
      previewHtml: inlinePreviewHtml(state.files),
      ...(kiloDisabledMessage ? { message: kiloDisabledMessage } : {}),
      ...(resolved.providerNotice ? { providerError: resolved.providerNotice, usedFallback: resolved.usedFallback } : {})
    }
  })

  ipcMain.handle('project-builder-chat', async (_, { prompt, provider = 'kiloGateway', projectId, requestId }) => {
    const currentFiles = projectId ? readProjectState(projectId).files : undefined
    const providerSelection = parseProviderSelection(provider)
    debugBuilder('chat-request', {
      provider: providerSelection.provider,
      modelId: providerSelection.modelId || getProviderDefaults(providerSelection.provider).modelId,
      promptLength: (prompt || '').length,
      requestId,
      projectId
    })
    try {
      const result = await runAbortableBuilderRequest(requestId, (signal) =>
        callProviderChat(providerSelection, prompt || '', currentFiles, signal)
      )
      if (!result.success) {
        return {
          success: false,
          cancelled: result.cancelled,
          error: result.message,
          code: result.code,
          providerLabel: result.providerLabel
        }
      }

      return {
        success: true,
        message: result.content,
        providerLabel: result.providerLabel
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { success: false, cancelled: true, error: 'Builder request cancelled.', code: 'REQUEST_CANCELLED' }
      }
      throw error
    }
  })

  ipcMain.handle('project-builder-cancel', async (_, { requestId }) => {
    if (requestId && activeBuilderRequests.has(requestId)) {
      activeBuilderRequests.get(requestId)?.abort()
      activeBuilderRequests.delete(requestId)
    }
    return { success: true }
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
        existing.metadata.providerUsed,
        existing.metadata.modelUsed || PROJECT_MODEL
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
