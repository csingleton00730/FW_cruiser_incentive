import * as XLSX from 'xlsx'
import type { AuditRow, MultiplierRow, TimeRow } from '../engine/types'
import { newId } from '../storage/repository'
import { assignRowIds } from '../engine/calculate'

type Cell = string | number | boolean | Date | null | undefined
type Row = Record<string, Cell>

export interface ParseResult<T> {
  rows: T[]
  sheetName: string
  headers: string[]
  problems: string[]
  /** Informational notes about what was read (shown under the drop zone). */
  notes: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Find the first header matching any alias (normalized). */
function pick(headers: string[], aliases: string[]): string | undefined {
  const map = new Map(headers.map(h => [norm(h), h]))
  for (const a of aliases) { const h = map.get(norm(a)); if (h) return h }
  return undefined
}

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer()
  return XLSX.read(buf, { type: 'array', cellDates: true }) // handles .xls (Crystal), .xlsx and .csv
}

function sheetRows(wb: XLSX.WorkBook, preferSheet?: string[]): { rows: Row[]; sheetName: string; headers: string[] } {
  let sheetName = wb.SheetNames[0]
  if (preferSheet) {
    const found = wb.SheetNames.find(n => preferSheet.some(p => norm(n) === norm(p)))
    if (found) sheetName = found
  }
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true })
  const headers = rows.length ? Object.keys(rows[0]) : []
  return { rows, sheetName, headers }
}

function str(v: Cell): string {
  if (v == null) return ''
  if (v instanceof Date) return toIsoDate(v)
  return String(v).trim()
}
function num(v: Cell): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,$]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function numOrNull(v: Cell): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,$]/g, ''))
  return Number.isFinite(n) ? n : null
}
function toIsoDate(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function dateStr(v: Cell): string {
  if (v instanceof Date) return toIsoDate(v)
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : '' }
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? v : toIsoDate(d) }
  return ''
}
/** Keep leading zeros on ids like 00844 / 070 that Excel may have turned into numbers. */
function idStr(v: Cell, width: number): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number') return String(v).padStart(width, '0')
  return String(v).trim()
}

/** The Crystal "Production Report Qtrly Incentive" (.xls), or the 9-column Raw Export, or the old Raw Data tab. */
export async function parseTimeExport(file: File): Promise<ParseResult<TimeRow>> {
  const wb = await readWorkbook(file)
  const { rows, sheetName, headers } = sheetRows(wb, ['Sheet1', 'Raw Data', 'Raw Export', 'Corrected', 'Data'])
  const problems: string[] = [], notes: string[] = []
  const col = {
    employee: pick(headers, ['Employee', 'Name', 'Cruiser', 'Cruiser Name']),
    empId: pick(headers, ['Emp#', 'Emp ID', 'EmpNo', 'Employee #', 'Cruiser #', 'CruiserID', 'EmployeeID']),
    center: pick(headers, ['Center', 'Ctr', 'Center No']),
    monthYear: pick(headers, ['MonthYear', 'Month Year', 'Period']),
    date: pick(headers, ['Date', 'Work Date']),
    project: pick(headers, ['Project', 'Project #', 'Pjt #', 'ProjectNo', 'Job']),
    projectDescription: pick(headers, ['Project Description', 'Job Description', 'Description']),
    customerId: pick(headers, ['Customer#', 'Customer #', 'CustNo']),
    customerName: pick(headers, ['CustName', 'Customer', 'Customer Name']),
    hours: pick(headers, ['CruisingHours', 'Cruising Hours', 'Hours']),
    acres: pick(headers, ['CruisingAcres', 'Cruising Acres', 'Acres']),
    plots: pick(headers, ['original plots', 'CruisingPlots', 'Cruising Plots', 'Plots']),
    noDays: pick(headers, ['NoDays', 'No Days', 'Days']),
    projType: pick(headers, ['Proj Type', 'ProjType', 'Project Type']),
    wc: pick(headers, ['WC', 'Work Code', 'WorkCode']),
  }
  const required: (keyof typeof col)[] = ['employee', 'empId', 'date', 'project', 'hours', 'acres', 'plots', 'wc']
  const missing = required.filter(k => !col[k])
  if (missing.length) problems.push(`This doesn't look like the cruising time report. Missing columns: ${missing.join(', ')}. Found: ${headers.join(', ')}`)
  const raw: Omit<TimeRow, 'id'>[] = []
  if (!missing.length) {
    rows.forEach(r => {
      const employee = str(r[col.employee!])
      if (!employee) return
      raw.push({
        employee,
        empId: idStr(r[col.empId!], 5),
        center: col.center ? idStr(r[col.center], 3) : '',
        monthYear: col.monthYear ? str(r[col.monthYear]) : '',
        date: dateStr(r[col.date!]),
        project: idStr(r[col.project!], 13),
        projectDescription: col.projectDescription ? str(r[col.projectDescription]) : '',
        customerId: col.customerId ? str(r[col.customerId]) : '',
        customerName: col.customerName ? str(r[col.customerName]) : '',
        hours: num(r[col.hours!]), acres: num(r[col.acres!]), plots: num(r[col.plots!]),
        noDays: col.noDays ? num(r[col.noDays]) || 1 : 1,
        projType: col.projType ? str(r[col.projType]) : '',
        wc: col.wc ? str(r[col.wc]) : '',
      })
    })
  }
  const out: TimeRow[] = assignRowIds(raw)
  if (!missing.length) {
    const months = [...new Set(out.map(r => r.date.slice(0, 7)))].sort()
    notes.push(`${out.length.toLocaleString()} entries, ${new Set(out.map(r => r.empId)).size} employees, ${months[0]} to ${months[months.length - 1]}.`)
  }
  if (!out.length && !problems.length) problems.push('No data rows found.')
  return { rows: out, sheetName, headers, problems, notes }
}

/** The CASL export (qaCASLData): the whole audit database. The engine picks the quarter's approved audits. */
export async function parseCaslExport(file: File): Promise<ParseResult<AuditRow>> {
  const wb = await readWorkbook(file)
  const { rows, sheetName, headers } = sheetRows(wb, ['qaCASLData', 'CASL', 'Audits', 'Sheet1'])
  const problems: string[] = [], notes: string[] = []
  const col = {
    auditDate: pick(headers, ['AuditDate', 'Audit Date', 'Date']),
    year: pick(headers, ['AuditYear', 'Year']),
    qtr: pick(headers, ['AuditQtr', 'QTR', 'Quarter', 'Qtr']),
    cruiserName: pick(headers, ['CruiserName', 'Cruiser Name', 'Cruiser', 'Employee', 'Name']),
    cruiserId: pick(headers, ['CruiserNo', 'Cruiser #', 'Cruiser Number', 'Emp#', 'CruiserID']),
    projectId: pick(headers, ['JobNo', 'Pjt #', 'Project', 'Project #', 'PjtNo']),
    grade: pick(headers, ['Grade', 'Score', 'Audit Grade']),
    auditId: pick(headers, ['AuditNum', 'Audit #', 'AuditNo', 'Audit Number', 'AuditID']),
    status: pick(headers, ['Status']),
    cruiseType: pick(headers, ['CruiseType', 'Cruise Type']),
  }
  const missing = (['cruiserId', 'grade'] as const).filter(k => !col[k])
  if (missing.length) problems.push(`This doesn't look like the CASL export. Missing columns: ${missing.join(', ')}. Found: ${headers.slice(0, 12).join(', ')}…`)
  const out: AuditRow[] = []
  if (!missing.length) {
    rows.forEach(r => {
      const id = idStr(r[col.cruiserId!], 5)
      if (!id) return
      out.push({
        id: newId(),
        auditDate: col.auditDate ? dateStr(r[col.auditDate]) : '',
        year: col.year ? numOrNull(r[col.year]) : null,
        qtr: col.qtr ? numOrNull(r[col.qtr]) : null,
        cruiserName: col.cruiserName ? str(r[col.cruiserName]) : '',
        cruiserId: id,
        projectId: col.projectId ? str(r[col.projectId]) : '',
        grade: numOrNull(r[col.grade!]),
        auditId: col.auditId ? str(r[col.auditId]) : '',
        status: col.status ? str(r[col.status]) : 'Approved',
        cruiseType: col.cruiseType ? str(r[col.cruiseType]) : '',
      })
    })
    const years = out.map(a => a.year).filter((y): y is number => y != null)
    notes.push(`${out.length.toLocaleString()} audits${years.length ? `, ${Math.min(...years)}–${Math.max(...years)}` : ''}. Only this quarter's approved audits are used.`)
    if (!col.year || !col.qtr) problems.push('No AuditYear/AuditQtr columns — every audit in the file will be treated as this quarter.')
  }
  if (!out.length && !problems.length) problems.push('No audit rows found.')
  return { rows: out, sheetName, headers, problems, notes }
}

/**
 * The SP/MP report from Andy. We read only the scale-up factor table on the "Carbon Calcs" sheet:
 * a header cell "Job" with "scale up factor" to its right, rows down to the first blank job.
 */
export async function parseMultiplierReport(file: File): Promise<ParseResult<MultiplierRow>> {
  const wb = await readWorkbook(file)
  const problems: string[] = [], notes: string[] = []
  const candidates = [
    ...wb.SheetNames.filter(n => norm(n) === norm('Carbon Calcs')),
    ...wb.SheetNames.filter(n => norm(n) !== norm('Carbon Calcs')),
  ]
  for (const name of candidates) {
    const ws = wb.Sheets[name]
    const grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: null, raw: true })
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const row = grid[r] ?? []
      for (let c = 0; c < row.length; c++) {
        if (typeof row[c] !== 'string' || norm(row[c] as string) !== 'job') continue
        // find "scale up factor" to the right on the same row
        let fc = -1, pc = -1
        for (let k = c + 1; k < Math.min(row.length, c + 6); k++) {
          const h = typeof row[k] === 'string' ? norm(row[k] as string) : ''
          if (h.includes('scaleupfactor') || h === 'factor' || h === 'multiplier') fc = k
          if (h.includes('plotsperhour') || h.includes('plotshr')) pc = k
        }
        if (fc < 0) continue
        const out: MultiplierRow[] = []
        for (let i = r + 1; i < grid.length; i++) {
          const g = grid[i] ?? []
          const job = g[c]
          if (job == null || String(job).trim() === '') break
          const factor = numOrNull(g[fc])
          if (factor == null) continue // e.g. the "All other SP" reference row
          out.push({ id: newId(), job: String(job).trim(), plotsPerHour: pc >= 0 ? numOrNull(g[pc]) : null, factor })
        }
        notes.push(`${out.length} job(s) with a scale-up factor on sheet "${name}": ${out.map(o => `${o.job} ×${o.factor.toFixed(2)}`).join('; ')}`)
        return { rows: out, sheetName: name, headers: ['Job', 'scale up factor'], problems, notes }
      }
    }
  }
  problems.push(`Couldn't find a "Job" / "scale up factor" table in ${file.name}. Sheets: ${wb.SheetNames.join(', ')}.`)
  return { rows: [], sheetName: '', headers: [], problems, notes }
}
