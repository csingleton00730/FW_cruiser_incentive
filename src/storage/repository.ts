import { openDB, type IDBPDatabase } from 'idb'
import type { AuditRow, MultiplierRow, QuarterSettings, TimeRow } from '../engine/types'

export interface Quarter {
  id: string
  label: string // e.g. "1Q 2026"
  createdAt: string
  updatedAt: string
  settings: QuarterSettings
  timeRows: TimeRow[]
  timeFileName: string | null
  audits: AuditRow[]
  auditFileName: string | null
  /** Scale-up factor table read from the SP/MP report. */
  multiplierTable: MultiplierRow[]
  multiplierFileName: string | null
  status: 'draft' | 'final'
}

export type QuarterSummary = Pick<Quarter, 'id' | 'label' | 'createdAt' | 'updatedAt' | 'status'> & {
  cruisers: number
  rows: number
}

/**
 * Storage seam. v1 = browser IndexedDB. A backend implementation (REST/Azure/Supabase)
 * only needs to implement this interface; the UI does not change.
 */
export interface QuarterRepository {
  list(): Promise<QuarterSummary[]>
  get(id: string): Promise<Quarter | undefined>
  save(q: Quarter): Promise<void>
  remove(id: string): Promise<void>
}

const DB = 'cruiser-incentive'
const Q = 'quarters'

export class IndexedDbRepository implements QuarterRepository {
  private _dbp: Promise<IDBPDatabase> | null = null
  private get dbp(): Promise<IDBPDatabase> {
    if (!this._dbp) this._dbp = openDB(DB, 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) db.createObjectStore(Q, { keyPath: 'id' })
        if (db.objectStoreNames.contains('projects')) db.deleteObjectStore('projects')
      },
    })
    return this._dbp
  }
  async list() {
    const db = await this.dbp
    const all = (await db.getAll(Q)) as Quarter[]
    return all
      .map(q => ({
        id: q.id, label: q.label, createdAt: q.createdAt, updatedAt: q.updatedAt, status: q.status,
        cruisers: new Set(q.timeRows.map(r => r.empId)).size, rows: q.timeRows.length,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  async get(id: string) { return (await this.dbp).get(Q, id) as Promise<Quarter | undefined> }
  async save(q: Quarter) { await (await this.dbp).put(Q, q) }
  async remove(id: string) { await (await this.dbp).delete(Q, id) }
}

export const repository: QuarterRepository = new IndexedDbRepository()

export function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}
