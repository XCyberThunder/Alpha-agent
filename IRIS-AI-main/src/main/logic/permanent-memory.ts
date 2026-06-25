import fs from 'fs'
import path from 'path'
import { IpcMain, App } from 'electron'

type MemoryType = 'profile' | 'preference' | 'project' | 'task' | 'skill' | 'knowledge' | 'note'

type MemoryEntry = {
  id: string
  type: MemoryType
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
  source: string
  priority: number
  filePath: string
}

type SaveMemoryPayload = {
  content: string
  type?: MemoryType
  title?: string
  tags?: string[]
  source?: string
  priority?: number
}

const collectionFiles: Record<MemoryType, string> = {
  profile: 'profile.json',
  preference: 'preferences.json',
  project: 'projects.json',
  task: 'tasks.json',
  skill: 'skills.json',
  knowledge: 'knowledge-index.json',
  note: 'knowledge-index.json'
}

const safeReadJson = <T>(filePath: string, fallback: T): T => {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf-8')
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const safeWriteJson = (filePath: string, value: unknown) => {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'memory'

const titleFromContent = (content: string) => {
  const clean = content.replace(/\s+/g, ' ').trim()
  return clean.slice(0, 72) || 'Saved Memory'
}

const inferType = (content: string): MemoryType => {
  const lower = content.toLowerCase()
  if (/(project|website|app|repo|folder|codebase|task ko baad|continue)/i.test(lower)) return 'project'
  if (/(task|todo|work|resume|continue|pending|baad me)/i.test(lower)) return 'task'
  if (/(pasand|prefer|preference|like|default|hamesha|always)/i.test(lower)) return 'preference'
  if (/(skill|sikh|learn|learning|practice|course)/i.test(lower)) return 'skill'
  if (/(main|mera|mujhe|profile|student|researcher|developer|cybersecurity)/i.test(lower)) return 'profile'
  return 'knowledge'
}

const tagsFromContent = (content: string, type: MemoryType, extra: string[] = []) => {
  const lower = content.toLowerCase()
  const tags = new Set<string>([type, ...extra.map((tag) => tag.toLowerCase())])
  const candidates = [
    'python',
    'cybersecurity',
    'bug-hunting',
    'website',
    'coding',
    'react',
    'terminal',
    'kali',
    'ctf',
    'malware',
    'reverse-engineering',
    'automation'
  ]

  for (const tag of candidates) {
    const token = tag.replace('-', ' ')
    if (lower.includes(tag) || lower.includes(token)) tags.add(tag)
  }

  return Array.from(tags)
}

const ensureMemoryStore = (memoryDir: string) => {
  const notesDir = path.join(memoryDir, 'notes')
  fs.mkdirSync(notesDir, { recursive: true })

  for (const fileName of ['profile.json', 'preferences.json', 'projects.json', 'tasks.json', 'skills.json', 'knowledge-index.json']) {
    const filePath = path.join(memoryDir, fileName)
    if (!fs.existsSync(filePath)) safeWriteJson(filePath, [])
  }

  return notesDir
}

const loadAllEntries = (memoryDir: string): MemoryEntry[] => {
  const seen = new Set<string>()
  const entries: MemoryEntry[] = []
  for (const fileName of ['profile.json', 'preferences.json', 'projects.json', 'tasks.json', 'skills.json', 'knowledge-index.json']) {
    const collection = safeReadJson<MemoryEntry[]>(path.join(memoryDir, fileName), [])
    for (const entry of collection) {
      if (!entry?.id || seen.has(entry.id)) continue
      seen.add(entry.id)
      entries.push(entry)
    }
  }
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

const upsertEntry = (filePath: string, entry: MemoryEntry) => {
  const entries = safeReadJson<MemoryEntry[]>(filePath, [])
  const existingIndex = entries.findIndex((item) => item.id === entry.id)
  if (existingIndex >= 0) entries[existingIndex] = entry
  else entries.unshift(entry)
  safeWriteJson(filePath, entries)
}

const searchEntries = (memoryDir: string, query = '') => {
  const normalized = query.toLowerCase().trim()
  const terms = normalized.split(/\s+/).filter(Boolean)
  const entries = loadAllEntries(memoryDir)
  if (!terms.length) return entries

  return entries.filter((entry) => {
    const haystack = `${entry.type} ${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase()
    return terms.some((term) => haystack.includes(term))
  })
}

export default function registerPermanentMemory({ ipcMain, app }: { ipcMain: IpcMain; app: App }) {
  const MEMORY_DIR = path.resolve(app.getPath('userData'), 'memory')
  const NOTES_DIR = ensureMemoryStore(MEMORY_DIR)

  const saveStructuredMemory = (payload: SaveMemoryPayload): MemoryEntry | null => {
    const content = payload.content?.trim()
    if (!content) return null

    ensureMemoryStore(MEMORY_DIR)
    const now = new Date().toISOString()
    const type = payload.type || inferType(content)
    const title = payload.title?.trim() || titleFromContent(content)
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const notePath = path.join(NOTES_DIR, `${slugify(title)}-${id.slice(-6)}.json`)
    const entry: MemoryEntry = {
      id,
      type,
      title,
      content,
      tags: tagsFromContent(content, type, payload.tags),
      createdAt: now,
      updatedAt: now,
      source: payload.source || 'user',
      priority: payload.priority ?? (type === 'project' || type === 'task' ? 8 : 5),
      filePath: notePath
    }

    safeWriteJson(notePath, entry)
    upsertEntry(path.join(MEMORY_DIR, collectionFiles[type]), entry)
    upsertEntry(path.join(MEMORY_DIR, 'knowledge-index.json'), entry)
    return entry
  }

  ipcMain.handle('save-core-memory', async (_event, fact: string) => {
    try {
      return Boolean(saveStructuredMemory({ content: fact, source: 'gemini-tool' }))
    } catch {
      return false
    }
  })

  ipcMain.handle('search-core-memory', async (_event, query?: string) => {
    try {
      ensureMemoryStore(MEMORY_DIR)
      return searchEntries(MEMORY_DIR, query)
    } catch {
      return []
    }
  })

  ipcMain.handle('local-memory-save', async (_event, payload: SaveMemoryPayload) => {
    try {
      const entry = saveStructuredMemory(payload)
      return { success: Boolean(entry), entry, memoryDir: MEMORY_DIR }
    } catch (error) {
      return { success: false, error: String(error), memoryDir: MEMORY_DIR }
    }
  })

  ipcMain.handle('local-memory-search', async (_event, query?: string) => {
    try {
      ensureMemoryStore(MEMORY_DIR)
      return { success: true, entries: searchEntries(MEMORY_DIR, query), memoryDir: MEMORY_DIR }
    } catch (error) {
      return { success: false, entries: [], error: String(error), memoryDir: MEMORY_DIR }
    }
  })

  ipcMain.handle('local-memory-list', async () => {
    try {
      ensureMemoryStore(MEMORY_DIR)
      const files = fs
        .readdirSync(MEMORY_DIR, { withFileTypes: true })
        .map((item) => path.join(MEMORY_DIR, item.name))
      return { success: true, memoryDir: MEMORY_DIR, files, entries: loadAllEntries(MEMORY_DIR) }
    } catch (error) {
      return { success: false, memoryDir: MEMORY_DIR, files: [], entries: [], error: String(error) }
    }
  })

  ipcMain.handle('local-memory-delete', async (_event, query: string) => {
    try {
      ensureMemoryStore(MEMORY_DIR)
      const normalized = query.toLowerCase().trim()
      const matches = searchEntries(MEMORY_DIR, normalized)
      const target = matches[0]
      if (!target) return { success: false, deleted: null, memoryDir: MEMORY_DIR }

      for (const fileName of ['profile.json', 'preferences.json', 'projects.json', 'tasks.json', 'skills.json', 'knowledge-index.json']) {
        const filePath = path.join(MEMORY_DIR, fileName)
        const entries = safeReadJson<MemoryEntry[]>(filePath, [])
        safeWriteJson(
          filePath,
          entries.filter((entry) => entry.id !== target.id)
        )
      }

      if (target.filePath && fs.existsSync(target.filePath)) fs.unlinkSync(target.filePath)
      return { success: true, deleted: target, memoryDir: MEMORY_DIR }
    } catch (error) {
      return { success: false, deleted: null, memoryDir: MEMORY_DIR, error: String(error) }
    }
  })
}