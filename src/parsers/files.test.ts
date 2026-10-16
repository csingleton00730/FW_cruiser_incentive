import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { parseCaslExport, parseMultiplierReport, parseTimeExport } from './files'
import { matchMultipliers } from '../engine/calculate'

const R = '/tmp/claude-0/-home-claude/3338104c-431e-536d-bc4e-9324fbb63541/scratchpad/real/'

const asFile = (path: string, name: string) => new File([readFileSync(path)], name)

describe.skipIf(!existsSync(R + 'prod.xls'))('real exports (needs the real files on disk)', () => {
  it('reads the Crystal Report .xls', async () => {
    const r = await parseTimeExport(asFile(R + 'prod.xls', 'Production Report Qtrly Incentive.xls'))
    expect(r.problems).toEqual([])
    expect(r.rows.length).toBe(390)
    expect(r.rows[0]).toMatchObject({ employee: 'Elvis D Cook', empId: '00105', center: '030', project: '0190000002713', wc: 'M3', hours: 4, acres: 28.8, plots: 18 })
    expect(r.rows[0].date).toMatch(/^2026-03-\d\d$/)
    expect(r.rows.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date))).toBe(true)
  })
  it('reads the 9-column Raw Export sheet from the SP/MP workbook', async () => {
    const r = await parseTimeExport(asFile(R + 'spmp.xlsx', 'Copy of SP_MP Sort 2Q 2026.xlsx'))
    expect(r.sheetName).toBe('Raw Export')
    expect(r.problems).toEqual([])
    expect(r.rows.length).toBe(663)
    expect(r.rows.some(x => x.empId === '30007')).toBe(true)
  })
  it('reads the whole CASL database', async () => {
    const r = await parseCaslExport(asFile(R + 'casl.xlsx', 'Copy of CASL.xlsx'))
    expect(r.problems).toEqual([])
    expect(r.rows.length).toBe(4776)
    const q1 = r.rows.filter(a => a.year === 2026 && a.qtr === 1)
    expect(q1.length).toBe(30)
    expect(q1.every(a => a.status === 'Approved' && a.grade != null)).toBe(true)
    expect(r.rows.some(a => a.status === 'Created' && a.grade == null)).toBe(true)
  })
  it("reads Andy's scale-up table and matches it to the time report", async () => {
    const m = await parseMultiplierReport(asFile(R + 'spmp.xlsx', 'Copy of SP_MP Sort 2Q 2026.xlsx'))
    expect(m.problems).toEqual([])
    expect(m.sheetName).toBe('Carbon Calcs')
    expect(m.rows.map(x => [x.job, Math.round(x.factor * 1000) / 1000])).toEqual([
      ['2026 AMC Kathadin Iron Works Carbon Inventory', 5.983],
      ['2026 AMC Maine Finite Carbon - Carbon Inventory', 10.756],
      ['2026 Funga Carbon Seedling Measurements', 3.064],
    ])
    const t = await parseTimeExport(asFile(R + 'spmp.xlsx', 'x.xlsx'))
    const { byProject, unmatchedJobs } = matchMultipliers(t.rows, m.rows)
    expect(unmatchedJobs).toEqual([])
    expect(Object.keys(byProject).sort()).toEqual(['0460000000883', '0460000000887', '0460000000917'])
  })
  it('rejects a file that is not a time report', async () => {
    const r = await parseTimeExport(asFile(R + 'casl.xlsx', 'Copy of CASL.xlsx'))
    expect(r.problems.length).toBeGreaterThan(0)
    expect(r.rows).toEqual([])
  })
})
