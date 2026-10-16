import ExcelJS from 'exceljs/dist/exceljs.min.js'
import type { QuarterResult, QuarterSettings } from '../engine/types'
import { POLICY_TEXT } from '../engine/policy'
import type { Quarter } from '../storage/repository'
import { LOGO_PNG_BASE64 } from './logo'

// F&W brand (Pantone 364 C green, 1595 C orange, process black)
const GREEN = 'FF48773A', GREEN_LIGHT = 'FFEEF3EA', ORANGE = 'FFD95E16', INK = 'FF2C2A29', INK2 = 'FF5B5755', LINE = 'FFDDD9D2', WHITE = 'FFFFFFFF'
const HEAD_FONT = { name: 'Georgia', bold: true }
const BODY = 'Arial'
const CUR = '"$"#,##0.00', NUM1 = '#,##0.0', NUM2 = '#,##0.00', NUM3 = '0.000', NUM0 = '#,##0'

type Col = { header: string; key: string; width: number; fmt?: string; align?: 'left' | 'right' | 'center' }
type Row = Record<string, string | number | null | undefined>

function brandSheet(wb: ExcelJS.Workbook, name: string, q: Quarter, subtitle: string, cols: Col[], rows: Row[], opts: { total?: Row; notes?: string[]; landscape?: boolean } = {}) {
  const ws = wb.addWorksheet(name, {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: opts.landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: `&L&8&"Arial"F&&W Forestry Services, Inc. · Cruising Incentive · ${q.label}&R&8&"Arial"Page &P of &N` },
  })
  ws.columns = cols.map(c => ({ key: c.key, width: c.width }))
  const lastCol = cols.length

  // Title block (rows 1–3) with logo in A1:A3
  const logoId = wb.addImage({ base64: LOGO_PNG_BASE64, extension: 'png' })
  ws.addImage(logoId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 44, height: 48 } })
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 10, 9)
  ws.mergeCells(1, 2, 1, lastCol); ws.mergeCells(2, 2, 2, lastCol); ws.mergeCells(3, 2, 3, lastCol)
  const t1 = ws.getCell(1, 2); t1.value = 'F&W Forestry Services, Inc.'; t1.font = { ...HEAD_FONT, size: 16, color: { argb: GREEN } }
  const t2 = ws.getCell(2, 2); t2.value = `Cruising Incentive — ${q.label} — ${subtitle}`; t2.font = { ...HEAD_FONT, size: 12, color: { argb: INK } }
  const t3 = ws.getCell(3, 2)
  t3.value = `${q.status === 'final' ? 'FINAL' : 'DRAFT'} · prepared ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
  t3.font = { name: BODY, size: 9, italic: true, color: { argb: q.status === 'final' ? GREEN : ORANGE } }
  ws.getRow(1).height = 20; ws.getRow(2).height = 18; ws.getRow(3).height = 14; ws.getRow(4).height = 6

  // Header row 5
  const hr = ws.getRow(5)
  cols.forEach((c, i) => {
    const cell = hr.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: BODY, bold: true, size: 9, color: { argb: WHITE } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
    cell.alignment = { vertical: 'middle', horizontal: c.align ?? (c.fmt ? 'right' : 'left'), wrapText: true }
    cell.border = { bottom: { style: 'medium', color: { argb: GREEN } } }
  })
  hr.height = 30

  // Data
  rows.forEach((r, ri) => {
    const row = ws.getRow(6 + ri)
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.value = r[c.key] ?? ''
      cell.font = { name: BODY, size: 9, color: { argb: INK } }
      if (c.fmt) cell.numFmt = c.fmt
      cell.alignment = { vertical: 'middle', horizontal: c.align ?? (c.fmt ? 'right' : 'left') }
      if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_LIGHT } }
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } }
    })
  })
  let next = 6 + rows.length
  if (opts.total) {
    const row = ws.getRow(next++)
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.value = opts.total![c.key] ?? ''
      cell.font = { name: BODY, size: 9, bold: true, color: { argb: INK } }
      if (c.fmt) cell.numFmt = c.fmt
      cell.alignment = { horizontal: c.align ?? (c.fmt ? 'right' : 'left') }
      cell.border = { top: { style: 'medium', color: { argb: INK } }, bottom: { style: 'double', color: { argb: INK } } }
    })
  }
  if (opts.notes?.length) {
    next++
    for (const n of opts.notes) {
      ws.mergeCells(next, 1, next, lastCol)
      const cell = ws.getCell(next, 1)
      cell.value = n
      cell.font = { name: BODY, size: 8, italic: true, color: { argb: INK2 } }
      cell.alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(next).height = Math.max(12, Math.ceil(n.length / 140) * 12)
      next++
    }
  }
  ws.autoFilter = rows.length ? { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: lastCol } } : undefined
  return ws
}

const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000

export function buildWorkbook(q: Quarter, res: QuarterResult): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'F&W Cruiser Incentive'
  wb.created = new Date()
  const el = res.cruisers.filter(c => c.eligible).sort((a, b) => a.center.localeCompare(b.center) || a.employee.localeCompare(b.employee))
  const sum = (f: (c: typeof el[number]) => number) => el.reduce((s, c) => s + f(c), 0)
  const s: QuarterSettings = q.settings

  const how = [
    `Production standard: plots/hr = ${r4(res.regressionHr.slope)} × acres/plot + ${r4(res.regressionHr.intercept)} (R² ${r4(res.regressionHr.r2)}); plots/day = ${r4(res.regressionDay.slope)} × acres/plot + ${r4(res.regressionDay.intercept)} (R² ${r4(res.regressionDay.r2)}); fit on ${res.regressionHr.n} cruiser-project combinations${s.mode === 'legacy' ? ' (coefficients entered by hand)' : ''}.`,
    `Production grade = (${s.dayWeight} × day grade + hour grade) ÷ ${s.dayWeight + 1}, each weighted by hours and days on every project. Quality grade = average audit grade.`,
    `Pool = ${res.eligibleCount} eligible × ${s.pool.share} ÷ ${s.pool.divisor} × $${s.pool.base.toLocaleString()} × ${s.pool.multiplier} = $${r2(res.totalPool).toLocaleString()}${s.pool.overrideTotal != null ? ' (overridden)' : ''}; ${Math.round(s.qualityShare * 100)}% quality / ${Math.round((1 - s.qualityShare) * 100)}% production.`,
    `$/plot = (1 + (grade − lowest eligible grade) ÷ ${r2(res.qualityScaleUnit)} points) × $${r4(res.qualityRate)} for quality; (1 + (grade − lowest) ÷ ${r4(res.productionScaleUnit)}) × $${r4(res.productionRate)} for production. Incentive = plots × $/plot.`,
    ...POLICY_TEXT.map(t => `Policy: ${t}`),
  ]

  // --- Summary ---
  brandSheet(wb, 'Summary', q, 'Incentive by Cruiser', [
    { header: 'Center', key: 'center', width: 8, align: 'center' },
    { header: 'Emp #', key: 'empId', width: 8, align: 'center' },
    { header: 'Cruiser', key: 'name', width: 22 },
    { header: 'Cruising Hours', key: 'hours', width: 10, fmt: NUM1 },
    { header: 'Plots Installed', key: 'plots', width: 10, fmt: NUM0 },
    { header: 'Quality Grade', key: 'qg', width: 9, fmt: NUM1 },
    { header: 'Quality $/Plot', key: 'qpp', width: 9, fmt: NUM3 },
    { header: 'Quality Incentive', key: 'qi', width: 12, fmt: CUR },
    { header: 'Production Grade', key: 'pg', width: 10, fmt: NUM3 },
    { header: 'Production $/Plot', key: 'ppp', width: 10, fmt: NUM3 },
    { header: 'Production Incentive', key: 'pi', width: 12, fmt: CUR },
    { header: 'Total $/Plot', key: 'tpp', width: 9, fmt: NUM3 },
    { header: 'Total Incentive', key: 'ti', width: 13, fmt: CUR },
  ], el.map(c => ({
    center: c.center, empId: c.empId, name: c.employee, hours: r2(c.hours), plots: Math.round(c.plots),
    qg: r2(c.qualityGrade ?? 0), qpp: r4(c.qualityPerPlot), qi: r2(c.qualityIncentive),
    pg: r4(c.productionGrade), ppp: r4(c.productionPerPlot), pi: r2(c.productionIncentive),
    tpp: r4(c.totalPerPlot), ti: r2(c.totalIncentive),
  })), {
    total: { name: `Total — ${el.length} cruisers`, hours: r2(sum(c => c.hours)), plots: Math.round(sum(c => c.plots)), qi: r2(sum(c => c.qualityIncentive)), pi: r2(sum(c => c.productionIncentive)), ti: r2(sum(c => c.totalIncentive)) },
    notes: how, landscape: true,
  })

  // --- Cruisers (everyone, with eligibility) ---
  brandSheet(wb, 'Cruisers', q, 'All Cruisers & Eligibility', [
    { header: 'Center', key: 'center', width: 8, align: 'center' },
    { header: 'Emp #', key: 'empId', width: 8, align: 'center' },
    { header: 'Cruiser', key: 'name', width: 22 },
    { header: 'Eligible', key: 'el', width: 8, align: 'center' },
    { header: 'Reason', key: 'reason', width: 34 },
    { header: 'Hours', key: 'hours', width: 8, fmt: NUM1 },
    { header: 'Days', key: 'days', width: 6, fmt: NUM0 },
    { header: 'Plots (recorded)', key: 'op', width: 10, fmt: NUM0 },
    { header: 'Plots (adjusted)', key: 'ap', width: 10, fmt: NUM1 },
    { header: 'Acres', key: 'acres', width: 9, fmt: NUM1 },
    { header: 'Audit Grades', key: 'ag', width: 12 },
    { header: 'Quality Grade', key: 'qg', width: 9, fmt: NUM2 },
    { header: 'Hour Grade', key: 'hg', width: 8, fmt: NUM3 },
    { header: 'Day Grade', key: 'dg', width: 8, fmt: NUM3 },
    { header: 'Production Grade', key: 'pg', width: 10, fmt: NUM3 },
    { header: 'Total Incentive', key: 'ti', width: 12, fmt: CUR },
  ], res.cruisers.map(c => ({
    center: c.center, empId: c.empId, name: c.employee, el: c.eligible ? 'Yes' : 'No', reason: c.eligibilityReasons.join('; '),
    hours: r2(c.hours), days: c.days, op: Math.round(c.originalPlots), ap: r2(c.plots), acres: r2(c.acres),
    ag: c.audits.map(a => a.grade).join(', '), qg: c.qualityGrade == null ? null : r2(c.qualityGrade),
    hg: r4(c.hourGrade), dg: r4(c.dayGrade), pg: r4(c.productionGrade), ti: r2(c.totalIncentive),
  })), { landscape: true })

  // --- Projects ---
  brandSheet(wb, 'Projects', q, 'Production by Cruiser & Project', [
    { header: 'Cruiser', key: 'name', width: 20 },
    { header: 'Emp #', key: 'empId', width: 8, align: 'center' },
    { header: 'Project', key: 'project', width: 15 },
    { header: 'Description', key: 'desc', width: 40 },
    { header: 'Multiplier', key: 'f', width: 8, fmt: '0.000' },
    { header: 'Plots (recorded)', key: 'op', width: 9, fmt: NUM0 },
    { header: 'Plots (adjusted)', key: 'ap', width: 9, fmt: NUM1 },
    { header: 'Hours', key: 'hours', width: 8, fmt: NUM1 },
    { header: 'Acres', key: 'acres', width: 9, fmt: NUM1 },
    { header: 'Days', key: 'days', width: 6, fmt: NUM0 },
    { header: 'Acres/Plot', key: 'app', width: 8, fmt: NUM2 },
    { header: 'Plots/Hr', key: 'pph', width: 8, fmt: NUM2 },
    { header: 'Std Plots/Hr', key: 'eph', width: 8, fmt: NUM2 },
    { header: 'Hr Ratio', key: 'hr', width: 8, fmt: NUM3 },
    { header: 'Plots/Day', key: 'ppd', width: 8, fmt: NUM2 },
    { header: 'Std Plots/Day', key: 'epd', width: 8, fmt: NUM2 },
    { header: 'Day Ratio', key: 'dr', width: 8, fmt: NUM3 },
  ], [...res.projects].sort((a, b) => a.employee.localeCompare(b.employee) || a.project.localeCompare(b.project)).map(p => ({
    name: p.employee, empId: p.empId, project: p.project, desc: p.projectDescription, f: s.plotMultipliers[p.project] ?? 1,
    op: Math.round(p.originalPlots), ap: r2(p.plots), hours: r2(p.hours), acres: r2(p.acres), days: p.days,
    app: r4(p.acresPerPlot), pph: r4(p.plotsPerHr), eph: r4(p.expPlotsPerHr), hr: r4(p.hrRatio), ppd: r4(p.plotsPerDay), epd: r4(p.expPlotsPerDay), dr: r4(p.dayRatio),
  })), { landscape: true })

  // --- Removed rows ---
  brandSheet(wb, 'Removed Rows', q, 'Time Entries Not Counted', [
    { header: 'Reason', key: 'reason', width: 18 },
    { header: 'Cruiser', key: 'name', width: 20 },
    { header: 'Emp #', key: 'empId', width: 8, align: 'center' },
    { header: 'Date', key: 'date', width: 11, align: 'center' },
    { header: 'Project', key: 'project', width: 15 },
    { header: 'Description', key: 'desc', width: 40 },
    { header: 'Proj Type', key: 'pt', width: 8, align: 'center' },
    { header: 'WC', key: 'wc', width: 6, align: 'center' },
    { header: 'Hours', key: 'hours', width: 8, fmt: NUM2 },
    { header: 'Acres', key: 'acres', width: 8, fmt: NUM1 },
    { header: 'Plots', key: 'plots', width: 7, fmt: NUM0 },
  ], res.removedRows.map(r => ({
    reason: r.reason, name: r.employee, empId: r.empId, date: r.date, project: r.project, desc: r.projectDescription,
    pt: r.projType, wc: r.wc, hours: r.hours, acres: r.acres, plots: r.plots,
  })), { landscape: true, notes: Object.entries(res.removedByReason).map(([k, v]) => `${k}: ${v} row(s)`) })

  // --- Data corrections (reviewer edits and removals of individual time entries) ---
  const corrections = res.reviewed.filter(e => e.edit || e.removed)
  brandSheet(wb, 'Data Corrections', q, 'Time Entries Corrected in Review', [
    { header: 'Action', key: 'action', width: 10 },
    { header: 'Cruiser', key: 'name', width: 20 },
    { header: 'Emp #', key: 'empId', width: 8, align: 'center' },
    { header: 'Date', key: 'date', width: 11, align: 'center' },
    { header: 'Project', key: 'desc', width: 40 },
    { header: 'WC', key: 'wc', width: 6, align: 'center' },
    { header: 'Hours (was)', key: 'h0', width: 9, fmt: NUM2 }, { header: 'Hours (now)', key: 'h1', width: 9, fmt: NUM2 },
    { header: 'Acres (was)', key: 'a0', width: 9, fmt: NUM2 }, { header: 'Acres (now)', key: 'a1', width: 9, fmt: NUM2 },
    { header: 'Plots (was)', key: 'p0', width: 9, fmt: NUM0 }, { header: 'Plots (now)', key: 'p1', width: 9, fmt: NUM0 },
    { header: 'Why it was flagged', key: 'why', width: 50 },
    { header: 'Reviewer note', key: 'note', width: 32 },
  ], corrections.map(e => ({
    action: e.removed ? 'Removed' : 'Edited', name: e.row.employee, empId: e.row.empId, date: e.row.date, desc: e.row.projectDescription || e.row.project, wc: e.row.wc,
    h0: e.original.hours, h1: e.removed ? null : e.row.hours, a0: e.original.acres, a1: e.removed ? null : e.row.acres, p0: e.original.plots, p1: e.removed ? null : e.row.plots,
    why: e.flags.join(' | '), note: e.removed?.note ?? e.edit?.note ?? '',
  })), { landscape: true, notes: corrections.length ? [] : ['No time entries were edited or removed in review.'] })

  // --- Audits ---
  brandSheet(wb, 'Audits', q, 'CASL Audit Grades Used', [
    { header: 'Cruiser', key: 'name', width: 22 },
    { header: 'Cruiser #', key: 'id', width: 9, align: 'center' },
    { header: 'Audit Date', key: 'date', width: 11, align: 'center' },
    { header: 'Year', key: 'year', width: 6, align: 'center' },
    { header: 'Qtr', key: 'qtr', width: 5, align: 'center' },
    { header: 'Project', key: 'project', width: 14 },
    { header: 'Grade', key: 'grade', width: 8, fmt: NUM1 },
    { header: 'Audit #', key: 'aid', width: 9, align: 'center' },
    { header: 'Status', key: 'status', width: 10 },
  ], [...res.quarterAudits, ...res.cruisers.filter(c => c.usedPriorAudits).flatMap(c => c.audits)].sort((a, b) => a.cruiserName.localeCompare(b.cruiserName) || a.auditDate.localeCompare(b.auditDate)).map(a => ({
    name: a.cruiserName, id: a.cruiserId, date: a.auditDate, year: a.year, qtr: a.qtr, project: a.projectId, grade: a.grade, aid: a.auditId, status: a.status,
  })))

  // --- Settings ---
  const settings: Row[] = [
    { k: 'Quarter', v: q.label }, { k: 'Status', v: q.status },
    { k: 'Time file', v: q.timeFileName ?? '' }, { k: 'Audit file', v: q.auditFileName ?? '' },
    { k: 'Eligible cruisers', v: res.eligibleCount },
    { k: 'Pool share', v: s.pool.share }, { k: 'Pool divisor', v: s.pool.divisor }, { k: 'Pool base $', v: s.pool.base }, { k: 'Pool multiplier', v: s.pool.multiplier },
    { k: 'Pool override $', v: s.pool.overrideTotal ?? '' },
    { k: 'Total pool $', v: r2(res.totalPool) }, { k: 'Quality pool $', v: r2(res.qualityPool) }, { k: 'Production pool $', v: r2(res.productionPool) },
    { k: 'Quality share', v: s.qualityShare },
    { k: 'Quality scale step', v: `+${s.qualityStepScale} per ${s.qualityStepPoints} points` },
    { k: 'Production scale step', v: `+${s.productionStepScale} per ${s.productionStepGrade} grade` },
    { k: 'Day-grade weight', v: s.dayWeight },
    { k: 'Standard mode', v: s.mode },
    { k: 'Rows counted', v: res.rowsUsed }, { k: 'Rows removed', v: res.removedRows.length },
    { k: 'SP/MP report', v: q.multiplierFileName ?? '(none — all multipliers 1)' },
    ...res.projectSummaries.filter(p => p.factor !== 1).map(p => ({ k: `Plot multiplier — ${p.description || p.project}`, v: `${r4(p.factor)} (table: ${p.matchedJob ?? '—'})` })),
    { k: 'Time entries edited in review', v: res.reviewed.filter(e => e.edit && !e.removed).length },
    { k: 'Time entries removed in review', v: res.reviewed.filter(e => e.removed).length },
    ...Object.entries(s.removals).map(([id, r]) => ({ k: `Removed cruiser — ${id}`, v: r.note })),
    ...res.cruisers.filter(c => c.usedPriorAudits).map(c => ({ k: `Prior-quarter audits — ${c.employee}`, v: `${c.audits[0].qtr}Q ${c.audits[0].year}: ${c.audits.map(a => a.grade).join(', ')} — ${s.priorAudits[c.empId]?.note ?? ''}` })),
  ]
  brandSheet(wb, 'Settings', q, 'Settings & Policy', [
    { header: 'Setting', key: 'k', width: 34 }, { header: 'Value', key: 'v', width: 60 },
  ], settings, { notes: POLICY_TEXT.map(t => `Policy: ${t}`) })

  return wb
}

declare global {
  interface Window { claude?: { use: (name: string) => Promise<unknown> } }
}

export async function workbookBuffer(q: Quarter, res: QuarterResult): Promise<ArrayBuffer> {
  const wb = buildWorkbook(q, res)
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

/** Save the workbook: through the artifact viewer's download capability when hosted there, else a normal browser download. */
export async function downloadWorkbook(q: Quarter, res: QuarterResult): Promise<'saved' | 'declined' | 'unavailable'> {
  const filename = `FW_Cruising_Incentive_${q.label.replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`
  const buf = await workbookBuffer(q, res)
  if (typeof window !== 'undefined' && window.claude?.use) {
    const dl = (await window.claude.use('downloads')) as { save: (r: { filename: string; data: ArrayBuffer }) => Promise<unknown> } | null
    if (!dl) return 'unavailable'
    try { await dl.save({ filename, data: buf }); return 'saved' }
    catch (e) { return (e as { code?: string })?.code === 'declined' ? 'declined' : 'unavailable' }
  }
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'saved'
}
