import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/q1-2026.json'
import crystalQ1 from './__fixtures__/crystal-q1-2026.json'
import casl from './__fixtures__/casl-2025-2026.json'
import rawQ2 from './__fixtures__/raw-export-q2-2026.json'
import carbonCalcs from './__fixtures__/carbon-calcs-q2-2026.json'
import { allocateCents, assignRowIds, calculateQuarter, correctRows, evaluateException, linearFit, matchMultipliers, parseQuarterLabel } from './calculate'
import { POLICY, proratedMinHours } from './policy'
import { DEFAULT_SETTINGS, type AuditRow, type MultiplierRow, type QuarterSettings, type TimeRow } from './types'

type FixRow = Record<string, string | number | null>
const S = (v: unknown) => (v == null ? '' : String(v))
const N = (v: unknown) => Number(v) || 0

const toRows = (xs: FixRow[], plotsKey = 'plots'): TimeRow[] => xs.map((r, i) => ({
  id: String(i), employee: S(r.employee), empId: S(r.empId), center: S(r.center), monthYear: S(r.monthYear), date: S(r.date),
  project: S(r.project), projectDescription: S(r.projectDescription), customerId: S(r.customerId), customerName: S(r.customerName),
  hours: N(r.hours), acres: N(r.acres), plots: N(r[plotsKey]), noDays: 1, projType: S(r.projType), wc: S(r.wc),
}))
const toAudits = (xs: FixRow[]): AuditRow[] => xs.map((a, i) => ({
  id: String(i), auditDate: S(a.auditDate), year: a.year == null ? null : N(a.year), qtr: a.qtr == null ? null : N(a.qtr),
  cruiserName: S(a.cruiserName), cruiserId: S(a.cruiserId), projectId: S(a.projectId), grade: a.grade == null ? null : N(a.grade),
  auditId: S(a.auditId), status: S(a.status) || 'Approved', cruiseType: S(a.cruiseType),
}))

// The workbook's Corrected tab (plots = original, pre-multiplier) and its CASL tab (2 of Eric Smith's are 4Q 2025)
const corrected = toRows(fixture.corrected as FixRow[], 'originalPlots')
const wbAudits = toAudits(fixture.casl as FixRow[])
const q1Multipliers = fixture.multipliers as Record<string, number>
const base: QuarterSettings = { ...DEFAULT_SETTINGS, plotMultipliers: q1Multipliers, priorAudits: { '00795': { note: 'no 1Q audit; used 4Q 2025' } } }
const byId = (res: ReturnType<typeof calculateQuarter>) => Object.fromEntries(res.cruisers.map(c => [c.empId, c]))
const expected = fixture.expectedSummary as Array<Record<string, string | number>>

describe('1Q 2026 workbook reconciliation', () => {
  it('reproduces the cruiser × project aggregation', () => {
    const res = calculateQuarter(corrected, wbAudits, base, { quarterLabel: '1Q 2026' })
    const calc = fixture.calculations as Array<Record<string, string | number>>
    expect(res.projects.length).toBe(calc.length)
    for (const c of calc) {
      const p = res.projects.find(p => p.empId === c.empId && p.project === c.project)!
      expect(p, `${c.empId}/${c.project}`).toBeDefined()
      expect(p.plots).toBeCloseTo(Number(c.plots), 6)
      expect(p.hours).toBeCloseTo(Number(c.hours), 6)
      expect(p.days).toBe(Number(c.days))
      expect(p.plotsPerHr).toBeCloseTo(Number(c.plotsPerHr), 6)
    }
  })

  it('fits the trendline Excel shows (true sign is negative)', () => {
    const res = calculateQuarter(corrected, wbAudits, base, { quarterLabel: '1Q 2026' })
    expect(res.regressionHr.intercept).toBeCloseTo(4.2042, 4)
    expect(res.regressionHr.slope).toBeCloseTo(-0.0849, 4)
    expect(res.regressionDay.slope).toBeCloseTo(-0.3268, 4)
  })

  it('legacy mode ties out to the Summary tab to the cent', () => {
    const legacy: QuarterSettings = { ...base, mode: 'legacy', legacyCoefficients: fixture.legacyCoefficients as { hr: [number, number]; day: [number, number] } }
    const res = calculateQuarter(corrected, wbAudits, legacy, { quarterLabel: '1Q 2026', legacyMinOver: { quality: ['00868', '00797'], production: ['00844', '00868'] } })
    const got = byId(res)
    expect(res.eligibleCount).toBe(16)
    expect(res.totalPool).toBeCloseTo(10393.3482, 4)
    expect(got['00795'].usedPriorAudits).toBe(true)
    for (const e of expected) {
      const c = got[String(e.empId)]
      expect(c.qualityGrade).toBeCloseTo(Number(e.qualityGrade), 6)
      expect(c.productionGrade).toBeCloseTo(Number(e.productionGrade), 6)
      expect(c.qualityIncentive).toBeCloseTo(Number(e.qualityIncentive), 4)
      expect(c.productionIncentive).toBeCloseTo(Number(e.productionIncentive), 4)
      expect(c.totalIncentive).toBeCloseTo(Number(e.totalIncentive), 4)
    }
  })

  it('fixed mode distributes the whole pool with scale factors from 1.0 up to the design multiplier', () => {
    const res = calculateQuarter(corrected, wbAudits, base, { quarterLabel: '1Q 2026' })
    const el = res.cruisers.filter(c => c.eligible)
    expect(el.reduce((s, c) => s + c.totalIncentive, 0)).toBeCloseTo(res.totalPool, 6)
    expect(Math.min(...el.map(c => c.qualityScale))).toBeCloseTo(1, 9)
    expect(Math.max(...el.map(c => c.qualityScale))).toBeCloseTo(2.38, 6)
  })

  it('without the prior-audit choice, Eric Smith is not eligible and the pool shrinks', () => {
    const res = calculateQuarter(corrected, wbAudits, { ...base, priorAudits: {} }, { quarterLabel: '1Q 2026' })
    expect(byId(res)['00795'].eligible).toBe(false)
    expect(byId(res)['00795'].priorAudits.map(a => a.grade)).toEqual([94.2, 95.6])
    expect(res.eligibleCount).toBe(15)
    expect(res.flags.some(f => f.message.includes('prior audits available'))).toBe(true)
  })
})

describe('Crystal Report (1Q 2026) → Corrected', () => {
  const rows = toRows(crystalQ1 as FixRow[])
  it('rebuilds the Corrected tab exactly from the raw report', () => {
    const res = calculateQuarter(rows, [], base)
    expect(rows.length).toBe(390)
    expect(res.removedByReason).toMatchObject({ 'Work code CM': 42, 'Work code M3': 11, 'Work code AUD': 2, 'Work code TF2': 2, 'Blank work code': 3, 'No plots recorded': 21, 'No hours recorded': 4 })
    // rows kept = Corrected rows + rows belonging to under-40-hour cruisers (who are ineligible, not removed)
    const under40 = res.cruisers.filter(c => c.hours < 40)
    const under40Rows = res.projects.filter(p => under40.some(c => c.empId === p.empId)).reduce((s, p) => s + p.days, 0)
    expect(res.rowsUsed - under40Rows).toBe(268)
    expect(under40.length).toBe(9)
    const keptKeys = new Set(corrected.map(r => `${r.empId}|${r.date}|${r.project}`))
    const eligibleIds = new Set(res.cruisers.filter(c => c.hours >= 40).map(c => c.empId))
    const mine = res.projects.filter(p => eligibleIds.has(p.empId))
    expect(mine.reduce((s, p) => s + p.days, 0)).toBe(keptKeys.size)
  })
  it('picks the quarter audits from the full CASL database', () => {
    const res = calculateQuarter(rows, toAudits(casl as FixRow[]), base, { quarterLabel: '1Q 2026' })
    expect(res.quarterAudits.length).toBe(30)
    expect(res.quarterAudits.every(a => a.status === 'Approved')).toBe(true)
    const got = byId(res)
    expect(got['00868'].qualityGrade).toBeCloseTo(98.15, 6) // Hunter Richey
    expect(got['00795'].usedPriorAudits).toBe(true)
    expect(got['00795'].qualityGrade).toBeCloseTo(94.9, 6)
    expect(res.eligibleCount).toBe(16)
  })
})

describe('2Q 2026 Raw Export → WC_Hrs_Miss Data Edited', () => {
  const rows = toRows(rawQ2 as FixRow[])
  const table: MultiplierRow[] = (carbonCalcs as Array<{ job: string; pph: number | null; factor: number }>).map((t, i) => ({ id: String(i), job: t.job, plotsPerHour: t.pph, factor: t.factor }))
  const { byProject } = matchMultipliers(rows, table)
  const s: QuarterSettings = { ...DEFAULT_SETTINGS, plotMultipliers: Object.fromEntries(Object.entries(byProject).map(([p, m]) => [p, m.factor])) }
  it('applies the work-code, zero-day and Western-division rules', () => {
    const { removed, byReason } = correctRows(rows, s)
    expect(rows.length).toBe(663)
    expect(byReason).toMatchObject({ 'Work code CM': 67, 'Work code FC': 20, 'Work code M3': 3, 'No acres recorded': 16 })
    expect(byReason['Western division (not N&S)']).toBe(55)
    expect(removed.filter(r => r.reason.startsWith('Western')).every(r => r.empId.startsWith('3'))).toBe(true)
  })
  it("matches Andy's scale-up table to the projects in the time report", () => {
    expect(byProject['0460000000917'].factor).toBeCloseTo(5.9828, 3) // Katahdin
    expect(byProject['0460000000887'].factor).toBeCloseTo(10.7557, 3) // Maine Finite
    expect(byProject['0460000000883'].factor).toBeCloseTo(3.0636, 3) // Funga
    expect(Object.keys(byProject).length).toBe(3)
    const res = calculateQuarter(rows, [], s, { multiplierTable: table })
    expect(res.flags.some(f => f.kind === 'project' && f.severity === 'warn')).toBe(false)
    expect(res.projectSummaries.filter(p => p.factor !== 1).map(p => p.matchedJob).sort()).toEqual(table.map(t => t.job).sort())
  })
  it('flags a table job that matches nothing', () => {
    const res = calculateQuarter(rows, [], s, { multiplierTable: [...table, { id: 'x', job: 'Some Other Carbon Job', plotsPerHour: 1, factor: 2 }] })
    expect(res.flags.some(f => f.message.includes('Some Other Carbon Job'))).toBe(true)
  })
  it('holds the 40-hour rule and reproduces the edited row set', () => {
    const res = calculateQuarter(rows, [], s)
    const byName = Object.fromEntries(res.cruisers.map(c => [c.employee, c]))
    expect(byName['Gerardo Salinas'].hours).toBeCloseTo(39.75, 2)
    expect(byName['Gerardo Salinas'].eligibilityReasons.some(r => r.includes('40 required'))).toBe(true)
    expect(byName['Casey Clark']).toBeUndefined() // Western division, removed at row level
    // Everyone in her edited set with >= 40 hours is present with the same hours
    for (const [name, hrs] of [['Jason Shumaker', 170.75], ['Devon J Stoddard', 124.5], ['Ian Adelman', 60.5], ['Alan Essary', 103.75]] as const)
      expect(byName[name].hours, name).toBeCloseTo(hrs, 1)
  })
})

describe('eligibility exceptions (Cruiser Manual items 8, 11, 13)', () => {
  const rows = toRows(rawQ2 as FixRow[])
  const G = '00814' // Gerardo Salinas, 39.75 hrs in 2Q 2026
  // The CASL fixture is trimmed and has no 2026 audit for him; give him one so only the hours rule fails
  const audits: AuditRow[] = [...toAudits(casl as FixRow[]), { id: 'g1', auditDate: '2026-05-12', year: 2026, qtr: 2, cruiserName: 'Gerardo Salinas', cruiserId: G, projectId: '', grade: 90.5, auditId: 'g1', status: 'Approved', cruiseType: '' }]
  const s: QuarterSettings = { ...DEFAULT_SETTINGS }
  const gerardo = (res: ReturnType<typeof calculateQuarter>) => res.cruisers.find(c => c.empId === G)!
  const label = { quarterLabel: '2Q 2026' }

  it('prorates the hour minimum per item 11', () => {
    expect(proratedMinHours(1)).toBeCloseTo(36.67, 2)
    expect(proratedMinHours(0)).toBe(40)
    expect(proratedMinHours(12)).toBe(0)
  })
  it('is excluded with no exception recorded', () => {
    const res = calculateQuarter(rows, audits, s, label)
    const g = gerardo(res)
    expect(g.hours).toBeCloseTo(39.75, 2)
    expect(g.eligible).toBe(false); expect(g.failedRules).toEqual(['hours']); expect(g.exception).toBeUndefined()
  })
  it('an LOA that brings them within the prorated minimum is within the manual and needs no acknowledgment', () => {
    const before = calculateQuarter(rows, audits, s, label)
    const res = calculateQuarter(rows, audits, { ...s, exceptions: { [G]: { basis: 'loa', loaWeeks: 1, note: 'FMLA week of 5/4', approvedBy: 'Center Manager', acknowledged: false, acknowledgedAt: '2026-10-22T00:00:00Z' } } }, label)
    const g = gerardo(res)
    expect(g.eligible).toBe(true); expect(g.exception?.withinManual).toBe(true)
    expect(g.exception?.summary).toContain('within the manual')
    expect(res.eligibleCount).toBe(before.eligibleCount + 1)
    expect(res.totalPool).toBeGreaterThan(before.totalPool)
    expect(g.totalIncentive).toBeGreaterThan(0)
    // the pool is still fully distributed
    expect(res.cruisers.reduce((t, c) => t + c.totalIncentive, 0)).toBeCloseTo(res.totalPool, 2)
  })
  it('an override needs reason, approver AND the acknowledgment', () => {
    const base = { basis: 'override' as const, note: 'Manager asked to include', approvedBy: 'J. Doe', acknowledged: true, acknowledgedAt: '2026-10-22T00:00:00Z' }
    expect(gerardo(calculateQuarter(rows, audits, { ...s, exceptions: { [G]: { ...base, acknowledged: false } } }, label)).eligible).toBe(false)
    expect(gerardo(calculateQuarter(rows, audits, { ...s, exceptions: { [G]: { ...base, note: '' } } }, label)).eligible).toBe(false)
    expect(gerardo(calculateQuarter(rows, audits, { ...s, exceptions: { [G]: { ...base, approvedBy: ' ' } } }, label)).eligible).toBe(false)
    const res = calculateQuarter(rows, audits, { ...s, exceptions: { [G]: base } }, label)
    const g = gerardo(res)
    expect(g.eligible).toBe(true); expect(g.exception?.withinManual).toBe(false)
    expect(g.exception?.summary).toContain('against the Cruiser Manual'); expect(g.exception?.summary).toContain('Item 8')
    expect(res.flags.some(f => f.kind === 'exception' && f.empId === G && f.message.includes('J. Doe'))).toBe(true)
  })
  it('an LOA that still leaves them short is treated as an override', () => {
    const v = evaluateException(39.75, 85, ['hours'], { basis: 'loa', loaWeeks: 0.01, note: 'x', approvedBy: 'y', acknowledged: false, acknowledgedAt: '' })
    expect(v.ok).toBe(false); expect(v.withinManual).toBe(false)
    const v2 = evaluateException(39.75, 85, ['hours'], { basis: 'loa', loaWeeks: 0.01, note: 'x', approvedBy: 'y', acknowledged: true, acknowledgedAt: '' })
    expect(v2.ok).toBe(true); expect(v2.summary).toContain('still short')
  })
  it('cannot waive "no approved audit" or a removal', () => {
    const noAudit = calculateQuarter(rows, [], { ...s, exceptions: { [G]: { basis: 'override', note: 'x', approvedBy: 'y', acknowledged: true, acknowledgedAt: '' } } }, label)
    expect(gerardo(noAudit).eligible).toBe(false)
    const removed = calculateQuarter(rows, audits, { ...s, removals: { [G]: { note: 'left' } }, exceptions: { [G]: { basis: 'override', note: 'x', approvedBy: 'y', acknowledged: true, acknowledgedAt: '' } } }, label)
    expect(gerardo(removed).eligible).toBe(false)
  })
  it('waives a quality grade below 80 only as an override', () => {
    const v = evaluateException(120, 78.5, ['quality'], { basis: 'override', note: 'x', approvedBy: 'y', acknowledged: true, acknowledgedAt: '' })
    expect(v.ok).toBe(true); expect(v.summary).toContain('Item 13')
    const loa = evaluateException(120, 78.5, ['quality'], { basis: 'loa', loaWeeks: 2, note: 'x', approvedBy: 'y', acknowledged: false, acknowledgedAt: '' })
    expect(loa.ok).toBe(false); expect(loa.withinManual).toBe(false)
  })
})

describe('robustness (review findings 2026-10-22)', () => {
  const rows = toRows(rawQ2 as FixRow[])
  const audits = toAudits(casl as FixRow[])
  const day = (over: Partial<TimeRow>): TimeRow => ({ id: 'x', employee: 'Test Cruiser', empId: '00999', center: '046', monthYear: '', date: '2026-05-05', project: 'P1', projectDescription: 'Test Project Inventory', customerId: '', customerName: '', hours: 8, acres: 40, plots: 10, noDays: 1, projType: '', wc: 'F1', ...over })

  it('an unreadable quarter label counts no audits and says so (fails closed)', () => {
    const good = calculateQuarter(rows, audits, DEFAULT_SETTINGS, { quarterLabel: '2Q 2026' })
    const bad = calculateQuarter(rows, audits, DEFAULT_SETTINGS, { quarterLabel: 'Second Quarter 2026' })
    expect(bad.labelUnparsed).toBe(true); expect(good.labelUnparsed).toBe(false)
    expect(bad.quarterAudits.length).toBe(0)
    expect(bad.eligibleCount).toBe(0)
    expect(bad.flags.some(f => f.message.includes('not a quarter the app can read'))).toBe(true)
  })
  it('removes days dated outside the quarter as policy (manual item 8)', () => {
    const set = assignRowIds([day({ date: '2026-04-01', hours: 20, plots: 30 }), day({ date: '2026-06-30', hours: 20, plots: 30 }), day({ date: '2026-03-31', hours: 30, plots: 40 }), day({ date: '2026-07-01', hours: 30, plots: 40 })].map(({ id: _i, ...r }) => r))
    const res = calculateQuarter(set, [], DEFAULT_SETTINGS, { quarterLabel: '2Q 2026' })
    expect(res.removedByReason['Outside the quarter']).toBe(2)
    expect(res.cruisers[0].hours).toBe(40)
    expect(res.periodMismatch).toBeNull()
    // the real 2Q report has nothing outside the quarter
    expect(calculateQuarter(rows, audits, DEFAULT_SETTINGS, { quarterLabel: '2Q 2026' }).removedByReason['Outside the quarter']).toBeUndefined()
  })
  it('keeps negative hours/plots (correction entries) and flags them instead of dropping them', () => {
    const set = assignRowIds([day({ date: '2026-05-01' }), day({ date: '2026-05-01' }), day({ date: '2026-05-02', hours: -8, plots: -10, acres: -40 })].map(({ id: _i, ...r }) => r))
    const { kept, byReason } = correctRows(set, DEFAULT_SETTINGS)
    expect(kept.length).toBe(3); expect(byReason['No hours recorded']).toBeUndefined()
    const res = calculateQuarter(set, [], DEFAULT_SETTINGS)
    expect(res.flags.filter(f => f.message.includes('negative value')).length).toBe(1)
    expect(res.cruisers[0].hours).toBe(8) // the reversal nets out the duplicate
  })
  it('multiplier matching: exact beats containment, short names never match, ambiguity is flagged', () => {
    const rs = assignRowIds([day({ project: 'A', projectDescription: 'Inventory' }), day({ project: 'B', projectDescription: 'Katahdin Carbon Inventory' }), day({ project: 'C', projectDescription: 'Finite Carbon Maine Phase 2' })].map(({ id: _i, ...r }) => r))
    const table: MultiplierRow[] = [
      { id: '1', job: 'Katahdin Carbon Inventory', plotsPerHour: null, factor: 5 },
      { id: '2', job: 'Katahdin Carbon Inventory 2025', plotsPerHour: null, factor: 7 }, // contains B's name but B has an exact match
      { id: '3', job: 'Finite Carbon Maine', plotsPerHour: null, factor: 10 },
      { id: '4', job: 'Carbon Maine Phase 2 Finite', plotsPerHour: null, factor: 11 }, // does not contain or fit C
    ]
    const m = matchMultipliers(rs, table)
    expect(m.byProject['A']).toBeUndefined() // "Inventory" is too short to match anything by containment
    expect(m.byProject['B']).toEqual({ factor: 5, job: 'Katahdin Carbon Inventory' })
    expect(m.byProject['C'].factor).toBe(10)
    expect(m.ambiguous['B']).toBeUndefined()
    expect(m.unmatchedJobs.map(t => t.id).sort()).toEqual(['2', '4'])
    const m2 = matchMultipliers(rs, [...table, { id: '5', job: 'Finite Carbon Maine Phase 2 Extra Words', plotsPerHour: null, factor: 12 }])
    expect(m2.ambiguous['C']?.length).toBe(2)
    const res = calculateQuarter(rs, [], DEFAULT_SETTINGS, { multiplierTable: [...table, { id: '5', job: 'Finite Carbon Maine Phase 2 Extra Words', plotsPerHour: null, factor: 12 }] })
    expect(res.flags.some(f => f.message.includes('more than one table job'))).toBe(true)
    // unchanged on the real table
    const real = matchMultipliers(rows, (carbonCalcs as Array<{ job: string; pph: number | null; factor: number }>).map((t, i) => ({ id: String(i), job: t.job, plotsPerHour: t.pph, factor: t.factor })))
    expect(Object.keys(real.byProject).length).toBe(3); expect(Object.keys(real.ambiguous).length).toBe(0)
  })
  it('audits: blank year/quarter falls back to the date, no date is flagged, duplicates count once, blank status is not approved', () => {
    const set = assignRowIds([day({ date: '2026-05-01', hours: 50 })].map(({ id: _i, ...r }) => r))
    const a = (over: Partial<AuditRow>): AuditRow => ({ id: Math.random().toString(), auditDate: '2026-05-10', year: null, qtr: null, cruiserName: 'Test Cruiser', cruiserId: '00999', projectId: '', grade: 90, auditId: 'a1', status: 'Approved', cruiseType: '', ...over })
    const r1 = calculateQuarter(set, [a({})], DEFAULT_SETTINGS, { quarterLabel: '2Q 2026' })
    expect(r1.cruisers[0].qualityGrade).toBe(90) // date says 2Q
    const r2 = calculateQuarter(set, [a({ auditDate: '2026-02-10' })], DEFAULT_SETTINGS, { quarterLabel: '2Q 2026' })
    expect(r2.cruisers[0].qualityGrade).toBeNull(); expect(r2.cruisers[0].priorAudits.length).toBe(1) // date says 1Q → prior
    const r3 = calculateQuarter(set, [a({ auditDate: '' })], DEFAULT_SETTINGS, { quarterLabel: '2Q 2026' })
    expect(r3.cruisers[0].qualityGrade).toBeNull(); expect(r3.flags.some(f => f.message.includes('no year/quarter or date'))).toBe(true)
    const r4 = calculateQuarter(set, [a({ year: 2026, qtr: 2, grade: 80 }), a({ year: 2026, qtr: 2, grade: 80 })], DEFAULT_SETTINGS, { quarterLabel: '2Q 2026' })
    expect(r4.cruisers[0].audits.length).toBe(1); expect(r4.flags.some(f => f.message.includes('appears twice'))).toBe(true)
    const r5 = calculateQuarter(set, [a({ year: 2026, qtr: 2, status: '' })], DEFAULT_SETTINGS, { quarterLabel: '2Q 2026' })
    expect(r5.cruisers[0].qualityGrade).toBeNull()
  })
  it('a zero step setting cannot produce NaN', () => {
    const res = calculateQuarter(rows, audits, { ...DEFAULT_SETTINGS, qualityStepPoints: 0 }, { quarterLabel: '2Q 2026' })
    expect(res.cruisers.every(c => Number.isFinite(c.totalIncentive))).toBe(true)
    expect(res.cruisers.reduce((t, c) => t + c.totalIncentive, 0)).toBeCloseTo(res.totalPool, 6)
  })
  it('paid amounts foot to the pool to the cent', () => {
    const res = calculateQuarter(rows, audits, DEFAULT_SETTINGS, { quarterLabel: '2Q 2026' })
    const paid = res.cruisers.reduce((t, c) => t + c.totalPaid, 0)
    expect(Math.round(paid * 100)).toBe(Math.round(res.totalPool * 100))
    for (const c of res.cruisers) expect(Math.abs(c.totalPaid - c.totalIncentive)).toBeLessThan(0.011)
  })
  it('flags a stale review correction that no longer matches a row', () => {
    const res = calculateQuarter(rows, audits, { ...DEFAULT_SETTINGS, rowEdits: { '00001|2026-04-01|X|F1|1|1|1': { hours: 2, note: 'old' } } }, { quarterLabel: '2Q 2026' })
    expect(res.flags.some(f => f.message.includes('no longer matches'))).toBe(true)
  })
})

describe('data review', () => {
  const rows = toRows(rawQ2 as FixRow[])
  const ided = rows.map(r => ({ ...r })) // toRows gives index ids; re-id deterministically
  const det = assignRowIds(ided.map(({ id: _id, ...rest }) => rest))
  it('flags the negative-acres correction entry with its row id', () => {
    const res = calculateQuarter(det, [], DEFAULT_SETTINGS)
    const neg = res.flags.find(f => f.message.includes('negative value') && f.empId === '00828')!
    expect(neg).toBeDefined()
    expect(neg.rowIds!.length).toBe(1)
    expect(res.reviewed.some(e => e.row.id === neg.rowIds![0])).toBe(true)
  })
  it('a reviewer edit changes the value and is recorded; a reviewer removal drops the row', () => {
    const before = calculateQuarter(det, [], DEFAULT_SETTINGS)
    const neg = before.flags.find(f => f.message.includes('negative value') && f.empId === '00828')!
    const id = neg.rowIds![0]
    const edited = calculateQuarter(det, [], { ...DEFAULT_SETTINGS, rowEdits: { [id]: { acres: 135.34, note: 'sign error' } } })
    const e = edited.reviewed.find(x => x.row.id === id)!
    expect(e.row.acres).toBe(135.34); expect(e.original.acres).toBe(-135.34); expect(e.edit!.note).toBe('sign error')
    expect(edited.flags.some(f => f.message.includes('negative value') && f.empId === '00828')).toBe(false)
    const removed = calculateQuarter(det, [], { ...DEFAULT_SETTINGS, rowRemovals: { [id]: { note: 'entered twice' } } })
    expect(removed.removedByReason['Removed in review']).toBe(1)
    expect(removed.rowsUsed).toBe(before.rowsUsed - 1)
    const sh = removed.cruisers.find(c => c.empId === '00828')!
    expect(sh.hours).toBeCloseTo(170.75 - 5.25, 2)
  })
  it('row ids survive re-import of the same report', () => {
    const again = assignRowIds(ided.map(({ id: _id, ...rest }) => rest))
    expect(again.map(r => r.id)).toEqual(det.map(r => r.id))
    expect(new Set(det.map(r => r.id)).size).toBe(det.length)
  })
})

describe('quarter guard', () => {
  it('flags a time report whose dates are not in the labelled quarter and blocks nothing else', () => {
    const q1rows = toRows(crystalQ1 as FixRow[])
    const res = calculateQuarter(q1rows, [], base, { quarterLabel: '2Q 2026' })
    expect(res.periodMismatch).not.toBeNull()
    expect(res.periodMismatch!.reportMonths[0]).toBe('2026-01')
    expect(res.flags.some(f => f.message.includes('not in 2Q 2026'))).toBe(true)
    const ok = calculateQuarter(q1rows, [], base, { quarterLabel: '1Q 2026' })
    expect(ok.periodMismatch).toBeNull()
  })
  it('puts zero-hour days with plots into the review table', () => {
    const rows = toRows(rawQ2 as FixRow[])
    const det = assignRowIds(rows.map(({ id: _id, ...rest }) => rest))
    const res = calculateQuarter(det, [], DEFAULT_SETTINGS)
    const zh = res.flags.filter(f => f.message.includes('but 0 hours'))
    expect(zh.length).toBeGreaterThan(0)
    expect(res.reviewed.some(e => zh[0].rowIds!.includes(e.row.id))).toBe(true)
    // entering hours restores the day
    const id = zh[0].rowIds![0]
    const fixed = calculateQuarter(det, [], { ...DEFAULT_SETTINGS, rowEdits: { [id]: { hours: 7, note: 'hours from timesheet' } } })
    expect(fixed.rowsUsed).toBe(res.rowsUsed + 1)
  })
})

describe('policy & helpers', () => {
  it('removals can only exclude and shrink the pool', () => {
    const res = calculateQuarter(corrected, wbAudits, { ...base, removals: { '00844': { note: 'left the company 3/15' } } }, { quarterLabel: '1Q 2026' })
    expect(byId(res)['00844'].eligible).toBe(false)
    expect(res.eligibleCount).toBe(15)
    expect(res.totalPool).toBeCloseTo(15 * 0.67 / 16 * 7756.23 * 2, 4)
  })
  it('test-only policy override works', () => {
    const res = calculateQuarter(corrected, wbAudits, base, { quarterLabel: '1Q 2026', policy: { ...POLICY, minHours: 50 } })
    expect(byId(res)['00907'].eligible).toBe(false)
  })
  it('parses quarter labels', () => {
    expect(parseQuarterLabel('1Q 2026')).toEqual({ q: 1, year: 2026 })
    expect(parseQuarterLabel('Q3 2025')).toEqual({ q: 3, year: 2025 })
    expect(parseQuarterLabel('1Q2026')).toEqual({ q: 1, year: 2026 }) // no space must not read the year's "2" as the quarter
    expect(parseQuarterLabel('4Q2025')).toEqual({ q: 4, year: 2025 })
    expect(parseQuarterLabel('2026 Q1')).toEqual({ q: 1, year: 2026 })
    expect(parseQuarterLabel('nope')).toBeNull()
    expect(parseQuarterLabel('First Quarter 2026')).toBeNull()
  })
  it('allocates cents that foot exactly', () => {
    const amounts = [10.005, 10.005, 10.005, 69.985] // exact sum 100.00; naive rounding gives 100.01 or 99.99
    const paid = allocateCents(amounts, 100)
    expect(paid.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
    paid.forEach((p, i) => expect(Math.abs(p - amounts[i])).toBeLessThan(0.01))
    expect(allocateCents([], 0)).toEqual([])
  })
  it('fits a perfect line', () => {
    const f = linearFit([0, 1, 2, 3], [1, 3, 5, 7])
    expect(f.slope).toBeCloseTo(2); expect(f.intercept).toBeCloseTo(1); expect(f.r2).toBeCloseTo(1)
  })
})
