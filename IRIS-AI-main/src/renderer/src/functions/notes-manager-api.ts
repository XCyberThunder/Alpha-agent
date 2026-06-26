export type LocalNote = {
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

export type LocalReminder = {
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

export const saveNote = async (title: string, content: string, tags: string[] = [], source: 'typed' | 'voice' | 'manual' = 'typed') => {
  try {
    const result = await window.electron.ipcRenderer.invoke('save-note', { title, content, tags, source })
    if (result.success) return `Note saved: ${content.slice(0, 120)}${content.length > 120 ? '...' : ''}\nPath: ${result.path}`
    return `Failed to save note: ${result.error}`
  } catch (e) {
    return 'System Error saving note.'
  }
}

export const getNotes = async (): Promise<LocalNote[]> => {
  try {
    return await window.electron.ipcRenderer.invoke('get-notes')
  } catch {
    return []
  }
}

export const searchNotes = async (query: string): Promise<LocalNote[]> => {
  try {
    return await window.electron.ipcRenderer.invoke('search-notes', query)
  } catch {
    return []
  }
}

export const deleteNoteByQuery = async (query: string) => {
  try {
    const deleted = await window.electron.ipcRenderer.invoke('delete-note', query)
    return deleted ? 'Note deleted.' : 'Note nahi mili.'
  } catch {
    return 'System Error deleting note.'
  }
}

export const readSystemNotes = async () => {
  try {
    const notes: LocalNote[] = await window.electron.ipcRenderer.invoke('get-notes')
    if (!notes || notes.length === 0) return 'Memory Bank is empty. No notes found.'

    return notes
      .slice(0, 10)
      .map((n) => `[NOTE: ${n.title}]\n${n.content}\nPath: ${n.filePath}`)
      .join('\n\n')
  } catch (e) {
    return 'System Error: Could not access Memory Bank.'
  }
}

export const listNotesSummary = async (query = '') => {
  const notes = query ? await searchNotes(query) : await getNotes()
  if (!notes.length) return query ? `No notes found for "${query}".` : 'No notes saved yet.'
  return notes
    .slice(0, 8)
    .map((note, index) => `${index + 1}. ${note.title}: ${note.content.slice(0, 140)}${note.content.length > 140 ? '...' : ''}`)
    .join('\n')
}

export const saveReminder = async (title: string, message: string, scheduledAt: Date, source: 'typed' | 'voice' = 'typed') => {
  try {
    const result = await window.electron.ipcRenderer.invoke('save-reminder', {
      title,
      message,
      scheduledAt: scheduledAt.toISOString(),
      source
    })
    if (result.success) {
      return `Reminder saved for ${new Date(result.reminder.scheduledAt).toLocaleString()}: ${result.reminder.message}`
    }
    return `Reminder save failed: ${result.error}`
  } catch {
    return 'System Error saving reminder.'
  }
}

export const getReminders = async (): Promise<LocalReminder[]> => {
  try {
    return await window.electron.ipcRenderer.invoke('get-reminders')
  } catch {
    return []
  }
}

export const listRemindersSummary = async () => {
  const reminders = await getReminders()
  const upcoming = reminders.filter((item) => item.status === 'pending')
  if (!upcoming.length) return 'No upcoming reminders.'
  return upcoming
    .slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.message} - ${new Date(item.scheduledAt).toLocaleString()}`)
    .join('\n')
}

export const cancelReminder = async (query = '') => {
  try {
    const result = await window.electron.ipcRenderer.invoke('delete-reminder', query)
    return result?.success ? `Reminder cancelled: ${result.reminder.message}` : `Reminder cancel failed: ${result?.error || 'not found'}`
  } catch {
    return 'System Error cancelling reminder.'
  }
}

export const completeReminder = async (idOrLatest = '') => {
  try {
    const reminders = await getReminders()
    const target = idOrLatest
      ? reminders.find((item) => item.id === idOrLatest || item.filename === idOrLatest || `${item.title} ${item.message}`.toLowerCase().includes(idOrLatest.toLowerCase()))
      : reminders.filter((item) => item.status === 'pending').slice(-1)[0]
    if (!target) return 'Reminder not found.'
    const result = await window.electron.ipcRenderer.invoke('update-reminder-status', { id: target.id, status: 'completed' })
    return result?.success ? `Reminder completed: ${target.message}` : `Reminder update failed: ${result?.error || 'unknown error'}`
  } catch {
    return 'System Error updating reminder.'
  }
}