import { MANUAL, POLICY, proratedMinHours, type Policy } from './policy'
import type {
  AuditRow, CruiserProjectAgg, CruiserResult, DataFlag, Exception, MultiplierRow, ProjectSummary,
  QuarterResult, QuarterSettings, Regression, RemovedRow, ReviewedRow, TimeRow, WaivableRule,
} from './types'

/** Ordinary least squares y = slope*x + intercept (matches an Excel linear trendline). */
export function linearFit(xs: number[], ys: number[]): Regression {
  const n = xs.length
  if (n < 2) return { slope: 0, intercept: n ? ys[0] : 0, r2: 0, n }
  let sx = 0, sy = 0
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i] }
  const mx = sx / n, my = sy / n
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy }
  const slope = sxx === 0 ? 0 : sxy / sxx
  return { slope, intercept: my - slope * mx, r2: sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy), n }
}

export function poolTotal(s: QuarterSettings, eligibleCount: number): number {
  if (s.pool.overrideTotal != null && !Number.isNaN(s.pool.overrideTotal)) return s.pool.overrideTotal
  const { share, divisor, base, multiplier } = s.pool
  return (eligibleCount * share) / divisor * base * multiplier
}

/** Parse a quarter label like "1Q 2026", "Q1 2026", "2026 Q1" → {q, year}. */
export function parseQuarterLabel(label: string): { q: number; year: number } | null {
  const m = label.match(/(?:^|\D)([1-4])\s*Q/i) || label.match(/Q\s*([1-4])(?!\d)/i)
  const y = label.match(/(20\d{2})/)
  if (!m || !y) return null
  return { q: Number(m[1]), year: Number(y[1]) }
}

/** Deterministic id for a time row, from its original values, so review edits survive re-uploading the same report. */
export function rowKey(r: Pick<TimeRow, 'empId' | 'date' | 'project' | 'wc' | 'hours' | 'acres' | 'plots'>): string {
  return `${r.empId}|${r.date}|${r.project}|${(r.wc ?? '').trim().toUpperCase()}|${r.hours}|${r.acres}|${r.plots}`
}
/** Assign deterministic ids (duplicates get #2, #3 …). */
export function assignRowIds<T extends Omit<TimeRow, 'id'>>(rows: T[]): (T & { id: string })[] {
  const seen = new Map<string, number>()
  return rows.map(r => {
    const k = rowKey(r); const n = (seen.get(k) ?? 0) + 1; seen.set(k, n)
    return { ...r, id: n === 1 ? k : `${k}#${n}` }
  })
}

/**
 * Round amounts to cents so they sum exactly to `total` (largest-remainder method).
 * Each amount moves by less than one cent from its exact value.
 */
export function allocateCents(amounts: number[], total: number): number[] {
  const target = Math.round(total * 100)
  const floors = amounts.map(a => Math.floor(a * 100))
  let left = target - floors.reduce((s, v) => s + v, 0)
  const order = amounts.map((a, i) => ({ i, rem: a * 100 - floors[i] })).sort((x, y) => y.rem - x.rem)
  for (const { i } of order) { if (left <= 0) break; floors[i]++; left-- }
  for (const { i } of [...order].reverse()) { if (left >= 0) break; floors[i]--; left++ }
  return floors.map(v => v / 100)
}

/** Apply reviewer corrections: edited values replace the originals; reviewer-removed rows leave the set. */
export function applyReview(rows: TimeRow[], s: QuarterSettings): { rows: TimeRow[]; removed: RemovedRow[]; reviewed: Map<string, ReviewedRow> } {
  const reviewed = new Map<string, ReviewedRow>()
  const out: TimeRow[] = []
  const removed: RemovedRow[] = []
  for (const r of rows) {
    const original = { hours: r.hours, acres: r.acres, plots: r.plots }
    const rm = s.rowRemovals[r.id]
    const ed = s.rowEdits[r.id]
    if (rm) { removed.push({ ...r, reason: `Removed in review: ${rm.note || 'no reason given'}` }); reviewed.set(r.id, { row: r, original, removed: rm, edit: ed, flags: [] }); continue }
    if (ed) {
      const row = { ...r, hours: ed.hours ?? r.hours, acres: ed.acres ?? r.acres, plots: ed.plots ?? r.plots }
      out.push(row); reviewed.set(r.id, { row, original, edit: ed, flags: [] })
    } else out.push(r)
  }
  return { rows: out, removed, reviewed }
}

/** Normalize a job/project description for matching: case, whitespace, punctuation. */
export const normJob = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Match the SP/MP report's scale-up table to the projects in the time report.
 * Exact normalized match first; then a table job that is contained in (or contains) the description.
 * Returns project id → {factor, job}; projects not matched get no entry (factor 1).
 */
export function matchMultipliers(rows: TimeRow[], table: MultiplierRow[]): { byProject: Record<string, { factor: number; job: string }>; unmatchedJobs: MultiplierRow[]; ambiguous: Record<string, string[]> } {
  const descs = new Map<string, string>()
  for (const r of rows) if (!descs.has(r.project)) descs.set(r.project, normJob(r.projectDescription))
  const valid = table.filter(t => t.job && t.factor > 0).map(t => ({ t, nj: normJob(t.job) }))
  const byProject: Record<string, { factor: number; job: string }> = {}
  const ambiguous: Record<string, string[]> = {}
  const used = new Set<string>()
  const take = (proj: string, hits: typeof valid) => {
    if (!hits.length) return
    byProject[proj] = { factor: hits[0].t.factor, job: hits[0].t.job }
    for (const h of hits) used.add(h.t.id)
    if (new Set(hits.map(h => h.t.factor)).size > 1) ambiguous[proj] = hits.map(h => `${h.t.job} ×${h.t.factor}`)
  }
  // Pass 1: exact normalized match
  for (const [proj, nd] of descs) take(proj, valid.filter(v => v.nj === nd))
  // Pass 2: containment, only for projects still unmatched, and only between two reasonably long names
  for (const [proj, nd] of descs) {
    if (byProject[proj]) continue
    take(proj, valid.filter(v => v.nj.length > 12 && nd.length > 12 && (nd.includes(v.nj) || v.nj.includes(nd))))
  }
  return { byProject, unmatchedJobs: valid.filter(v => !used.has(v.t.id)).map(v => v.t), ambiguous }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const isApproved = (a: AuditRow) => a.status.trim().toLowerCase() === 'approved' && a.grade != null && Number.isFinite(a.grade)

type KeptRow = TimeRow & { correctedPlots: number; factor: number }

/**
 * Decide whether a recorded exception makes a cruiser eligible, and how to describe it.
 *  - Leave of absence: the manual (item 11) prorates the hour minimum. If the prorated minimum is met and the
 *    quality rule passes, the inclusion is within the manual and needs no acknowledgment. Otherwise it is an override.
 *  - Override: needs the acknowledgment, a reason and an approver.
 */
export function evaluateException(hours: number, quality: number | null, failed: WaivableRule[], ex: Exception, policy: Policy = POLICY):
  { ok: boolean; withinManual: boolean; summary: string } {
  const parts: string[] = []
  let withinManual = false
  if (ex.basis === 'loa') {
    const weeks = ex.loaWeeks ?? 0
    const min = proratedMinHours(weeks, policy.minHours)
    const hoursOk = !failed.includes('hours') || hours >= min
    const qualityOk = !failed.includes('quality')
    withinManual = weeks > 0 && weeks < 12 && hoursOk && qualityOk // a full quarter of leave is not "a portion" of one
    parts.push(`leave of absence of ${weeks} week${weeks === 1 ? '' : 's'}, prorated minimum ${min} hrs (manual ${MANUAL.loa.ref}); ${hours.toFixed(2)} hrs ${hoursOk ? 'meets it' : 'is still short'}`)
    if (failed.includes('quality')) parts.push(`quality ${quality?.toFixed(1)} is below ${policy.hurdleGrade} (manual ${MANUAL.quality.ref})`)
  } else {
    if (failed.includes('hours')) parts.push(`${hours.toFixed(2)} of ${policy.minHours} hours (manual ${MANUAL.hours.ref})`)
    if (failed.includes('quality')) parts.push(`quality ${quality?.toFixed(1)} below ${policy.hurdleGrade} (manual ${MANUAL.quality.ref})`)
  }
  const complete = !!ex.note.trim() && !!ex.approvedBy.trim()
  if (withinManual) return { ok: complete, withinManual: true, summary: complete ? `within the manual: ${parts.join('; ')}` : 'reason and approver are required' }
  const ok = complete && ex.acknowledged
  return { ok, withinManual: false, summary: ok ? `against the Cruiser Manual: ${parts.join('; ')}` : (!ex.acknowledged ? 'the acknowledgment has not been ticked' : 'reason and approver are required') }
}

/** Apply policy removals and plot multipliers; returns the "Corrected" rows and what was removed. */
export function correctRows(rows: TimeRow[], s: QuarterSettings, policy: Policy = POLICY, quarter: { q: number; year: number } | null = null) {
  const counted = new Set(policy.countedWc.map(v => v.toUpperCase()))
  const inQuarter = (date: string) => { const y = Number(date.slice(0, 4)), mo = Number(date.slice(5, 7)); return y === quarter!.year && Math.ceil(mo / 3) === quarter!.q }
  const removed: RemovedRow[] = []
  const byReason: Record<string, number> = {}
  const drop = (r: TimeRow, reason: string) => { removed.push({ ...r, reason }); byReason[reason] = (byReason[reason] ?? 0) + 1 }
  const kept: KeptRow[] = []
  for (const r of rows) {
    const wc = (r.wc ?? '').trim().toUpperCase()
    if (!counted.has(wc)) { drop(r, wc ? `Work code ${wc}` : 'Blank work code'); continue }
    if (policy.dropZeroPlotDays && r.plots === 0) { drop(r, 'No plots recorded'); continue }
    if (policy.dropZeroHourDays && r.hours === 0) { drop(r, 'No hours recorded'); continue }
    if (policy.dropZeroAcreDays && r.acres === 0) { drop(r, 'No acres recorded'); continue }
    if (policy.excludedEmpIdPrefixes.some(p => r.empId.startsWith(p))) { drop(r, 'Western division (not N&S)'); continue }
    if (quarter && /^\d{4}-\d{2}/.test(r.date) && !inQuarter(r.date)) { drop(r, 'Outside the quarter'); continue }
    const factor = s.plotMultipliers[r.project] ?? 1
    kept.push({ ...r, factor, correctedPlots: r.plots * factor })
  }
  return { kept, removed, byReason }
}

export function aggregateProjects(kept: KeptRow[]): CruiserProjectAgg[] {
  const map = new Map<string, CruiserProjectAgg>()
  for (const r of kept) {
    const key = `${r.empId}|${r.project}`
    let a = map.get(key)
    if (!a) {
      a = { empId: r.empId, employee: r.employee, center: r.center, project: r.project, projectDescription: r.projectDescription,
        factor: r.factor, inStandard: true, plots: 0, originalPlots: 0, hours: 0, acres: 0, days: 0,
        acresPerPlot: 0, plotsPerHr: 0, plotsPerDay: 0, expPlotsPerHr: 0, expPlotsPerDay: 0, hrRatio: 0, dayRatio: 0 }
      map.set(key, a)
    }
    a.plots += r.correctedPlots; a.originalPlots += r.plots; a.hours += r.hours; a.acres += r.acres; a.days += 1
  }
  for (const a of map.values()) {
    a.acresPerPlot = a.plots ? a.acres / a.plots : 0
    a.plotsPerHr = a.hours ? a.plots / a.hours : 0
    a.plotsPerDay = a.days ? a.plots / a.days : 0
  }
  return [...map.values()]
}

export interface CalculateOptions {
  /** Test-only: override policy. The app never passes this. */
  policy?: Policy
  /** Test-only: reproduce the old workbook's MIN($D$5:$D$6) bug. */
  legacyMinOver?: { quality: string[]; production: string[] }
  /** Quarter label, used to pick the quarter's audits. */
  quarterLabel?: string
  /** The SP/MP report table, for reporting which job each project matched and which table jobs matched nothing. */
  multiplierTable?: MultiplierRow[]
}

export function calculateQuarter(rows: TimeRow[], audits: AuditRow[], s: QuarterSettings, opts: CalculateOptions = {}): QuarterResult {
  const policy = opts.policy ?? POLICY
  const flags: DataFlag[] = []
  const review = applyReview(rows, s)
  // Reviewer corrections that no longer match any row (the report was re-exported with the entry fixed at source)
  const liveIds = new Set(rows.map(r => r.id))
  for (const id of [...Object.keys(s.rowEdits), ...Object.keys(s.rowRemovals)]) if (!liveIds.has(id))
    flags.push({ kind: 'data', severity: 'info', message: `A review correction for an entry (${id.split('|').slice(0, 3).join(', ')}) no longer matches any row in the report; it is ignored.` })

  const qlab = opts.quarterLabel ? parseQuarterLabel(opts.quarterLabel) : null
  const labelUnparsed = !!opts.quarterLabel && !qlab
  if (labelUnparsed) flags.push({ kind: 'data', severity: 'warn', message: `"${opts.quarterLabel}" is not a quarter the app can read. Name the quarter like "1Q 2026" so the right audits and dates are used — until then no audits are counted.` })
  const { kept, removed: policyRemoved, byReason } = correctRows(review.rows, s, policy, qlab)
  const removed = [...review.removed, ...policyRemoved]
  if (review.removed.length) byReason['Removed in review'] = review.removed.length
  const projects = aggregateProjects(kept)

  // --- Does the time report belong to this quarter? ---
  let periodMismatch: QuarterResult['periodMismatch'] = null
  if (qlab && rows.length) {
    const months = [...new Set(rows.map(r => r.date.slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort()
    const inQ = (m: string) => { const [y, mo] = m.split('-').map(Number); return y === qlab.year && Math.ceil(mo / 3) === qlab.q }
    const outside = rows.filter(r => !inQ(r.date.slice(0, 7))).length / rows.length
    if (outside > 0.5) {
      periodMismatch = { quarter: opts.quarterLabel!, reportMonths: months, shareOutside: outside }
      flags.push({ kind: 'data', severity: 'warn', message: `The time report's dates (${months[0]} to ${months[months.length - 1]}) are not in ${opts.quarterLabel}. Upload the right quarter's report or rename this quarter.` })
    }
  }

  // --- Project summaries & multiplier table reconciliation ---
  const match = opts.multiplierTable ? matchMultipliers(rows, opts.multiplierTable) : null
  const psum = new Map<string, ProjectSummary>()
  for (const p of projects) {
    let e = psum.get(p.project)
    if (!e) {
      e = { project: p.project, description: p.projectDescription, factor: p.factor, matchedJob: match?.byProject[p.project]?.job ?? null, cruisers: 0, hours: 0, acres: 0, originalPlots: 0, adjustedPlots: 0 }
      psum.set(p.project, e)
    }
    e.cruisers++; e.hours += p.hours; e.acres += p.acres; e.originalPlots += p.originalPlots; e.adjustedPlots += p.plots
  }
  const projectSummaries = [...psum.values()].sort((a, b) => Number(b.factor !== 1) - Number(a.factor !== 1) || b.originalPlots - a.originalPlots)
  for (const t of match?.unmatchedJobs ?? []) flags.push({ kind: 'project', severity: 'warn', message: `"${t.job}" (factor ${t.factor.toFixed(2)}) is in the SP/MP table but matches no project in the time report. Check the job name.` })
  for (const [proj, hits] of Object.entries(match?.ambiguous ?? {})) flags.push({ kind: 'project', severity: 'warn', project: proj, message: `${psum.get(proj)?.description || proj} matches more than one table job with different factors (${hits.join('; ')}); using the first. Check the job names in the SP/MP table.` })
  if (!opts.multiplierTable || !opts.multiplierTable.length) flags.push({ kind: 'project', severity: 'warn', message: 'No SP/MP report loaded — every project is at multiplier 1.' })
  for (const e of projectSummaries) if (e.factor !== 1 && e.factor !== (match?.byProject[e.project]?.factor ?? 1)) flags.push({ kind: 'project', severity: 'info', project: e.project, message: `${e.description}: multiplier ${e.factor} differs from the table.` })

  // --- Per-cruiser production grade, SP share ---
  const byCruiser = new Map<string, CruiserResult>()
  const sums = new Map<string, { hx: number; dx: number }>()
  for (const p of projects) {
    let c = byCruiser.get(p.empId)
    if (!c) {
      c = { empId: p.empId, employee: p.employee, center: p.center, hours: 0, days: 0, plots: 0, originalPlots: 0, acres: 0,
        hourGrade: 0, dayGrade: 0, productionGrade: 0, audits: [], priorAudits: [], usedPriorAudits: false, qualityGrade: null,
        eligible: false, eligibilityReasons: [], failedRules: [], removed: false, removalNote: '',
        qualityScale: 0, qualityPerPlot: 0, qualityIncentive: 0, productionScale: 0, productionPerPlot: 0, productionIncentive: 0, totalPerPlot: 0, totalIncentive: 0, qualityPaid: 0, productionPaid: 0, totalPaid: 0 }
      byCruiser.set(p.empId, c); sums.set(p.empId, { hx: 0, dx: 0 })
    }
    c.hours += p.hours; c.days += p.days; c.plots += p.plots; c.originalPlots += p.originalPlots; c.acres += p.acres
  }
  // --- Audits: pick this quarter's approved audits; keep prior ones available as fallback ---
  const ql = qlab
  // An audit's quarter: the CASL AuditYear/AuditQtr columns, else its date. Audits with neither are set aside and flagged.
  const periodOf = (a: AuditRow): number | null => {
    if (a.year != null && a.qtr != null) return a.year * 4 + a.qtr
    const m = a.auditDate.match(/^(\d{4})-(\d{2})/)
    return m ? Number(m[1]) * 4 + Math.ceil(Number(m[2]) / 3) : null
  }
  const nowKey = ql ? ql.year * 4 + ql.q : null
  // No label at all → every audit counts (tests, ad-hoc runs). Label that can't be read → none count (fail closed).
  const inQuarter = (a: AuditRow) => !opts.quarterLabel ? true : nowKey != null && periodOf(a) === nowKey
  const before = (a: AuditRow) => { const k = periodOf(a); return nowKey != null && k != null && k < nowKey }
  const seenAudit = new Set<string>()
  const dedup: AuditRow[] = []
  for (const a of audits) {
    const key = a.auditId && a.auditId !== 'manual' ? `${a.cruiserId}|${a.auditId}` : a.id
    if (seenAudit.has(key)) { flags.push({ kind: 'audit', severity: 'info', empId: a.cruiserId, message: `${a.cruiserName}: audit #${a.auditId} appears twice in the CASL export; counted once.` }); continue }
    seenAudit.add(key); dedup.push(a)
  }
  for (const a of dedup) if (periodOf(a) == null && a.cruiserId && isApproved(a))
    flags.push({ kind: 'audit', severity: 'warn', empId: a.cruiserId, message: `${a.cruiserName}: audit #${a.auditId} (grade ${a.grade}) has no year/quarter or date in the CASL export, so it is not counted.` })
  const quarterAudits = dedup.filter(a => periodOf(a) != null && inQuarter(a))
  const auditsByCruiser = new Map<string, AuditRow[]>()
  const priorByCruiser = new Map<string, AuditRow[]>()
  for (const a of dedup) {
    if (periodOf(a) == null) continue
    if (inQuarter(a)) { const l = auditsByCruiser.get(a.cruiserId) ?? []; l.push(a); auditsByCruiser.set(a.cruiserId, l) }
    else if (before(a) && isApproved(a)) { const l = priorByCruiser.get(a.cruiserId) ?? []; l.push(a); priorByCruiser.set(a.cruiserId, l) }
  }
  for (const c of byCruiser.values()) {
    const list = auditsByCruiser.get(c.empId) ?? []
    const approved = list.filter(isApproved)
    for (const a of list.filter(a => !isApproved(a))) flags.push({ kind: 'audit', severity: 'warn', empId: c.empId, message: `${c.employee}: audit #${a.auditId} (${a.auditDate}) is "${a.status || 'not approved'}"${a.grade == null ? ' with no grade' : ''} and is not counted yet.` })
    // Most recent prior quarter's approved audits
    const prior = (priorByCruiser.get(c.empId) ?? []).sort((x, y) => periodOf(y)! - periodOf(x)!)
    const latestKey = prior.length ? periodOf(prior[0]) : null
    c.priorAudits = latestKey == null ? [] : prior.filter(a => periodOf(a) === latestKey)
    if (approved.length) c.audits = approved
    else if (s.priorAudits[c.empId] && c.priorAudits.length) { c.audits = c.priorAudits; c.usedPriorAudits = true }
    const grades = c.audits.map(a => a.grade as number)
    c.qualityGrade = grades.length ? mean(grades) : null
    if (c.usedPriorAudits) flags.push({ kind: 'audit', severity: 'info', empId: c.empId, message: `${c.employee}: no approved audit this quarter; using ${c.audits[0].qtr}Q ${c.audits[0].year} audits (${grades.join(', ')}) — ${s.priorAudits[c.empId].note || 'no reason given'}.` })
  }
  for (const [id, list] of auditsByCruiser) if (!byCruiser.has(id)) flags.push({ kind: 'audit', severity: 'info', empId: id, message: `${list[0].cruiserName} (${id}) has ${list.length} audit(s) this quarter but no counted cruising. Ignored.` })

  // --- Eligibility (policy; removals exclude; a recorded exception can include) ---
  for (const c of byCruiser.values()) {
    const reasons: string[] = []
    const failed: WaivableRule[] = []
    if (c.hours < policy.minHours) { reasons.push(`${c.hours.toFixed(1)} hrs, ${policy.minHours} required`); failed.push('hours') }
    if (c.qualityGrade == null) reasons.push('no approved audit')
    else if (c.qualityGrade < policy.hurdleGrade) { reasons.push(`quality ${c.qualityGrade.toFixed(1)}, ${policy.hurdleGrade} required`); failed.push('quality') }
    const rm = s.removals[c.empId]
    if (rm) { c.removed = true; c.removalNote = rm.note; reasons.push(`removed: ${rm.note || 'no reason given'}`) }
    c.failedRules = failed
    c.eligibilityReasons = reasons
    c.eligible = reasons.length === 0

    // A recorded exception can make a cruiser eligible when ONLY waivable rules fail (not "no audit", not a removal).
    const ex = s.exceptions?.[c.empId]
    if (ex && !c.eligible && failed.length > 0 && reasons.length === failed.length) {
      const verdict = evaluateException(c.hours, c.qualityGrade, failed, ex, policy)
      if (verdict.ok) {
        c.eligible = true
        c.exception = { ...ex, withinManual: verdict.withinManual, summary: verdict.summary }
        flags.push({ kind: 'exception', severity: 'warn', empId: c.empId, message: `${c.employee} is included as an exception — ${verdict.summary}. Approved by ${ex.approvedBy || '(no name)'}: ${ex.note || 'no reason given'}.` })
      } else {
        flags.push({ kind: 'exception', severity: 'warn', empId: c.empId, message: `${c.employee}: the exception is incomplete (${verdict.summary}) so they stay excluded.` })
      }
    }
    if (c.eligible && c.audits.length === 1) flags.push({ kind: 'audit', severity: 'info', empId: c.empId, message: `${c.employee} has only one audit this quarter (grade ${c.audits[0].grade}). The Cruiser Manual (item 13) asks for a minimum of two passing audits.` })
    if (c.hours >= policy.minHours && c.qualityGrade == null && !rm)
      flags.push({ kind: 'audit', severity: 'warn', empId: c.empId, message: `${c.employee} has ${c.hours.toFixed(1)} hours and ${c.plots.toFixed(0)} plots but no approved audit this quarter${c.priorAudits.length ? ` — prior audits available (${c.priorAudits[0].qtr}Q ${c.priorAudits[0].year}: ${c.priorAudits.map(a => a.grade).join(', ')})` : ''}.` })
    if (!c.eligible && !rm && c.hours >= policy.minHours - 2 && c.hours < policy.minHours)
      flags.push({ kind: 'eligibility', severity: 'info', empId: c.empId, message: `${c.employee} is just under the hour minimum (${c.hours.toFixed(2)} of ${policy.minHours}). The Cruiser Manual excludes them unless a leave of absence prorates the minimum.` })
  }

  // --- Standard (regression of productivity on acres/plot) ---
  let regHr: Regression, regDay: Regression
  for (const p of projects) p.inStandard = byCruiser.get(p.empId)?.eligible ?? false
  const fitRows = projects.filter(p => p.inStandard && p.plots > 0 && p.hours > 0)
  const xs = fitRows.map(p => p.acresPerPlot)
  regHr = linearFit(xs, fitRows.map(p => p.plotsPerHr))
  regDay = linearFit(xs, fitRows.map(p => p.plotsPerDay))
  if (s.mode === 'legacy' && s.legacyCoefficients) {
    regHr = { ...regHr, slope: s.legacyCoefficients.hr[0], intercept: s.legacyCoefficients.hr[1] }
    regDay = { ...regDay, slope: s.legacyCoefficients.day[0], intercept: s.legacyCoefficients.day[1] }
  }
  for (const p of projects) {
    p.expPlotsPerHr = regHr.slope * p.acresPerPlot + regHr.intercept
    p.expPlotsPerDay = regDay.slope * p.acresPerPlot + regDay.intercept
    p.hrRatio = p.expPlotsPerHr > 0 ? p.plotsPerHr / p.expPlotsPerHr : 0
    p.dayRatio = p.expPlotsPerDay > 0 ? p.plotsPerDay / p.expPlotsPerDay : 0
    if (p.inStandard && (p.expPlotsPerHr <= 0 || p.expPlotsPerDay <= 0)) flags.push({ kind: 'data', severity: 'warn', empId: p.empId, project: p.project,
      message: `${p.employee} on ${p.projectDescription || p.project}: acres/plot of ${p.acresPerPlot.toFixed(1)} is beyond the standard's range; graded as 0 for this project.` })
  }

  for (const p of projects) { const sm = sums.get(p.empId)!; sm.hx += p.hrRatio * p.hours; sm.dx += p.dayRatio * p.days }
  for (const c of byCruiser.values()) {
    const sm = sums.get(c.empId)!
    c.hourGrade = c.hours ? sm.hx / c.hours : 0
    c.dayGrade = c.days ? sm.dx / c.days : 0
    c.productionGrade = (s.dayWeight * c.dayGrade + c.hourGrade) / (s.dayWeight + 1)
  }

  // --- Data checks (row-level where possible, so the reviewer can fix the entry) ---
  const rowsOf = (empId: string, project: string) => kept.filter(r => r.empId === empId && r.project === project).map(r => r.id)
  const byProject = new Map<string, CruiserProjectAgg[]>()
  for (const p of projects) { const l = byProject.get(p.project) ?? []; l.push(p); byProject.set(p.project, l) }
  // A single day far from the cruiser's own typical day on that project (needs 3+ days) — catches one-off typos
  const dayByCP = new Map<string, typeof kept>()
  for (const r of kept) { const k = `${r.empId}|${r.project}`; const l = dayByCP.get(k) ?? []; l.push(r); dayByCP.set(k, l) }
  for (const days of dayByCP.values()) {
    if (days.length < 3) continue
    const med = median(days.map(r => r.acres / r.plots).filter(v => v > 0))
    for (const r of days) {
      const app = r.acres / r.plots
      if (med > 0 && app > 0 && (app > med * 4 || app < med / 4))
        flags.push({ kind: 'data', severity: 'warn', empId: r.empId, project: r.project, rowIds: [r.id], message: `${r.employee} on ${r.date}, ${r.projectDescription || r.project}: ${r.acres} acres / ${r.plots} plots = ${app.toFixed(2)} acres/plot vs ${med.toFixed(2)} on their other days there — check the entry.` })
    }
  }
  // Cruiser-project acres/plot far from other cruisers on the same project (catches a consistent mis-entry)
  for (const [proj, list] of byProject) {
    if (list.length < 2) continue
    const med = median(list.map(p => p.acresPerPlot).filter(v => v > 0))
    for (const p of list) if (med > 0 && p.acresPerPlot > 0 && (p.acresPerPlot > med * 3 || p.acresPerPlot < med / 3) && !flags.some(f => f.empId === p.empId && f.project === proj))
      flags.push({ kind: 'data', severity: 'warn', empId: p.empId, project: proj, rowIds: rowsOf(p.empId, proj), message: `${p.employee} on ${p.projectDescription || proj}: ${p.acresPerPlot.toFixed(2)} acres/plot vs ${med.toFixed(2)} for others on the project — check acres or plots.` })
  }
  // Day plots/hr far above the typical day on the same project (3+ days on the project)
  const dayByProject = new Map<string, typeof kept>()
  for (const r of kept) { const l = dayByProject.get(r.project) ?? []; l.push(r); dayByProject.set(r.project, l) }
  for (const days of dayByProject.values()) {
    if (days.length < 3) continue
    const med = median(days.map(r => r.plots / r.hours).filter(v => v > 0))
    for (const r of days) if (med > 0 && r.hours >= 2 && r.plots / r.hours > med * 3)
      flags.push({ kind: 'data', severity: 'warn', empId: r.empId, project: r.project, rowIds: [r.id], message: `${r.employee} on ${r.date}, ${r.projectDescription || r.project}: ${r.plots} plots in ${r.hours} hrs (${(r.plots / r.hours).toFixed(1)}/hr) is ${(r.plots / r.hours / med).toFixed(1)}× the typical day on that project — check hours or plots.` })
  }
  // Implausible day length
  for (const r of kept) if (r.hours > 14)
    flags.push({ kind: 'data', severity: 'warn', empId: r.empId, project: r.project, rowIds: [r.id], message: `${r.employee} on ${r.date}: ${r.hours} hours in one day — check the entry.` })
  // Negative values (time-system correction entries)
  for (const r of kept) if (r.acres < 0 || r.hours < 0 || r.plots < 0)
    flags.push({ kind: 'data', severity: 'warn', empId: r.empId, project: r.project, rowIds: [r.id], message: `${r.employee} on ${r.date}, ${r.projectDescription || r.project}: negative value (${r.hours} hrs, ${r.acres} acres, ${r.plots} plots) — looks like a correction entry; fix or remove it.` })
  // Duplicates
  const seen = new Map<string, string>()
  for (const r of kept) {
    const k = `${r.empId}|${r.date}|${r.project}|${r.hours}|${r.plots}|${r.acres}`
    const first = seen.get(k)
    if (first) flags.push({ kind: 'data', severity: 'warn', empId: r.empId, project: r.project, rowIds: [first, r.id], message: `${r.employee}: duplicate entry on ${r.date} for ${r.projectDescription || r.project} (${r.hours} hrs, ${r.plots} plots) — remove one if it was entered twice.` })
    else seen.set(k, r.id)
  }

  const eligible = [...byCruiser.values()].filter(c => c.eligible)
  const eligibleCount = eligible.length
  const totalPool = poolTotal(s, eligibleCount)
  const qualityPool = totalPool * s.qualityShare
  const productionPool = totalPool - qualityPool
  const unit = (points: number, scale: number) => { const u = points / scale; return u > 0 && Number.isFinite(u) ? u : Infinity } // a zero step would divide by zero; Infinity makes every scale 1
  const qualityScaleUnit = unit(s.qualityStepPoints, s.qualityStepScale)
  const productionScaleUnit = unit(s.productionStepGrade, s.productionStepScale)
  const minOver = (ids: string[] | undefined, pick: (c: CruiserResult) => number) => {
    const pool = ids ? eligible.filter(c => ids.includes(c.empId)) : eligible
    return pool.length ? Math.min(...pool.map(pick)) : 0
  }
  const qMin = minOver(opts.legacyMinOver?.quality, c => c.qualityGrade ?? 0)
  const pMin = minOver(opts.legacyMinOver?.production, c => c.productionGrade)
  let qDen = 0, pDen = 0
  for (const c of eligible) {
    c.qualityScale = 1 + ((c.qualityGrade ?? 0) - qMin) / qualityScaleUnit
    c.productionScale = 1 + (c.productionGrade - pMin) / productionScaleUnit
    qDen += c.qualityScale * c.plots; pDen += c.productionScale * c.plots
  }
  const qualityRate = qDen ? qualityPool / qDen : 0
  const productionRate = pDen ? productionPool / pDen : 0
  for (const c of eligible) {
    c.qualityPerPlot = c.qualityScale * qualityRate; c.productionPerPlot = c.productionScale * productionRate
    c.qualityIncentive = c.plots * c.qualityPerPlot; c.productionIncentive = c.plots * c.productionPerPlot
    c.totalPerPlot = c.qualityPerPlot + c.productionPerPlot; c.totalIncentive = c.qualityIncentive + c.productionIncentive
  }
  // Whole cents that foot exactly to each pool (largest remainder), so the printed column equals the printed pool
  const qPaid = allocateCents(eligible.map(c => c.qualityIncentive), qDen ? qualityPool : 0)
  const pPaid = allocateCents(eligible.map(c => c.productionIncentive), pDen ? productionPool : 0)
  eligible.forEach((c, i) => { c.qualityPaid = qPaid[i]; c.productionPaid = pPaid[i]; c.totalPaid = Math.round((qPaid[i] + pPaid[i]) * 100) / 100 })

  // Policy-removed days that still have plots: usually hours or acres were missed on entry — fixable in review
  for (const r of removed) {
    if (r.reason === 'No hours recorded' && r.plots > 0) flags.push({ kind: 'data', severity: 'warn', empId: r.empId, project: r.project, rowIds: [r.id], message: `${r.employee} on ${r.date}, ${r.projectDescription || r.project}: ${r.plots} plots but 0 hours — removed by policy. Enter the hours to include the day.` })
    if (r.reason === 'No acres recorded' && r.plots > 0) flags.push({ kind: 'data', severity: 'warn', empId: r.empId, project: r.project, rowIds: [r.id], message: `${r.employee} on ${r.date}, ${r.projectDescription || r.project}: ${r.plots} plots but 0 acres — removed by policy. Enter the acres to include the day.` })
  }

  // --- Rows for the Data review table: flagged + edited + reviewer-removed ---
  const reviewedMap = review.reviewed
  const rowById = new Map(review.rows.map(r => [r.id, r]))
  for (const f of flags) for (const id of f.rowIds ?? []) {
    const row = rowById.get(id); if (!row) continue
    let e = reviewedMap.get(id)
    if (!e) { e = { row, original: { hours: row.hours, acres: row.acres, plots: row.plots }, flags: [] }; reviewedMap.set(id, e) }
    if (!e.flags.includes(f.message)) e.flags.push(f.message)
  }
  // originals for edited rows come from the raw input
  const rawById = new Map(rows.map(r => [r.id, r]))
  for (const e of reviewedMap.values()) { const raw = rawById.get(e.row.id); if (raw) e.original = { hours: raw.hours, acres: raw.acres, plots: raw.plots } }
  for (const e of reviewedMap.values()) if (!e.flags.length) e.flags = e.removed?.why ?? e.edit?.why ?? []
  const reviewed = [...reviewedMap.values()].sort((a, b) => a.row.employee.localeCompare(b.row.employee) || a.row.date.localeCompare(b.row.date))

  const cruisers = [...byCruiser.values()].sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.employee.localeCompare(b.employee))
  return { rowsUsed: kept.length, reviewed, rowsAfterReview: review.rows, periodMismatch, labelUnparsed, removedRows: removed, removedByReason: byReason, projects, projectSummaries, regressionHr: regHr, regressionDay: regDay,
    cruisers, eligibleCount, totalPool, qualityPool, productionPool, qualityRate, productionRate, qualityScaleUnit, productionScaleUnit, flags, quarterAudits }
}
