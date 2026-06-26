import { IpcMain, app, Notification, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'

const slugify = (value = 'note') =>
  value
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'note'

const safeReadJson = <T>(filePath: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

const safeWriteJson = (filePath: string, data: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

const isInside = (baseDir: string, targetPath: string) => {
  const relative = path.relative(baseDir, targetPath)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

type NoteEntry = {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
  source: 'typed' | 'voice' | 'manual'
  filePath: string
  filename: string
}

type ReminderEntry = {
  id: string
  title: string
  message: string
  scheduledAt: string
  createdAt: string
  status: 'pending' | 'completed' | 'cancelled' | 'missed'
  source: 'typed' | 'voice'
  repeat: 'none' | 'daily' | 'weekly'
  filePath: string
  filename: string
}

export default function registerNotesHandlers(ipcMain: IpcMain) {
  const NOTES_DIR = path.resolve(app.getPath('userData'), 'notes')
  const LEGACY_NOTES_DIR = path.resolve(app.getPath('userData'), 'Notes')
  const REMINDERS_DIR = path.resolve(app.getPath('userData'), 'reminders')
  const reminderTimers = new Map<string, NodeJS.Timeout>()

  fs.mkdirSync(NOTES_DIR, { recursive: true })
  fs.mkdirSync(REMINDERS_DIR, { recursive: true })

  const noteFilePath = (title: string, id: string) =>
    path.join(NOTES_DIR, `note-${slugify(title)}-${id.slice(-6)}.json`)

  const reminderFilePath = (title: string, id: string) =>
    path.join(REMINDERS_DIR, `reminder-${slugify(title)}-${id.slice(-6)}.json`)

  const readNoteFile = (filePath: string): NoteEntry | null => {
    if (filePath.endsWith('.json')) {
      const note = safeReadJson<NoteEntry | null>(filePath, null)
      if (!note) return null
      return {
        ...note,
        filename: path.basename(filePath),
        filePath,
        tags: Array.isArray(note.tags) ? note.tags : []
      }
    }

    if (filePath.endsWith('.md')) {
      const stats = fs.statSync(filePath)
      const raw = fs.readFileSync(filePath, 'utf-8')
      const titleMatch = raw.match(/^#\s+(.+)$/m)
      const title = titleMatch?.[1]?.trim() || path.basename(filePath, '.md').replace(/_/g, ' ')
      const content = raw.replace(/^# .+\r?\n\r?\n/, '')
      return {
        id: path.basename(filePath, '.md'),
        title,
        content,
        tags: [],
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
        source: 'manual',
        filePath,
        filename: path.basename(filePath)
      }
    }

    return null
  }

  const getAllNotes = () => {
    const jsonFiles = fs.existsSync(NOTES_DIR)
      ? fs.readdirSync(NOTES_DIR).filter((file) => file.endsWith('.json')).map((file) => path.join(NOTES_DIR, file))
      : []
    const legacyFiles = fs.existsSync(LEGACY_NOTES_DIR)
      ? fs.readdirSync(LEGACY_NOTES_DIR).filter((file) => file.endsWith('.md')).map((file) => path.join(LEGACY_NOTES_DIR, file))
      : []

    return [...jsonFiles, ...legacyFiles]
      .map(readNoteFile)
      .filter(Boolean) as NoteEntry[]
  }

  const readReminderFile = (filePath: string): ReminderEntry | null => {
    if (!filePath.endsWith('.json')) return null
    const reminder = safeReadJson<ReminderEntry | null>(filePath, null)
    if (!reminder) return null
    return { ...reminder, filename: path.basename(filePath), filePath }
  }

  const getAllReminders = () => {
    if (!fs.existsSync(REMINDERS_DIR)) return []
    return fs
      .readdirSync(REMINDERS_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => readReminderFile(path.join(REMINDERS_DIR, file)))
      .filter(Boolean) as ReminderEntry[]
  }

  const broadcastReminder = (reminder: ReminderEntry) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('reminder-triggered', reminder)
    })
  }

  const persistReminder = (reminder: ReminderEntry) => {
    safeWriteJson(reminder.filePath, reminder)
  }

  const scheduleReminder = (reminder: ReminderEntry) => {
    if (reminderTimers.has(reminder.id)) clearTimeout(reminderTimers.get(reminder.id))
    if (reminder.status !== 'pending') return

    const delay = new Date(reminder.scheduledAt).getTime() - Date.now()
    if (delay <= 0) {
      reminder.status = 'missed'
      persistReminder(reminder)
      return
    }

    const timer = setTimeout(() => {
      const latest = readReminderFile(reminder.filePath) || reminder
      if (latest.status !== 'pending') return

      latest.status = 'completed'
      persistReminder(latest)
      reminderTimers.delete(latest.id)

      if (Notification.isSupported()) {
        new Notification({
          title: latest.title || 'ALPHA Reminder',
          body: latest.message || 'Reminder time reached.'
        }).show()
      }
      broadcastReminder(latest)
      console.log(`[REMINDER_TRIGGER] id="${latest.id}" status="triggered"`)
    }, Math.min(delay, 2147483647))

    reminderTimers.set(reminder.id, timer)
  }

  const restoreReminderTimers = () => {
    getAllReminders().forEach((reminder) => scheduleReminder(reminder))
  }

  restoreReminderTimers()

  ipcMain.handle('save-note', async (_event, payload = {}) => {
    const startedAt = Date.now()
    try {
      const now = new Date().toISOString()
      const title = String(payload.title || 'Quick Note').trim() || 'Quick Note'
      const content = String(payload.content || '').trim()
      if (!content) return { success: false, error: 'Note content is empty.' }

      const existingPath = typeof payload.filename === 'string' ? path.join(NOTES_DIR, payload.filename) : ''
      const canUpdate = existingPath && fs.existsSync(existingPath) && isInside(NOTES_DIR, existingPath)
      const existing = canUpdate ? readNoteFile(existingPath) : null
      const id = existing?.id || `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const filePath = canUpdate ? existingPath : noteFilePath(title, id)
      const note: NoteEntry = {
        id,
        title,
        content,
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        source: payload.source === 'voice' ? 'voice' : payload.source === 'manual' ? 'manual' : 'typed',
        filePath,
        filename: path.basename(filePath)
      }

      safeWriteJson(filePath, note)
      console.log(`[NOTES] action=create title="${title}" durationMs=${Date.now() - startedAt}`)
      return { success: true, path: filePath, note }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-notes', async () => {
    try {
      return getAllNotes().sort(
        (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
      )
    } catch {
      return []
    }
  })

  ipcMain.handle('search-notes', async (_event, query = '') => {
    const needle = String(query).toLowerCase().trim()
    const notes = getAllNotes()
    if (!needle) return notes
    return notes.filter((note) =>
      `${note.title} ${note.content} ${note.tags.join(' ')}`.toLowerCase().includes(needle)
    )
  })

  ipcMain.handle('delete-note', async (_event, filenameOrQuery) => {
    try {
      const value = String(filenameOrQuery || '').trim()
      const notes = getAllNotes()
      if (!value) {
        const latest = notes[0]
        if (!latest) return false
        if (!isInside(NOTES_DIR, latest.filePath) && !isInside(LEGACY_NOTES_DIR, latest.filePath)) return false
        fs.unlinkSync(latest.filePath)
        return true
      }
      const exact = notes.find((note) => note.filename === value || note.id === value)
      const fuzzy = exact || notes.find((note) => `${note.title} ${note.content}`.toLowerCase().includes(value.toLowerCase()))
      if (!fuzzy) return false
      if (!isInside(NOTES_DIR, fuzzy.filePath) && !isInside(LEGACY_NOTES_DIR, fuzzy.filePath)) return false
      fs.unlinkSync(fuzzy.filePath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('save-reminder', async (_event, payload = {}) => {
    const startedAt = Date.now()
    try {
      const now = new Date().toISOString()
      const title = String(payload.title || 'ALPHA Reminder').trim() || 'ALPHA Reminder'
      const message = String(payload.message || title).trim()
      const scheduledAt = new Date(payload.scheduledAt)
      if (!message) return { success: false, error: 'Reminder message is empty.' }
      if (Number.isNaN(scheduledAt.getTime())) return { success: false, error: 'Invalid reminder time.' }

      const id = `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const filePath = reminderFilePath(title, id)
      const reminder: ReminderEntry = {
        id,
        title,
        message,
        scheduledAt: scheduledAt.toISOString(),
        createdAt: now,
        status: 'pending',
        source: payload.source === 'voice' ? 'voice' : 'typed',
        repeat: payload.repeat === 'daily' || payload.repeat === 'weekly' ? payload.repeat : 'none',
        filePath,
        filename: path.basename(filePath)
      }

      persistReminder(reminder)
      scheduleReminder(reminder)
      console.log(`[REMINDER] action=create scheduledAt="${reminder.scheduledAt}" durationMs=${Date.now() - startedAt}`)
      return { success: true, path: filePath, reminder }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-reminders', async () => {
    return getAllReminders().sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  })

  ipcMain.handle('update-reminder-status', async (_event, { id, status }) => {
    try {
      const reminder = getAllReminders().find((item) => item.id === id || item.filename === id)
      if (!reminder || !['pending', 'completed', 'cancelled', 'missed'].includes(status)) {
        return { success: false, error: 'Reminder not found or status invalid.' }
      }
      reminder.status = status
      persistReminder(reminder)
      if (status !== 'pending' && reminderTimers.has(reminder.id)) {
        clearTimeout(reminderTimers.get(reminder.id))
        reminderTimers.delete(reminder.id)
      }
      if (status === 'pending') scheduleReminder(reminder)
      return { success: true, reminder }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('delete-reminder', async (_event, idOrQuery = '') => {
    try {
      const value = String(idOrQuery).toLowerCase().trim()
      const reminders = getAllReminders()
      const target = value
        ? reminders.find((item) => item.id.toLowerCase() === value || item.filename.toLowerCase() === value) ||
          reminders.find((item) => `${item.title} ${item.message}`.toLowerCase().includes(value))
        : reminders.filter((item) => item.status === 'pending').at(-1) || reminders.at(-1)
      if (!target) return { success: false, error: 'Reminder not found.' }
      target.status = 'cancelled'
      persistReminder(target)
      if (reminderTimers.has(target.id)) {
        clearTimeout(reminderTimers.get(target.id))
        reminderTimers.delete(target.id)
      }
      return { success: true, reminder: target }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('notes-storage-paths', async () => ({
    notesDir: NOTES_DIR,
    remindersDir: REMINDERS_DIR
  }))
}