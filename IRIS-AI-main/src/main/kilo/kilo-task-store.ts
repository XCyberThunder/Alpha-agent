import fs from 'fs'
import path from 'path'
import { shell } from 'electron'
import { KiloTaskRecord } from './kilo-types'

export default class KiloTaskStore {
  private readonly tasksRoot: string

  constructor(tasksRoot: string) {
    this.tasksRoot = tasksRoot
    if (!fs.existsSync(tasksRoot)) {
      fs.mkdirSync(tasksRoot, { recursive: true })
    }
  }

  getRootPath() {
    return this.tasksRoot
  }

  save(record: KiloTaskRecord) {
    const target = path.join(this.tasksRoot, `${record.taskId}.json`)
    fs.writeFileSync(target, JSON.stringify(record, null, 2), 'utf8')
  }

  read(taskId: string): KiloTaskRecord | null {
    const target = path.join(this.tasksRoot, `${taskId}.json`)
    if (!fs.existsSync(target)) return null
    return JSON.parse(fs.readFileSync(target, 'utf8')) as KiloTaskRecord
  }

  list(limit = 50): KiloTaskRecord[] {
    return fs
      .readdirSync(this.tasksRoot)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.tasksRoot, file), 'utf8')) as KiloTaskRecord)
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
      .slice(0, limit)
  }

  clear() {
    for (const file of fs.readdirSync(this.tasksRoot)) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(this.tasksRoot, file))
      }
    }
  }

  async openFolder() {
    return shell.openPath(this.tasksRoot)
  }
}
