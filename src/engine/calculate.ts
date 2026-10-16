import { POLICY, type Policy } from './policy'
import type {
  AuditRow, CruiserProjectAgg, CruiserResult, DataFlag, MultiplierRow, ProjectSummary,
  QuarterResult, QuarterSettings, Regression, RemovedRow, ReviewedRow, TimeRow,
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
  const m = label.match(/(?:^|\D)([1-4])\s*Q(?:\D|$)/i) || label.match(/Q\s*([1-4])/i)
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
export function matchMultipliers(rows: TimeRow[], table: MultiplierRow[]): { byProject: Record<string, { factor: number; job: string }>; unmatchedJobs: MultiplierRow[] } {
  const descs = new Map<string, string>()
  for (const r of rows) if (!descs.has(r.project)) descs.set(r.project, r.projectDescription)
  const byProject: Record<string, { factor: number; job: string }> = {}
  const used = new Set<string>()
  for (const t of table) {
    if (!t.job || !(t.factor > 0)) continue
    const nj = normJob(t.job)
    for (const [proj, d] of descs) {
      const nd = normJob(d)
      if (nd === nj || (nj.length > 12 && (nd.includes(nj) || nj.includes(nd)))) { byProject[proj] = { factor: t.factor, job: t.job }; used.add(t.id) }
    }
  }
  return { byProject, unmatchedJobs: table.filter(t => t.job && t.factor > 0 && !used.has(t.id)) }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const isApproved = (a: AuditRow) => (a.status || 'Approved').toLowerCase() === 'approved' && a.grade != null && Number.isFinite(a.grade)

type KeptRow = TimeRow & { correctedPlots: number; factor: number }

/** Apply policy removals and plot multipliers; returns the "Corrected" rows and what was removed. */
export function correctRows(rows: TimeRow[], s: QuarterSettings, policy: Policy = POLICY) {
  const counted = new Set(policy.countedWc.map(v => v.toUpperCase()))
  const removed: RemovedRow[] = []
  const byReason: Record<string, number> = {}
  const drop = (r: TimeRow, reason: string) => { removed.push({ ...r, reason }); byReason[reason] = (byReason[reason] ?? 0) + 1 }
  const kept: KeptRow[] = []
  for (const r of rows) {
    const wc = (r.wc ?? '').trim().toUpperCase()
    if (!counted.has(wc)) { drop(r, wc ? `Work code ${wc}` : 'Blank work code'); continue }
    if (policy.dropZeroPlotDays && !(r.plots > 0)) { drop(r, 'No plots recorded'); continue }
    if (policy.dropZeroHourDays && !(r.hours > 0)) { drop(r, 'No hours recorded'); continue }
    if (policy.dropZeroAcreDays && r.acres === 0) { drop(r, 'No acres recorded'); continue }
    if (policy.excludedEmpIdPrefixes.some(p => r.empId.startsWith(p))) { drop(r, 'Western division (not N&S)'); continue }
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
  const { kept, removed: policyRemoved, byReason } = correctRows(review.rows, s, policy)
  const removed = [...review.removed, ...policyRemoved]
  if (review.removed.length) byReason['Removed in review'] = review.removed.length
  const projects = aggregateProjects(kept)

  // --- Does the time report belong to this quarter? ---
  let periodMismatch: QuarterResult['periodMismatch'] = null
  const qlab = opts.quarterLabel ? parseQuarterLabel(opts.quarterLabel) : null
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
        eligible: false, eligibilityReasons: [], removed: false, removalNote: '',
        qualityScale: 0, qualityPerPlot: 0, qualityIncentive: 0, productionScale: 0, productionPerPlot: 0, productionIncentive: 0, totalPerPlot: 0, totalIncentive: 0 }
      byCruiser.set(p.empId, c); sums.set(p.empId, { hx: 0, dx: 0 })
    }
    c.hours += p.hours; c.days += p.days; c.plots += p.plots; c.originalPlots += p.originalPlots; c.acres += p.acres
  }
  // --- Audits: pick this quarter's approved audits; keep prior ones available as fallback ---
  const ql = opts.quarterLabel ? parseQuarterLabel(opts.quarterLabel) : null
  const inQuarter = (a: AuditRow) => !ql || a.year == null || a.qtr == null || (a.year === ql.year && a.qtr === ql.q)
  const before = (a: AuditRow) => !!ql && a.year != null && a.qtr != null && (a.year * 4 + a.qtr) < (ql.year * 4 + ql.q)
  const quarterAudits = audits.filter(inQuarter)
  const auditsByCruiser = new Map<string, AuditRow[]>()
  const priorByCruiser = new Map<string, AuditRow[]>()
  for (const a of audits) {
    if (inQuarter(a)) { const l = auditsByCruiser.get(a.cruiserId) ?? []; l.push(a); auditsByCruiser.set(a.cruiserId, l) }
    else if (before(a) && isApproved(a)) { const l = priorByCruiser.get(a.cruiserId) ?? []; l.push(a); priorByCruiser.set(a.cruiserId, l) }
  }
  for (const c of byCruiser.values()) {
    const list = auditsByCruiser.get(c.empId) ?? []
    const approved = list.filter(isApproved)
    for (const a of list.filter(a => !isApproved(a))) flags.push({ kind: 'audit', severity: 'warn', empId: c.empId, message: `${c.employee}: audit #${a.auditId} (${a.auditDate}) is "${a.status || 'not approved'}"${a.grade == null ? ' with no grade' : ''} and is not counted yet.` })
    // Most recent prior quarter's approved audits
    const prior = (priorByCruiser.get(c.empId) ?? []).sort((x, y) => (y.year! * 4 + y.qtr!) - (x.year! * 4 + x.qtr!))
    const latestKey = prior.length ? prior[0].year! * 4 + prior[0].qtr! : null
    c.priorAudits = latestKey == null ? [] : prior.filter(a => a.year! * 4 + a.qtr! === latestKey)
    if (approved.length) c.audits = approved
    else if (s.priorAudits[c.empId] && c.priorAudits.length) { c.audits = c.priorAudits; c.usedPriorAudits = true }
    const grades = c.audits.map(a => a.grade as number)
    c.qualityGrade = grades.length ? mean(grades) : null
    if (c.usedPriorAudits) flags.push({ kind: 'audit', severity: 'info', empId: c.empId, message: `${c.employee}: no approved audit this quarter; using ${c.audits[0].qtr}Q ${c.audits[0].year} audits (${grades.join(', ')}) — ${s.priorAudits[c.empId].note || 'no reason given'}.` })
  }
  for (const [id, list] of auditsByCruiser) if (!byCruiser.has(id)) flags.push({ kind: 'audit', severity: 'info', empId: id, message: `${list[0].cruiserName} (${id}) has ${list.length} audit(s) this quarter but no counted cruising. Ignored.` })

  // --- Eligibility (policy; removals can only exclude) ---
  for (const c of byCruiser.values()) {
    const reasons: string[] = []
    if (c.hours < policy.minHours) reasons.push(`${c.hours.toFixed(1)} hrs, ${policy.minHours} required`)
    if (c.qualityGrade == null) reasons.push('no approved audit')
    else if (c.qualityGrade < policy.hurdleGrade) reasons.push(`quality ${c.qualityGrade.toFixed(1)}, ${policy.hurdleGrade} required`)
    const rm = s.removals[c.empId]
    if (rm) { c.removed = true; c.removalNote = rm.note; reasons.push(`removed: ${rm.note || 'no reason given'}`) }
    c.eligibilityReasons = reasons
    c.eligible = reasons.length === 0
    if (c.eligible && c.audits.length === 1) flags.push({ kind: 'audit', severity: 'info', empId: c.empId, message: `${c.employee} has only one audit this quarter (grade ${c.audits[0].grade}).` })
    if (c.hours >= policy.minHours && c.qualityGrade == null && !rm)
      flags.push({ kind: 'audit', severity: 'warn', empId: c.empId, message: `${c.employee} has ${c.hours.toFixed(1)} hours and ${c.plots.toFixed(0)} plots but no approved audit this quarter${c.priorAudits.length ? ` — prior audits available (${c.priorAudits[0].qtr}Q ${c.priorAudits[0].year}: ${c.priorAudits.map(a => a.grade).join(', ')})` : ''}.` })
    if (!c.eligible && !rm && c.hours >= policy.minHours - 2 && c.hours < policy.minHours)
      flags.push({ kind: 'eligibility', severity: 'info', empId: c.empId, message: `${c.employee} is just under the hour minimum (${c.hours.toFixed(2)} of ${policy.minHours}). Policy excludes them.` })
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
  const qualityScaleUnit = s.qualityStepPoints / s.qualityStepScale
  const productionScaleUnit = s.productionStepGrade / s.productionStepScale
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
  return { rowsUsed: kept.length, reviewed, rowsAfterReview: review.rows, periodMismatch, removedRows: removed, removedByReason: byReason, projects, projectSummaries, regressionHr: regHr, regressionDay: regDay,
    cruisers, eligibleCount, totalPool, qualityPool, productionPool, qualityRate, productionRate, qualityScaleUnit, productionScaleUnit, flags, quarterAudits }
}
