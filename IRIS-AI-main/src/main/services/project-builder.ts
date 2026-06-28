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
  lastError?: string
  summary?: string
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
type PermissionMode = 'ask' | 'approve' | 'full'

type MemoryEntry = {
  id: string
  type: string
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
  source: string
  priority: number
  filePath: string
}

type BuilderGenerationContext = {
  permissionMode?: PermissionMode
  previousError?: string
  projectLabel?: string
}

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
  { type: 'android', pattern: /\b(android|apk|jetpack compose|compose app|mobile app)\b/i },
  { type: 'desktop', pattern: /\b(windows app|desktop app|desktop application|tauri app)\b/i },
  { type: 'electron', pattern: /\b(electron|desktop web app)\b/i },
  { type: 'react', pattern: /\b(react|webapp|dashboard|admin panel|saas app|spa)\b/i },
  { type: 'website', pattern: /\b(website|landing page|portfolio|frontend|html|css|javascript site)\b/i },
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

const stackForProjectType = (projectType: string, prompt: string) => {
  const lower = prompt.toLowerCase()
  if (projectType === 'android') return 'Kotlin + Jetpack Compose'
  if (projectType === 'desktop') return lower.includes('tauri') ? 'Tauri' : 'Electron + React + TypeScript'
  if (projectType === 'electron') return 'Electron + React + TypeScript'
  if (projectType === 'react') return 'React + TypeScript'
  if (projectType === 'python') return lower.includes('gui') ? 'Python desktop utility' : 'Python CLI tool'
  if (projectType === 'cpp') return 'C++ with CMake'
  if (projectType === 'c') return 'C with Make/CMake instructions'
  if (projectType === 'java') return 'Java application'
  if (projectType === 'website') return lower.includes('advanced') || lower.includes('premium') ? 'Advanced HTML/CSS/JS' : 'HTML/CSS/JS'
  return 'Project starter'
}

const wantsAdvancedUi = (prompt: string) =>
  /\b(advanced|premium|badhiya|3d|animated|animation|glass|glassmorphism|chrome jaisa|youtube jaisa|neon|modern)\b/i.test(
    prompt
  )

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

const createReactFiles = (prompt: string): ProjectFile[] => {
  const advanced = wantsAdvancedUi(prompt)
  const title = prompt.includes('dashboard') ? 'ALPHA Dashboard' : 'ALPHA Web App'
  return [
    {
      path: 'package.json',
      content: `{
  "name": "${slugify(prompt)}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^7.0.0"
  }
}`
    },
    {
      path: 'index.html',
      content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${title}</title><script type="module" src="/src/main.tsx"></script></head><body><div id="root"></div></body></html>`
    },
    {
      path: 'src/main.tsx',
      content: `import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\nReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);`
    },
    {
      path: 'src/App.tsx',
      content: `export default function App() {\n  return (\n    <main className="app-shell">\n      <section className="hero-panel">\n        <p className="eyebrow">ALPHA WEBAPP</p>\n        <h1>${escapeForTemplate(prompt)}</h1>\n        <p className="lede">Responsive React workspace scaffold with polished cards, actions, and structure ready for deeper feature work.</p>\n      </section>\n      <section className="grid">\n        <article className="card"><h2>Overview</h2><p>Use this scaffold to add modules, charts, billing, or task flows.</p></article>\n        <article className="card"><h2>Activity</h2><p>Current design follows a premium dark interface pattern.</p></article>\n        <article className="card"><h2>Launch</h2><button>Primary action</button></article>\n      </section>\n    </main>\n  )\n}`
    },
    {
      path: 'src/styles.css',
      content: `:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#050505;color:#fff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#22d3ee1e,transparent 28%),radial-gradient(circle at 80% 10%,#8b5cf620,transparent 24%),#050505}.app-shell{min-height:100vh;padding:32px;display:grid;gap:24px}.hero-panel,.card{border:1px solid rgba(255,255,255,.08);background:${advanced ? 'linear-gradient(145deg,rgba(15,17,23,.92),rgba(11,13,18,.86))' : 'rgba(11,13,18,.92)'};border-radius:28px;backdrop-filter:blur(18px);box-shadow:0 24px 80px rgba(0,0,0,.45)}.hero-panel{padding:36px}.eyebrow{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#22d3ee}.hero-panel h1{font-size:clamp(34px,6vw,64px);margin:16px 0}.lede{max-width:760px;color:#a1a1aa;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{padding:24px}.card h2{margin:0 0 12px}.card p{color:#a1a1aa;line-height:1.6}.card button{border:none;border-radius:999px;padding:12px 18px;background:linear-gradient(135deg,#22d3ee,#8b5cf6);color:#fff;font-weight:700;cursor:pointer}@media(max-width:920px){.grid{grid-template-columns:1fr}}`
    },
    {
      path: 'README.md',
      content: `# ${title}\n\nPrompt: ${prompt}\n\nStack: React + TypeScript\n\n## Commands\n- npm install\n- npm run dev\n- npm run build\n`
    }
  ]
}

const createAndroidFiles = (prompt: string): ProjectFile[] => {
  const packageName = 'com.alpha.builderapp'
  return [
    { path: 'settings.gradle', content: `rootProject.name = "alpha-builder-app"\ninclude(":app")` },
    { path: 'build.gradle', content: `plugins {}\nallprojects {\n  repositories {\n    google()\n    mavenCentral()\n  }\n}` },
    {
      path: 'app/build.gradle',
      content: `plugins {\n  id 'com.android.application'\n  id 'org.jetbrains.kotlin.android'\n}\n\nandroid {\n  namespace '${packageName}'\n  compileSdk 35\n  defaultConfig {\n    applicationId "${packageName}"\n    minSdk 26\n    targetSdk 35\n    versionCode 1\n    versionName "1.0"\n  }\n  buildFeatures { compose true }\n  composeOptions { kotlinCompilerExtensionVersion '1.5.14' }\n}\n\ndependencies {\n  implementation "androidx.core:core-ktx:1.13.1"\n  implementation "androidx.activity:activity-compose:1.9.0"\n  implementation "androidx.compose.material3:material3:1.2.1"\n}`
    },
    {
      path: 'app/src/main/AndroidManifest.xml',
      content: `<?xml version="1.0" encoding="utf-8"?><manifest package="${packageName}" xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="ALPHA Builder App" android:theme="@style/Theme.Material3.DayNight.NoActionBar"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`
    },
    {
      path: 'app/src/main/java/com/alpha/builderapp/MainActivity.kt',
      content: `package ${packageName}\n\nimport android.os.Bundle\nimport androidx.activity.ComponentActivity\nimport androidx.activity.compose.setContent\nimport androidx.compose.foundation.layout.*\nimport androidx.compose.material3.*\nimport androidx.compose.runtime.Composable\nimport androidx.compose.ui.Alignment\nimport androidx.compose.ui.Modifier\nimport androidx.compose.ui.unit.dp\n\nclass MainActivity : ComponentActivity() {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n    setContent { AlphaApp() }\n  }\n}\n\n@Composable\nfun AlphaApp() {\n  MaterialTheme {\n    Surface(modifier = Modifier.fillMaxSize()) {\n      Column(modifier = Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {\n        Text(\"ALPHA Android App\", style = MaterialTheme.typography.headlineMedium)\n        Spacer(modifier = Modifier.height(16.dp))\n        Text(${JSON.stringify(prompt)}, style = MaterialTheme.typography.bodyLarge)\n      }\n    }\n  }\n}`
    },
    {
      path: 'README.md',
      content: `# ALPHA Android App\n\nPrompt: ${prompt}\n\nStack: Kotlin + Jetpack Compose\n\n## Next steps\n- Open in Android Studio\n- Sync Gradle\n- Run on emulator/device\n`
    }
  ]
}

const createElectronFiles = (prompt: string): ProjectFile[] => [
  {
    path: 'package.json',
    content: `{
  "name": "${slugify(prompt)}",
  "private": true,
  "version": "0.1.0",
  "main": "src/main.ts",
  "scripts": {
    "dev": "electron .",
    "build": "echo add bundler here"
  }
}`
  },
  {
    path: 'src/main.ts',
    content: `import { app, BrowserWindow } from "electron";\nimport path from "node:path";\n\nfunction createWindow() {\n  const win = new BrowserWindow({ width: 1280, height: 820, backgroundColor: "#050505" });\n  win.loadFile(path.join(__dirname, "renderer", "index.html"));\n}\n\napp.whenReady().then(createWindow);`
  },
  {
    path: 'src/renderer/App.tsx',
    content: `export default function App() {\n  return <main className="shell"><h1>ALPHA Desktop App</h1><p>${escapeForTemplate(prompt)}</p></main>\n}`
  },
  {
    path: 'src/renderer/styles.css',
    content: `body{margin:0;background:#050505;color:#fff;font-family:Inter,system-ui,sans-serif}.shell{min-height:100vh;padding:32px}`
  },
  { path: 'src/renderer/index.html', content: `<!doctype html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>ALPHA Desktop App</title></head><body><div id="root"></div></body></html>` },
  { path: 'README.md', content: `# ALPHA Desktop App\n\nPrompt: ${prompt}\n\nStack: Electron scaffold\n` }
]

const createPythonFiles = (prompt: string): ProjectFile[] => [
  {
    path: 'main.py',
    content: `def main():\n    print("ALPHA Python Tool")\n    print(${JSON.stringify(prompt)})\n\n\nif __name__ == "__main__":\n    main()\n`
  },
  { path: 'requirements.txt', content: '' },
  { path: 'README.md', content: `# ALPHA Python Tool\n\nPrompt: ${prompt}\n\n## Run\n- python main.py\n` }
]

const createCppFiles = (prompt: string, language: 'c' | 'cpp'): ProjectFile[] => [
  {
    path: language === 'cpp' ? 'main.cpp' : 'main.c',
    content:
      language === 'cpp'
        ? `#include <iostream>\n\nint main() {\n  std::cout << "ALPHA C++ Project\\n";\n  std::cout << ${JSON.stringify(prompt)} << "\\n";\n  return 0;\n}\n`
        : `#include <stdio.h>\n\nint main(void) {\n  printf("ALPHA C Project\\n");\n  printf("%s\\n", ${JSON.stringify(prompt)});\n  return 0;\n}\n`
  },
  {
    path: 'CMakeLists.txt',
    content: `cmake_minimum_required(VERSION 3.16)\nproject(alpha_builder_project)\nadd_executable(alpha_builder ${language === 'cpp' ? 'main.cpp' : 'main.c'})\n`
  },
  {
    path: 'README.md',
    content: `# ALPHA ${language === 'cpp' ? 'C++' : 'C'} Project\n\nPrompt: ${prompt}\n\n## Build\n- mkdir build\n- cd build\n- cmake ..\n- cmake --build .\n`
  }
]

const escapeForTemplate = (value: string) => value.replace(/`/g, '\\`').replace(/\$/g, '\\$')

const createFallbackWebsiteFiles = (prompt: string): ProjectFile[] => {
  const lower = prompt.toLowerCase()
  const escapedPrompt = prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')

  if (/\bchrome\b/.test(lower)) {
    return [
      {
        path: 'index.html',
        content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>ALPHA Browser Inspired UI</title><link rel="stylesheet" href="style.css"/></head><body><main class="browser-shell"><header class="browser-top"><div class="tab-row"><button class="tab active">ALPHA Home</button><button class="tab">New Tab</button></div><div class="toolbar"><button class="nav-btn">&#10094;</button><button class="nav-btn">&#10095;</button><button class="nav-btn">&#8635;</button><div class="address-bar">alpha://workspace/${slugify(prompt)}</div><button class="action-btn">Profile</button></div></header><section class="browser-content"><aside class="sidebar"><h2>Workspace</h2><ul><li>Dashboard</li><li>Collections</li><li>History</li><li>Experiments</li></ul></aside><section class="viewport"><article class="hero-card"><p class="eyebrow">ALPHA BROWSER UI</p><h1>Original browser-inspired interface</h1><p>${escapedPrompt}</p></article><div class="quick-grid"><article><h3>Cards</h3><p>Bookmark previews and contextual launch cards.</p></article><article><h3>Tabs</h3><p>Multi-tab shell with original ALPHA styling.</p></article><article><h3>Search</h3><p>Address bar, toolbar, and activity layout ready.</p></article></div></section></section></main><script src="script.js"></script></body></html>`
      },
      {
        path: 'style.css',
        content: `*{box-sizing:border-box}body{margin:0;background:#050505;color:#fff;font-family:Inter,system-ui,sans-serif}.browser-shell{min-height:100vh;padding:24px;background:radial-gradient(circle at top,#22d3ee1f,transparent 28%),radial-gradient(circle at 85% 8%,#8b5cf61f,transparent 24%),#050505}.browser-top,.sidebar,.hero-card,.quick-grid article{border:1px solid rgba(255,255,255,.08);background:linear-gradient(145deg,rgba(15,17,23,.92),rgba(11,13,18,.88));backdrop-filter:blur(18px);box-shadow:0 24px 70px rgba(0,0,0,.45)}.browser-top{padding:18px;border-radius:24px}.tab-row{display:flex;gap:12px;margin-bottom:14px}.tab{border:none;border-radius:14px;padding:10px 16px;background:rgba(255,255,255,.06);color:#d4d4d8}.tab.active{background:linear-gradient(135deg,#22d3ee,#8b5cf6);color:#fff}.toolbar{display:flex;align-items:center;gap:12px}.nav-btn,.action-btn{border:none;border-radius:14px;padding:10px 12px;background:rgba(255,255,255,.05);color:#fff}.address-bar{flex:1;border-radius:16px;padding:12px 16px;background:#090b10;color:#a1a1aa}.browser-content{margin-top:20px;display:grid;grid-template-columns:260px 1fr;gap:20px}.sidebar{border-radius:28px;padding:24px}.sidebar h2{margin:0 0 12px}.sidebar ul{list-style:none;padding:0;margin:0;display:grid;gap:10px;color:#a1a1aa}.viewport{display:grid;gap:18px}.hero-card{padding:32px;border-radius:30px}.eyebrow{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#22d3ee}.hero-card h1{font-size:clamp(36px,5vw,64px);margin:16px 0}.hero-card p{max-width:700px;color:#a1a1aa;line-height:1.7}.quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.quick-grid article{padding:22px;border-radius:24px}.quick-grid h3{margin:0 0 10px}@media(max-width:980px){.browser-content{grid-template-columns:1fr}.quick-grid{grid-template-columns:1fr}}`
      },
      { path: 'script.js', content: `console.log("ALPHA browser-inspired website ready");` },
      { path: 'README.md', content: `# ALPHA Browser Inspired Website\n\nPrompt: ${prompt}\n\nThis is an original browser-like UI, not an official Chrome asset copy.\n` }
    ]
  }

  if (/\byoutube\b/.test(lower)) {
    return [
      {
        path: 'index.html',
        content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>ALPHA Video Platform</title><link rel="stylesheet" href="style.css"/></head><body><main class="video-shell"><aside class="sidebar"><h1>ALPHA Stream</h1><nav><a>Home</a><a>Explore</a><a>Subscriptions</a><a>Library</a></nav></aside><section class="main-area"><header class="topbar"><div class="search-bar">Search videos, creators, topics...</div><button>Upload</button></header><section class="player-card"><div class="player-surface">Featured Player Mock</div><div><p class="eyebrow">ALPHA VIDEO PLATFORM</p><h2>Video-first interface inspired by streaming layouts</h2><p>${escapedPrompt}</p></div></section><section class="video-grid"><article><div class="thumb"></div><h3>Neon Interface Walkthrough</h3><p>Original ALPHA content card</p></article><article><div class="thumb"></div><h3>Creator Studio Mock</h3><p>Search, sidebar, and recommendations</p></article><article><div class="thumb"></div><h3>Discovery Feed</h3><p>Responsive card grid with hover states</p></article><article><div class="thumb"></div><h3>Premium Playlist</h3><p>Dark media surface with motion-friendly styling</p></article></section></section></main><script src="script.js"></script></body></html>`
      },
      {
        path: 'style.css',
        content: `*{box-sizing:border-box}body{margin:0;background:#050505;color:#fff;font-family:Inter,system-ui,sans-serif}.video-shell{min-height:100vh;display:grid;grid-template-columns:240px 1fr;background:radial-gradient(circle at top,#f472b61a,transparent 22%),radial-gradient(circle at 80% 5%,#22d3ee18,transparent 26%),#050505}.sidebar,.topbar,.player-card,.video-grid article{border:1px solid rgba(255,255,255,.08);background:linear-gradient(145deg,rgba(15,17,23,.94),rgba(11,13,18,.9));backdrop-filter:blur(18px)}.sidebar{padding:24px;border-right:none}.sidebar h1{margin:0 0 22px;font-size:24px}.sidebar nav{display:grid;gap:12px;color:#d4d4d8}.main-area{padding:24px;display:grid;gap:18px}.topbar{display:flex;align-items:center;gap:14px;padding:16px;border-radius:24px}.search-bar{flex:1;border-radius:16px;padding:12px 18px;background:#090b10;color:#71717a}.topbar button{border:none;border-radius:14px;padding:12px 18px;background:linear-gradient(135deg,#22d3ee,#8b5cf6);color:#fff;font-weight:700}.player-card{display:grid;grid-template-columns:1.1fr .9fr;gap:20px;padding:22px;border-radius:28px}.player-surface{min-height:320px;border-radius:22px;background:linear-gradient(135deg,#111827,#0f172a);display:grid;place-items:center;color:#f472b6;font-weight:700}.eyebrow{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#22d3ee}.player-card h2{font-size:clamp(28px,4vw,46px);margin:14px 0}.player-card p{color:#a1a1aa;line-height:1.7}.video-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.video-grid article{padding:16px;border-radius:22px}.thumb{aspect-ratio:16/9;border-radius:18px;background:linear-gradient(135deg,#111827,#27272a);margin-bottom:12px}.video-grid h3{margin:0 0 8px;font-size:15px}.video-grid p{margin:0;color:#a1a1aa;font-size:13px}@media(max-width:1120px){.video-shell{grid-template-columns:1fr}.player-card{grid-template-columns:1fr}.video-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.video-grid{grid-template-columns:1fr}}`
      },
      { path: 'script.js', content: `console.log("ALPHA video platform mock ready");` },
      { path: 'README.md', content: `# ALPHA Video Platform UI\n\nPrompt: ${prompt}\n\nThis is an original video-platform-inspired build without official YouTube branding.\n` }
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

const createProjectScaffold = (prompt: string, projectType: string): ProjectFile[] => {
  if (projectType === 'react') return createReactFiles(prompt)
  if (projectType === 'android') return createAndroidFiles(prompt)
  if (projectType === 'desktop' || projectType === 'electron') return createElectronFiles(prompt)
  if (projectType === 'python') return createPythonFiles(prompt)
  if (projectType === 'cpp') return createCppFiles(prompt, 'cpp')
  if (projectType === 'c') return createCppFiles(prompt, 'c')
  if (projectType === 'website') return createFallbackWebsiteFiles(prompt)
  return [
    {
      path: 'README.md',
      content: `# ALPHA project\n\nPrompt: ${prompt}\n\nProject type: ${projectType}\n\nStack: ${stackForProjectType(projectType, prompt)}\n`
    }
  ]
}

const ensureFilesForProjectType = (files: ProjectFile[], prompt: string, projectType: string): ProjectFile[] => {
  const normalized = files
    .filter((file) => file.path && !/^generated-\d+\.txt$/i.test(file.path))
    .map((file) => ({ path: file.path.replace(/\\/g, '/').replace(/^\/+/, ''), content: file.content }))

  const fileSet = new Set(normalized.map((file) => file.path.toLowerCase()))
  const scaffold = createProjectScaffold(prompt, projectType)
  const needsWebsiteDefaults =
    projectType === 'website' &&
    (!fileSet.has('index.html') || !fileSet.has('style.css') || !fileSet.has('script.js'))
  const needsReactDefaults =
    projectType === 'react' &&
    (!fileSet.has('package.json') || !fileSet.has('src/app.tsx') || !fileSet.has('src/main.tsx'))
  const needsAndroidDefaults = projectType === 'android' && !fileSet.has('app/src/main/androidmanifest.xml')
  const needsDesktopDefaults =
    (projectType === 'desktop' || projectType === 'electron') && !fileSet.has('src/main.ts')
  const needsPythonDefaults = projectType === 'python' && !fileSet.has('main.py')
  const needsCppDefaults = projectType === 'cpp' && !fileSet.has('main.cpp')
  const needsCDefaults = projectType === 'c' && !fileSet.has('main.c')

  if (
    !normalized.length ||
    needsWebsiteDefaults ||
    needsReactDefaults ||
    needsAndroidDefaults ||
    needsDesktopDefaults ||
    needsPythonDefaults ||
    needsCppDefaults ||
    needsCDefaults
  ) {
    const merged = new Map<string, ProjectFile>()
    for (const file of scaffold) merged.set(file.path, file)
    for (const file of normalized) merged.set(file.path, file)
    return Array.from(merged.values())
  }

  return normalized
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

  if (files.length) return ensureFilesForProjectType(files, prompt, projectType)

  if (typeof payload?.rawText === 'string') {
    const codeBlockFiles = extractCodeBlockFiles(payload.rawText)
    if (codeBlockFiles.length) {
      const ensured = ensureFilesForProjectType(codeBlockFiles, prompt, projectType)
      const hasReadme = ensured.some((file) => file.path.toLowerCase() === 'readme.md')
      return hasReadme
        ? ensured
        : [
            ...ensured,
            {
              path: 'README.md',
              content: `# ALPHA generated project\n\nPrompt: ${prompt}\n`
            }
          ]
    }
  }

  return ensureFilesForProjectType([], prompt, projectType)
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
  const memoryRoot = path.resolve(userDataPath, 'memory')
  const memoryNotesRoot = path.join(memoryRoot, 'notes')
  const skillsRoot = path.resolve(userDataPath, 'skills')
  const secureConfigPath = path.join(userDataPath, 'alpha_secure_vault.json')
  ensureDir(projectsRoot)
  ensureDir(memoryRoot)
  ensureDir(memoryNotesRoot)
  ensureDir(skillsRoot)

  const safeReadJsonFile = <T>(filePath: string, fallback: T): T => {
    try {
      if (!fs.existsSync(filePath)) return fallback
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
    } catch {
      return fallback
    }
  }

  const safeWriteJsonFile = (filePath: string, value: unknown) => {
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
  }

  const builderSkillTemplates: Record<string, string> = {
    'webdev.md': `# webdev\n- Prefer semantic HTML, polished CSS, responsive layouts, and useful interactions.\n- For premium prompts, include richer sections, hover states, animation, and clean information architecture.\n- Return real files, not prose-only answers.\n`,
    'react.md': `# react\n- Use React + TypeScript for app-like, dashboard, SaaS, or multi-view prompts.\n- Include package.json, index.html, src/main.tsx, src/App.tsx, src/styles.css, and README when scaffolding.\n`,
    'electron.md': `# electron\n- For Windows/desktop prompts, prefer Electron + React + TypeScript unless user clearly asks another stack.\n- Keep renderer and main files separate and include run instructions.\n`,
    'android.md': `# android\n- Prefer Kotlin + Jetpack Compose project skeleton for Android app requests.\n- Include Gradle files, AndroidManifest, MainActivity, and README.\n`,
    'python.md': `# python\n- Use .py files with clear entrypoint, dependencies, and README instructions.\n- For GUI prompts, mention the chosen toolkit in README.\n`,
    'c_cpp.md': `# c_cpp\n- Use main.c or main.cpp plus CMakeLists.txt and build instructions.\n- Keep starter code compile-ready.\n`,
    'ui_ux.md': `# ui_ux\n- User prefers premium dark UI, black theme, polished glass/neon accents, and non-basic layouts.\n- Avoid placeholder-only scaffolds when prompt asks for advanced or premium work.\n`,
    'terminal.md': `# terminal\n- Keep commands scoped to the current project folder.\n- Prefer readable output and safe, non-destructive defaults.\n`,
    'git.md': `# git\n- Do not rewrite unrelated files.\n- Keep changes scoped and preserve user work.\n`,
    'debugging.md': `# debugging\n- When checks fail, inspect the actual error, patch the smallest useful fix, and summarize what changed.\n`
  }

  const ensureSkillFiles = () => {
    for (const [fileName, content] of Object.entries(builderSkillTemplates)) {
      const filePath = path.join(skillsRoot, fileName)
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, 'utf8')
      }
    }
  }

  ensureSkillFiles()

  const getSkillFileNames = (projectType: string, prompt: string) => {
    const lower = prompt.toLowerCase()
    const selected = new Set<string>(['ui_ux.md'])
    if (projectType === 'website') selected.add('webdev.md')
    if (projectType === 'react') {
      selected.add('webdev.md')
      selected.add('react.md')
    }
    if (projectType === 'android') selected.add('android.md')
    if (projectType === 'desktop' || projectType === 'electron') selected.add('electron.md')
    if (projectType === 'python') selected.add('python.md')
    if (projectType === 'c' || projectType === 'cpp') selected.add('c_cpp.md')
    if (/\b(build|error|fix|debug|terminal|command)\b/.test(lower)) {
      selected.add('terminal.md')
      selected.add('debugging.md')
    }
    return Array.from(selected)
  }

  const loadRelevantSkills = (projectType: string, prompt: string) =>
    getSkillFileNames(projectType, prompt)
      .map((fileName) => {
        const filePath = path.join(skillsRoot, fileName)
        if (!fs.existsSync(filePath)) return ''
        return `SKILL ${fileName}\n${fs.readFileSync(filePath, 'utf8')}`
      })
      .filter(Boolean)
      .join('\n\n')

  const loadRelevantMemory = (query: string, projectRef?: string) => {
    const files = ['profile.json', 'preferences.json', 'projects.json', 'tasks.json', 'skills.json', 'knowledge-index.json']
    const entries = files.flatMap((fileName) =>
      safeReadJsonFile<MemoryEntry[]>(path.join(memoryRoot, fileName), [])
    )
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored = entries
      .filter((entry) => entry && entry.content && !/api key|token|secret/i.test(entry.content))
      .map((entry) => {
        const haystack = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase()
        let score = 0
        for (const token of tokens) {
          if (haystack.includes(token)) score += 3
        }
        if (projectRef && haystack.includes(projectRef.toLowerCase())) score += 5
        if (entry.type === 'preference') score += 2
        if (/black theme|premium|advanced|hinglish|roman hindi|react|python|cybersecurity/.test(haystack)) {
          score += 1
        }
        return { entry, score }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ entry }) => `- ${entry.title}: ${entry.content}`)
    return scored.join('\n')
  }

  const persistProjectMemory = (
    state: ProjectState,
    summary: { prompt: string; providerUsed: string; error?: string; filesChanged?: string[] }
  ) => {
    const id = `builder-project-${state.metadata.id}`
    const now = new Date().toISOString()
    const notePath = path.join(memoryNotesRoot, `${id}.json`)
    const entry: MemoryEntry = {
      id,
      type: 'project',
      title: state.metadata.name,
      content: [
        `Prompt: ${summary.prompt}`,
        `Provider: ${summary.providerUsed}`,
        `Project type: ${state.metadata.type}`,
        `Files: ${state.files.map((file) => file.path).join(', ')}`,
        summary.filesChanged?.length ? `Changed files: ${summary.filesChanged.join(', ')}` : '',
        summary.error ? `Last error: ${summary.error}` : ''
      ]
        .filter(Boolean)
        .join('\n'),
      tags: ['builder', state.metadata.type, summary.providerUsed.toLowerCase(), 'project'],
      createdAt: state.metadata.createdAt || now,
      updatedAt: now,
      source: 'builder',
      priority: 8,
      filePath: notePath
    }

    safeWriteJsonFile(notePath, entry)
    for (const fileName of ['projects.json', 'knowledge-index.json']) {
      const collectionPath = path.join(memoryRoot, fileName)
      const collection = safeReadJsonFile<MemoryEntry[]>(collectionPath, [])
      const existingIndex = collection.findIndex((item) => item.id === id)
      if (existingIndex >= 0) collection[existingIndex] = entry
      else collection.unshift(entry)
      safeWriteJsonFile(collectionPath, collection)
    }
  }

  const findLatestProjectState = () => {
    const projectDirs = fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const states = projectDirs
      .map((projectId) => {
        try {
          return readProjectState(projectId)
        } catch {
          return null
        }
      })
      .filter(Boolean) as ProjectState[]
    return states.sort((a, b) => b.metadata.updatedAt.localeCompare(a.metadata.updatedAt))[0] || null
  }

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
  const buildProjectSystemPrompt = (
    providerLabel: string,
    prompt: string,
    projectType: string,
    context: BuilderGenerationContext = {},
    currentFiles?: ProjectFile[]
  ) => {
    const relevantMemory = loadRelevantMemory(prompt, context.projectLabel)
    const relevantSkills = loadRelevantSkills(projectType, prompt)
    const advancedUi = wantsAdvancedUi(prompt)
    return [
      `You are ALPHA Coding Agent using ${providerLabel}.`,
      `Project type: ${projectType}. Preferred stack: ${stackForProjectType(projectType, prompt)}.`,
      `Permission mode: ${context.permissionMode || 'ask'}. Respect project-scoped access only.`,
      'Generate production-quality files, not explanation-only responses.',
      'Return strict JSON only.',
      'Schema: {"projectName":"string","projectType":"string","summary":"string","files":[{"path":"relative/path","content":"file contents"}]}',
      'Never wrap output in markdown.',
      'Never create generated-1.txt, output.txt, response.txt, or a single dump file unless the user explicitly asks for a text file.',
      'Choose the correct project structure for the request.',
      'For websites include at least index.html, style.css, script.js, README.md.',
      'For React/webapp prompts include package.json, index.html, src/main.tsx, src/App.tsx, src/styles.css, README.md.',
      'For Android prompts include Gradle files, AndroidManifest, MainActivity.kt, and README.',
      'For Electron/desktop prompts include package.json, src/main.ts, renderer files, and README.',
      'For Python prompts include main.py, requirements.txt when useful, and README.',
      'For C/C++ prompts include main.c or main.cpp, build files, and README.',
      'Respect existing project files carefully when editing. Return changed files or a complete corrected file map.',
      advancedUi
        ? 'The user wants premium advanced output. Use polished layouts, deeper structure, responsive sections, motion, and meaningful styling. Do not return a basic scaffold.'
        : 'Even for simple requests, make the result clean, functional, and preview-ready.',
      /\bchrome\b/i.test(prompt)
        ? 'For Chrome-like requests, create an original browser-inspired UI. Do not use official Chrome assets or logos.'
        : '',
      /\byoutube\b/i.test(prompt)
        ? 'For YouTube-like requests, create an original video-platform-inspired UI. Do not use official YouTube assets or logos.'
        : '',
      context.previousError ? `Previous build/runtime error to fix: ${context.previousError}` : '',
      relevantMemory ? `Relevant memory:\n${relevantMemory}` : 'Relevant memory: none.',
      relevantSkills ? `Relevant local skills:\n${relevantSkills}` : 'Relevant local skills: none.',
      'Include concise run instructions in README.'
    ]
      .filter(Boolean)
      .join('\n')
  }

  const buildProjectUserPrompt = (
    prompt: string,
    currentFiles?: ProjectFile[],
    context: BuilderGenerationContext = {}
  ) => {
    const projectType = detectProjectType(prompt)
    const fileTree =
      currentFiles?.map((file) => file.path).join('\n') || 'No existing files.'
    const selectedFilesPayload = currentFiles?.length
      ? JSON.stringify(currentFiles.slice(0, 10), null, 2)
      : '[]'
    return [
      currentFiles?.length
        ? 'Update this existing project for the request.'
        : 'Create a project for this request.',
      `Request: ${prompt}`,
      `Detected project type: ${projectType}`,
      `Permission mode: ${context.permissionMode || 'ask'}`,
      `Current file tree:\n${fileTree}`,
      `Current file excerpts:\n${selectedFilesPayload}`
    ].join('\n\n')
  }

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

  const callGeminiProjectProvider = async (
    prompt: string,
    currentFiles?: ProjectFile[],
    context: BuilderGenerationContext = {}
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
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
        encodeURIComponent(geminiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildProjectSystemPrompt('Gemini 2.5 Flash', prompt, projectType, context, currentFiles) }] },
          contents: [{ role: 'user', parts: [{ text: buildProjectUserPrompt(prompt, currentFiles, context) }] }],
          generationConfig: { temperature: 0.45, maxOutputTokens: 8192 }
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
    config: { endpoint: string; key: string; model: string; providerLabel: string; headers?: Record<string, string> },
    context: BuilderGenerationContext = {}
  ): Promise<ProviderResult> => {
    const projectType = detectProjectType(prompt)
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.key}`,
        ...(config.headers || {})
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.45,
        messages: [
          { role: 'system', content: buildProjectSystemPrompt(config.providerLabel, prompt, projectType, context, currentFiles) },
          { role: 'user', content: buildProjectUserPrompt(prompt, currentFiles, context) }
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

  const callGlm = async (
    prompt: string,
    currentFiles?: ProjectFile[],
    context: BuilderGenerationContext = {}
  ): Promise<ProviderResult> => {
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

    const projectType = detectProjectType(prompt)
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
          temperature: 0.45,
          messages: [
            { role: 'system', content: buildProjectSystemPrompt('GLM 5.2', prompt, projectType, context, currentFiles) },
            { role: 'user', content: buildProjectUserPrompt(prompt, currentFiles, context) }
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

  const callZai = async (
    prompt: string,
    currentFiles?: ProjectFile[],
    context: BuilderGenerationContext = {}
  ): Promise<ProviderResult> => {
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

    const projectType = detectProjectType(prompt)
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
          temperature: 0.45,
          messages: [
            { role: 'system', content: buildProjectSystemPrompt('Z.AI Coding Provider', prompt, projectType, context, currentFiles) },
            { role: 'user', content: buildProjectUserPrompt(prompt, currentFiles, context) }
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
    currentFiles?: ProjectFile[],
    context: BuilderGenerationContext = {}
  ): Promise<ProviderResult> => {
    if (provider === 'glm') {
      const glmResult = await callGlm(prompt, currentFiles, context)
      if (glmResult.success) return glmResult
      const zaiResult = await callZai(prompt, currentFiles, context)
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
    if (provider === 'zai') return callZai(prompt, currentFiles, context)
    if (provider === 'gemini') return callGeminiProjectProvider(prompt, currentFiles, context)

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
      }, context)
    }

    if (provider === 'groq') {
      return callCompatibleProvider(prompt, currentFiles, {
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        key,
        model: 'llama-3.1-8b-instant',
        providerLabel: 'Groq'
      }, context)
    }

    if (provider === 'kimi') {
      return callCompatibleProvider(prompt, currentFiles, {
        endpoint: 'https://api.moonshot.ai/v1/chat/completions',
        key,
        model: 'moonshot-v1-8k',
        providerLabel: 'Kimi'
      }, context)
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
    providerUsed: string,
    options: { summary?: string; error?: string; changedFiles?: string[] } = {}
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
      projectPath,
      lastError: options.error,
      summary: options.summary
    }

    fs.writeFileSync(existingMetaPath, JSON.stringify(metadata, null, 2), 'utf8')

    const state = {
      metadata,
      files
    }
    persistProjectMemory(state, {
      prompt,
      providerUsed,
      error: options.error,
      filesChanged: options.changedFiles || files.map((file) => file.path)
    })
    return state
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

  const getCommandRisk = (command: string) => {
    const normalized = command.toLowerCase().trim()
    if (!normalized) return { blocked: true, reason: 'Command is empty.', installLike: false }
    if (
      /(rm\s+-rf\s+\/|del\s+\/s\s+c:\\|format\b|shutdown\b|reg\s+delete\b|vssadmin\b|wmic\b|mimikatz|cookie export|credential dump)/i.test(
        normalized
      )
    ) {
      return { blocked: true, reason: 'Dangerous/system command blocked.', installLike: false }
    }
    return {
      blocked: false,
      reason: '',
      installLike: /\b(npm\s+install|pnpm\s+install|yarn\s+install|pip\s+install|gradle\s+build)\b/i.test(
        normalized
      )
    }
  }

  ipcMain.handle('project-builder-create', async (_, { prompt, provider = 'glm', permissionMode = 'ask' }) => {
    const projectType = detectProjectType(prompt || '')
    const guessedName = guessProjectName(prompt || 'website builder', projectType)
    const generated = await callProvider(provider, prompt || '', undefined, {
      permissionMode,
      projectLabel: guessedName
    })
    if (!generated.success) {
      const files = normalizeFiles({ files: [] }, prompt || '', projectType)
      const state = writeProjectState(guessedName, guessedName, prompt || '', files, generated.providerLabel, {
        error: generated.message,
        summary: generated.message
      })
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
    const state = writeProjectState(projectName, projectName, prompt || '', files, generated.providerLabel, {
      summary: payload.summary || generated.providerLabel,
      changedFiles: files.map((file) => file.path)
    })

    return {
      success: true,
      state,
      previewHtml: inlinePreviewHtml(state.files)
    }
  })

  ipcMain.handle('project-builder-update', async (_, { projectId, prompt, provider, permissionMode = 'ask' }) => {
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
      existing.files,
      {
        permissionMode,
        previousError: existing.metadata.lastError,
        projectLabel: existing.metadata.name
      }
    )
    if (!generated.success) {
      const fallbackFiles = normalizeFiles({ files: existing.files }, prompt || '', existing.metadata.type)
      const state = writeProjectState(
        projectId,
        existing.metadata.name,
        prompt || '',
        fallbackFiles.length ? fallbackFiles : existing.files,
        existing.metadata.providerUsed || generated.providerLabel,
        {
          error: generated.message,
          summary: generated.message,
          changedFiles: fallbackFiles.map((file) => file.path)
        }
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
      generated.providerLabel,
      {
        summary: payload.summary || generated.providerLabel,
        changedFiles: files.map((file) => file.path)
      }
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
        existing.metadata.providerUsed,
        {
          summary: existing.metadata.summary,
          changedFiles: [filePath]
        }
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

  ipcMain.handle('project-builder-last-project', async () => {
    try {
      const state = findLatestProjectState()
      if (!state) return { success: false, error: 'No previous Builder project found.' }
      return { success: true, state, previewHtml: inlinePreviewHtml(state.files) }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Could not load the last Builder project.' }
    }
  })

  ipcMain.handle('project-builder-save-memory', async (_, { projectId, note }) => {
    try {
      const state = readProjectState(projectId)
      persistProjectMemory(state, {
        prompt: note ? `${state.metadata.lastPrompt}\nUser note: ${note}` : state.metadata.lastPrompt,
        providerUsed: state.metadata.providerUsed,
        error: state.metadata.lastError,
        filesChanged: state.files.map((file) => file.path)
      })
      return { success: true, state, projectPath: state.metadata.projectPath }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Project memory save failed.' }
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
      const commandRisk = getCommandRisk(trimmedCommand)
      if (commandRisk.blocked) return { success: false, error: commandRisk.reason }

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
