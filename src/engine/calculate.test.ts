import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/q1-2026.json'
import crystalQ1 from './__fixtures__/crystal-q1-2026.json'
import casl from './__fixtures__/casl-2025-2026.json'
import rawQ2 from './__fixtures__/raw-export-q2-2026.json'
import carbonCalcs from './__fixtures__/carbon-calcs-q2-2026.json'
import { assignRowIds, calculateQuarter, correctRows, linearFit, matchMultipliers, parseQuarterLabel } from './calculate'
import { POLICY } from './policy'
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
    expect(parseQuarterLabel('nope')).toBeNull()
  })
  it('fits a perfect line', () => {
    const f = linearFit([0, 1, 2, 3], [1, 3, 5, 7])
    expect(f.slope).toBeCloseTo(2); expect(f.intercept).toBeCloseTo(1); expect(f.r2).toBeCloseTo(1)
  })
})
