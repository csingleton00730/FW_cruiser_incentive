import type { AuditRow, MultiplierRow, TimeRow } from '../engine/types'
import { DEFAULT_SETTINGS } from '../engine/types'
import { assignRowIds, matchMultipliers } from '../engine/calculate'
import { newId, type Quarter } from '../storage/repository'
import data from './q1-2026.json'

type R = Record<string, string | number | null>

/** 1Q 2026 as the three source files deliver it: the Crystal report, the CASL database, and the SP/MP scale-up table. */
export const sampleQuarter: (() => Quarter) | null = function sampleQuarter(): Quarter {
  const now = new Date().toISOString()
  const rows: TimeRow[] = assignRowIds((data.rows as R[]).map(r => ({
    employee: String(r.employee), empId: String(r.empId), center: String(r.center ?? ''),
    monthYear: String(r.monthYear ?? ''), date: String(r.date), project: String(r.project),
    projectDescription: String(r.projectDescription ?? ''), customerId: String(r.customerId ?? ''),
    customerName: String(r.customerName ?? ''), hours: Number(r.hours) || 0, acres: Number(r.acres) || 0,
    plots: Number(r.plots) || 0, noDays: 1, projType: String(r.projType ?? ''), wc: String(r.wc ?? ''),
  })))
  const audits: AuditRow[] = (data.audits as R[]).map(a => ({
    id: newId(), auditDate: String(a.auditDate ?? ''), year: a.year == null ? null : Number(a.year), qtr: a.qtr == null ? null : Number(a.qtr),
    cruiserName: String(a.cruiserName ?? ''), cruiserId: String(a.cruiserId), projectId: String(a.projectId ?? ''),
    grade: a.grade == null ? null : Number(a.grade), auditId: String(a.auditId ?? ''), status: String(a.status ?? 'Approved'), cruiseType: String(a.cruiseType ?? ''),
  }))
  const table: MultiplierRow[] = (data.table as Array<{ job: string; pph: number | null; factor: number }>).map(t => ({ id: newId(), job: t.job, plotsPerHour: t.pph, factor: t.factor }))
  const { byProject } = matchMultipliers(rows, table)
  return {
    id: newId(), label: data.label, createdAt: now, updatedAt: now,
    settings: { ...DEFAULT_SETTINGS, plotMultipliers: Object.fromEntries(Object.entries(byProject).map(([p, m]) => [p, m.factor])), priorAudits: { '00795': { note: 'No 1Q audit; most recent audits used (as in the 1Q workbook)' } } },
    timeRows: rows, timeFileName: data.timeFileName, audits, auditFileName: data.auditFileName,
    multiplierTable: table, multiplierFileName: data.multiplierFileName, status: 'draft',
  }
}
