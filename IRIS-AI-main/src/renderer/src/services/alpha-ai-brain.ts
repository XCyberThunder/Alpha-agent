export interface ChatMessage {
  role: 'user' | 'model'
  parts: [{ text: string }]
}

export type LocalMemoryType =
  | 'profile'
  | 'preference'
  | 'project'
  | 'task'
  | 'skill'
  | 'knowledge'
  | 'note'

export interface LocalMemoryEntry {
  id: string
  type: LocalMemoryType
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
  source: string
  priority: number
  filePath: string
}

export const saveMessage = async (role: 'user' | 'model' | 'alpha', text: string) => {
  try {
    if (!text) return

    const safeRole = role === 'alpha' ? 'model' : role

    await window.electron.ipcRenderer.invoke('add-message', {
      role: safeRole,
      parts: [{ text: text }]
    })
  } catch (err) {}
}

export const getHistory = async (): Promise<ChatMessage[]> => {
  try {
    const history = await window.electron.ipcRenderer.invoke('get-history')
    return history || []
  } catch (e) {
    return []
  }
}

export const saveLocalMemory = async (
  content: string,
  options: Partial<Pick<LocalMemoryEntry, 'type' | 'title' | 'tags' | 'source' | 'priority'>> = {}
): Promise<{ success: boolean; entry?: LocalMemoryEntry; memoryDir?: string; message: string }> => {
  try {
    const result = await window.electron.ipcRenderer.invoke('local-memory-save', {
      content,
      ...options
    })

    if (result?.success && result.entry) {
      return {
        success: true,
        entry: result.entry,
        memoryDir: result.memoryDir,
        message: `Saved to local memory: ${result.entry.title}\nPath: ${result.entry.filePath}`
      }
    }

    return {
      success: false,
      memoryDir: result?.memoryDir,
      message: 'I could not save that memory locally.'
    }
  } catch {
    return { success: false, message: 'I could not save that memory locally.' }
  }
}

export const searchLocalMemory = async (
  query = ''
): Promise<{ success: boolean; entries: LocalMemoryEntry[]; memoryDir?: string }> => {
  try {
    const result = await window.electron.ipcRenderer.invoke('local-memory-search', query)
    return {
      success: Boolean(result?.success),
      entries: result?.entries || [],
      memoryDir: result?.memoryDir
    }
  } catch {
    return { success: false, entries: [] }
  }
}

export const listLocalMemoryFiles = async (): Promise<{
  success: boolean
  files: string[]
  entries: LocalMemoryEntry[]
  memoryDir?: string
}> => {
  try {
    const result = await window.electron.ipcRenderer.invoke('local-memory-list')
    return {
      success: Boolean(result?.success),
      files: result?.files || [],
      entries: result?.entries || [],
      memoryDir: result?.memoryDir
    }
  } catch {
    return { success: false, files: [], entries: [] }
  }
}

export const deleteLocalMemory = async (
  query: string
): Promise<{ success: boolean; deleted?: LocalMemoryEntry; memoryDir?: string; message: string }> => {
  try {
    const result = await window.electron.ipcRenderer.invoke('local-memory-delete', query)
    if (result?.success && result.deleted) {
      return {
        success: true,
        deleted: result.deleted,
        memoryDir: result.memoryDir,
        message: `Deleted memory: ${result.deleted.title}`
      }
    }

    return {
      success: false,
      memoryDir: result?.memoryDir,
      message: 'I could not find a matching memory to delete.'
    }
  } catch {
    return { success: false, message: 'I could not delete that memory.' }
  }
}

export const saveCoreMemory = async (fact: string): Promise<string> => {
  try {
    const saved = await saveLocalMemory(fact, { source: 'gemini-tool' })

    if (saved.success) {
      return `Successfully saved to local memory: "${fact}"\nPath: ${saved.entry?.filePath}`
    }
    return 'Could not save to local memory.'
  } catch (error) {
    return `Memory save failed: ${String(error)}`
  }
}

export const retrieveCoreMemory = async (): Promise<string> => {
  try {
    const result = await searchLocalMemory('')
    const memories = result.entries

    if (memories && memories.length > 0) {
      const compact = memories.slice(0, 12).map((memory) => ({
        type: memory.type,
        title: memory.title,
        content: memory.content,
        tags: memory.tags,
        priority: memory.priority,
        filePath: memory.filePath
      }))
      return `Local memory context from ${result.memoryDir}:\n${JSON.stringify(compact)}`
    }
    return 'The local memory bank is currently empty.'
  } catch (error) {
    return `Memory retrieval failed: ${String(error)}`
  }
}
