import { useMemo, useState } from 'react'
import type { AuditRow, QuarterResult, QuarterSettings, RowEdit, TimeRow } from '../engine/types'
import { POLICY, POLICY_TEXT } from '../engine/policy'
import { matchMultipliers } from '../engine/calculate'
import { parseCaslExport, parseMultiplierReport, parseTimeExport } from '../parsers/files'
import type { Quarter } from '../storage/repository'
import { newId } from '../storage/repository'
import { downloadWorkbook } from '../export/workbook'
import { Dropzone, Notice, Stat, money, num } from './common'
import { GradeScatter, IncentiveBars, ReasonBars, StandardScatter } from './charts'

export interface StepProps {
  q: Quarter
  res: QuarterResult
  update: (patch: Partial<Quarter>) => void
  updateSettings: (patch: Partial<QuarterSettings>) => void
}

// ---------------------------------------------------------------- 1. Upload
export function UploadStep({ q, res, update, updateSettings }: StepProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Record<string, { problems: string[]; notes: string[] }>>({})
  const set = (k: string, v: { problems: string[]; notes: string[] }) => setMsgs(m => ({ ...m, [k]: v }))

  const onTime = async (f: File) => {
    setBusy('time')
    try {
      const r = await parseTimeExport(f)
      set('time', r)
      if (r.rows.length) {
        const { byProject } = matchMultipliers(r.rows, q.multiplierTable)
        update({ timeRows: r.rows, timeFileName: f.name, settings: { ...q.settings, plotMultipliers: Object.fromEntries(Object.entries(byProject).map(([p, m]) => [p, m.factor])) } })
      }
    } catch (e) { set('time', { problems: [`Could not read file: ${(e as Error).message}`], notes: [] }) }
    finally { setBusy(null) }
  }
  const onAudit = async (f: File) => {
    setBusy('audit')
    try { const r = await parseCaslExport(f); set('audit', r); if (r.rows.length) update({ audits: r.rows, auditFileName: f.name }) }
    catch (e) { set('audit', { problems: [`Could not read file: ${(e as Error).message}`], notes: [] }) }
    finally { setBusy(null) }
  }
  const onMult = async (f: File) => {
    setBusy('mult')
    try {
      const r = await parseMultiplierReport(f)
      set('mult', r)
      if (!r.problems.length) {
        const { byProject } = matchMultipliers(q.timeRows, r.rows)
        update({ multiplierTable: r.rows, multiplierFileName: f.name, settings: { ...q.settings, plotMultipliers: Object.fromEntries(Object.entries(byProject).map(([p, m]) => [p, m.factor])) } })
      }
    } catch (e) { set('mult', { problems: [`Could not read file: ${(e as Error).message}`], notes: [] }) }
    finally { setBusy(null) }
  }
  void updateSettings

  const Box = ({ k, title, what, loaded, fileName, onFile, hint }: { k: string; title: string; what: string; loaded: boolean; fileName: string | null; onFile: (f: File) => void; hint: string }) => (
    <div className="card">
      <div className="row between"><h2>{title}</h2>{loaded && <span className="pill ok">Loaded</span>}</div>
      <p className="muted small">{what}</p>
      <Dropzone onFile={onFile} busy={busy === k} label={fileName ? `Replace ${fileName}` : 'Drop the file here, or click to choose'} hint={hint} />
      {msgs[k]?.problems.length ? <div style={{ marginTop: 10 }}><Notice kind="error" items={msgs[k].problems} /></div> : null}
      {msgs[k]?.notes.length ? <div className="small muted" style={{ marginTop: 8 }}>{msgs[k].notes.join(' ')}</div> : null}
    </div>
  )

  const waiting = res.cruisers.filter(c => c.hours >= POLICY.minHours && !c.audits.length).length
  return (
    <div className="stack">
      <div className="grid cols-3">
        <Box k="time" title="1. Cruising time report" what="The Crystal Report “Production Report Qtrly Incentive” for the quarter (.xls). One row per cruiser, project and day." loaded={q.timeRows.length > 0} fileName={q.timeFileName} onFile={onTime} hint=".xls, .xlsx or .csv" />
        <Box k="audit" title="2. CASL audits" what="The CASL export (whole database is fine — refresh it first). Only this quarter's approved audits are used." loaded={q.audits.length > 0} fileName={q.auditFileName} onFile={onAudit} hint=".xlsx" />
        <Box k="mult" title="3. SP/MP report (Andy)" what="The SP/MP sort workbook. Only the scale-up factor table on the Carbon Calcs sheet is read; projects not in it get a multiplier of 1." loaded={q.multiplierTable.length > 0} fileName={q.multiplierFileName} onFile={onMult} hint=".xlsx" />
      </div>
      {res.periodMismatch && <Notice kind="error" title={`This time report is not ${q.label}.`}>Its dates run {res.periodMismatch.reportMonths[0]} to {res.periodMismatch.reportMonths[res.periodMismatch.reportMonths.length - 1]}. Upload the right quarter's report, or rename the quarter (pencil next to its name at the top).</Notice>}
      {q.timeRows.length > 0 && (
        <div className="grid cols-4">
          <Stat value={q.timeRows.length.toLocaleString()} label="time entries" tone="plain" />
          <Stat value={res.cruisers.length} label="cruisers after policy rules" tone="plain" />
          <Stat value={res.quarterAudits.length} label={`audits for ${q.label}`} tone="plain" />
          <Stat value={waiting} label="cruisers over 40 hrs with no audit yet" tone={waiting ? 'orange' : 'plain'} />
        </div>
      )}
      <div className="card soft">
        <h3>Applied automatically</h3>
        <p className="muted small" style={{ marginTop: 4 }}>These rules run on every quarter and cannot be adjusted here.</p>
        <ul className="policy">{POLICY_TEXT.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 2. Review
export function ReviewStep({ q, res, update, updateSettings }: StepProps) {
  const [showRemoved, setShowRemoved] = useState(false)
  const [manual, setManual] = useState<{ cruiserId: string; grade: string }>({ cruiserId: '', grade: '' })

  const setRemoval = (empId: string, on: boolean, note = '') => {
    const next = { ...q.settings.removals }
    if (!on) delete next[empId]; else next[empId] = { note }
    updateSettings({ removals: next })
  }
  const setPrior = (empId: string, on: boolean, note = '') => {
    const next = { ...q.settings.priorAudits }
    if (!on) delete next[empId]; else next[empId] = { note }
    updateSettings({ priorAudits: next })
  }
  const removeAudit = (id: string) => update({ audits: q.audits.filter(a => a.id !== id) })
  const addManual = () => {
    const c = res.cruisers.find(x => x.empId === manual.cruiserId); const g = Number(manual.grade)
    if (!c || !Number.isFinite(g)) return
    const a: AuditRow = { id: newId(), auditDate: new Date().toISOString().slice(0, 10), year: null, qtr: null, cruiserName: c.employee, cruiserId: c.empId, projectId: '', grade: g, auditId: 'manual', status: 'Approved', cruiseType: '' }
    update({ audits: [...q.audits, a] }); setManual({ cruiserId: '', grade: '' })
  }

  const warn = res.flags.filter(f => f.severity === 'warn')
  const info = res.flags.filter(f => f.severity === 'info')
  const removedCount = res.removedRows.length
  const notEligible = res.cruisers.filter(c => !c.eligible)
  const reasons = useMemo(() => Object.entries(res.removedByReason).sort((a, b) => b[1] - a[1]), [res.removedByReason])

  if (!q.timeRows.length) return <Notice kind="warn">Upload the cruising time report first.</Notice>

  return (
    <div className="stack">
      {res.periodMismatch && <Notice kind="error" title={`This time report is not ${q.label}.`}>Its dates run {res.periodMismatch.reportMonths[0]} to {res.periodMismatch.reportMonths[res.periodMismatch.reportMonths.length - 1]}. Upload the right quarter's report or rename the quarter.</Notice>}
      <div className="grid cols-4">
        <Stat value={res.rowsUsed.toLocaleString()} label="time entries counted" />
        <Stat value={removedCount.toLocaleString()} label="entries removed by policy" tone="plain" />
        <Stat value={res.eligibleCount} label="eligible cruisers" />
        <Stat value={notEligible.length} label="not eligible" tone={notEligible.length ? 'orange' : 'plain'} />
      </div>

      {warn.length > 0 ? (
        <div className="card attention">
          <h2>Needs your attention</h2>
          <ul className="todo">
            {warn.filter(f => !f.rowIds?.length).map((f, i) => <li key={i}><span className="pill warn">Check</span> {f.message}</li>)}
            {warn.some(f => f.rowIds?.length) && <li><span className="pill warn">Data</span> {res.reviewed.filter(e => e.flags.length && !e.edit && !e.removed).length} time entries look like they may be mis-entered — see <a href="#data-review">Data review</a> below to fix or remove them.</li>}
          </ul>
        </div>
      ) : <Notice kind="ok" title="Nothing needs attention.">Every project in the table matched and the data passed its checks. Look over the lists below, then go to Results.</Notice>}

      <DataReview q={q} res={res} updateSettings={updateSettings} />

      {/* Removed rows */}
      <div className="card">
        <div className="row between">
          <h3>Entries removed by policy</h3>
          <button className="ghost small" onClick={() => setShowRemoved(!showRemoved)}>{showRemoved ? 'Hide' : 'Show'} {removedCount} rows</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {reasons.map(([k, v]) => <span key={k} className="pill info">{k}: {v}</span>)}
          {removedCount === 0 && <span className="muted small">None — every entry in the report counted.</span>}
        </div>
        {showRemoved && (
          <div className="scroll" style={{ maxHeight: 320, marginTop: 10 }}>
            <table className="data">
              <thead><tr><th>Reason</th><th>Employee</th><th>Emp #</th><th>Date</th><th>Project</th><th>WC</th><th className="num">Hours</th><th className="num">Acres</th><th className="num">Plots</th></tr></thead>
              <tbody>{res.removedRows.map(r => (
                <tr key={r.id}><td>{r.reason}</td><td>{r.employee}</td><td className="mono">{r.empId}</td><td className="mono">{r.date}</td><td className="small">{r.projectDescription || r.project}</td><td className="mono">{r.wc || '—'}</td><td className="num">{num(r.hours)}</td><td className="num">{num(r.acres, 1)}</td><td className="num">{num(r.plots, 0)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Projects */}
      <div className="card">
        <h3>Projects and plot multipliers</h3>
        <p className="muted small">Multipliers come from the scale-up factor table in Andy's SP/MP report{q.multiplierFileName ? ` (${q.multiplierFileName})` : ''}. A project that isn't in the table has a factor of 1. Adjusted plots = recorded plots × factor; the incentive is paid on adjusted plots.</p>
        {q.multiplierTable.length > 0 && (
          <div className="row" style={{ marginTop: 6 }}>
            {q.multiplierTable.map(t => <span key={t.id} className="pill info" title={t.plotsPerHour != null ? `${t.plotsPerHour} plots/hr` : ''}>{t.job} ×{num(t.factor, 3)}</span>)}
          </div>
        )}
        <div className="scroll" style={{ marginTop: 8 }}>
          <table className="data">
            <thead><tr><th>Project</th><th className="num">Cruisers</th><th className="num">Hours</th><th className="num">Acres/plot</th><th className="num">Recorded plots</th><th className="num">Multiplier</th><th className="num">Adjusted plots</th><th>Source</th></tr></thead>
            <tbody>
              {res.projectSummaries.map(p => (
                <tr key={p.project}>
                  <td>{p.description || p.project}<div className="small muted mono">{p.project}</div></td>
                  <td className="num">{p.cruisers}</td><td className="num">{num(p.hours, 1)}</td>
                  <td className="num">{p.originalPlots ? num(p.acres / p.originalPlots, 2) : '—'}</td>
                  <td className="num">{num(p.originalPlots, 0)}</td>
                  <td className="num" style={{ fontWeight: p.factor !== 1 ? 700 : 400 }}>{num(p.factor, 3)}</td>
                  <td className="num" style={{ fontWeight: p.factor !== 1 ? 700 : 400 }}>{num(p.adjustedPlots, 1)}</td>
                  <td className="small muted">{p.matchedJob ? `Table: ${p.matchedJob}` : 'Not in table'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cruisers */}
      <div className="card">
        <h3>Cruisers and eligibility</h3>
        <p className="muted small">Eligibility follows policy: at least {POLICY.minHours} cruising hours and an average approved audit grade of {POLICY.hurdleGrade} or better for the quarter. A cruiser can be removed with a reason (left the company, data problem); nobody can be added back once a rule excludes them. If a cruiser has the hours but no audit this quarter, you can choose to use their most recent prior audits — that choice is recorded in the workbook.</p>
        <div className="scroll">
          <table className="data">
            <thead><tr><th>Cruiser</th><th>Center</th><th className="num">Hours</th><th className="num">Plots</th><th>Audits</th><th className="num">Quality</th><th>Status</th><th>Remove</th></tr></thead>
            <tbody>
              {res.cruisers.map(c => {
                const rm = q.settings.removals[c.empId]
                const pr = q.settings.priorAudits[c.empId]
                const noQuarterAudit = !c.audits.length || c.usedPriorAudits
                return (
                  <tr key={c.empId} className={c.eligible ? '' : 'dim'}>
                    <td>{c.employee}<div className="small muted mono">{c.empId}</div></td>
                    <td className="mono">{c.center || '—'}</td>
                    <td className="num" style={{ color: c.hours < POLICY.minHours ? 'var(--orange)' : undefined }}>{num(c.hours, 2)}</td>
                    <td className="num">{num(c.plots, 0)}{c.plots !== c.originalPlots && <div className="small muted">{num(c.originalPlots, 0)} recorded</div>}</td>
                    <td>
                      {c.audits.map(a => (
                        <span key={a.id} className={`pill ${c.usedPriorAudits ? 'warn' : 'info'}`} style={{ marginRight: 4 }} title={`${a.auditDate} · ${a.qtr ? `${a.qtr}Q ${a.year}` : ''} · Job ${a.projectId} · #${a.auditId}`}>
                          {a.grade}{a.auditId === 'manual' && <button className="ghost x" onClick={() => removeAudit(a.id)} title="Remove this grade">×</button>}
                        </span>
                      ))}
                      {c.usedPriorAudits && <div className="small muted">from {c.audits[0].qtr}Q {c.audits[0].year}</div>}
                      {!c.audits.length && <span className="muted small">none this quarter</span>}
                      {noQuarterAudit && c.priorAudits.length > 0 && c.hours >= POLICY.minHours && !rm && (
                        <div className="row" style={{ marginTop: 4, gap: 6 }}>
                          <label className="check small"><input type="checkbox" checked={!!pr} onChange={e => setPrior(c.empId, e.target.checked, pr?.note ?? '')} /> use {c.priorAudits[0].qtr}Q {c.priorAudits[0].year} audits ({c.priorAudits.map(a => a.grade).join(', ')})</label>
                          {pr && <input type="text" placeholder="reason" value={pr.note} onChange={e => setPrior(c.empId, true, e.target.value)} style={{ width: 180 }} />}
                        </div>
                      )}
                    </td>
                    <td className="num" style={{ color: c.qualityGrade != null && c.qualityGrade < POLICY.hurdleGrade ? 'var(--orange)' : undefined }}>{c.qualityGrade == null ? '—' : num(c.qualityGrade, 1)}</td>
                    <td>
                      <span className={`pill ${c.eligible ? 'ok' : 'no'}`}>{c.eligible ? 'Eligible' : 'Not eligible'}</span>
                      {!c.eligible && <div className="small muted">{c.eligibilityReasons.join('; ')}</div>}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                        <input type="checkbox" checked={!!rm} onChange={e => setRemoval(c.empId, e.target.checked, rm?.note ?? '')} title="Remove from this quarter" />
                        {rm && <input type="text" placeholder="reason (required)" value={rm.note} onChange={e => setRemoval(c.empId, true, e.target.value)} style={{ width: 170 }} />}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="small muted">Add an audit grade by hand (only if CASL doesn't have it)</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <select value={manual.cruiserId} onChange={e => setManual({ ...manual, cruiserId: e.target.value })} style={{ width: 260 }}>
              <option value="">Choose cruiser…</option>
              {res.cruisers.map(c => <option key={c.empId} value={c.empId}>{c.employee} ({c.empId})</option>)}
            </select>
            <input type="number" className="inline" placeholder="Grade" step="0.1" value={manual.grade} onChange={e => setManual({ ...manual, grade: e.target.value })} />
            <button onClick={addManual} disabled={!manual.cruiserId || manual.grade === ''}>Add</button>
          </div>
        </details>
      </div>

      {info.length > 0 && <Notice kind="warn" title="For your information" items={info.map(f => f.message)} />}
    </div>
  )
}

// ---------------------------------------------------------------- 3. Results
export function ResultsStep({ q, res, update }: StepProps) {
  const [dlMsg, setDlMsg] = useState<string | null>(null)
  const el = res.cruisers.filter(c => c.eligible).sort((a, b) => a.center.localeCompare(b.center) || a.employee.localeCompare(b.employee))
  const sum = (f: (c: typeof el[number]) => number) => el.reduce((s, c) => s + f(c), 0)
  const ready = q.timeRows.length > 0 && q.audits.length > 0 && el.length > 0 && !res.periodMismatch
  const blockers = res.flags.filter(f => f.severity === 'warn')
  const onDownload = async () => {
    setDlMsg('Preparing workbook…')
    const r = await downloadWorkbook(q, res)
    setDlMsg(r === 'saved' ? 'Workbook saved.' : r === 'declined' ? 'Download cancelled.' : 'Downloads are not available in this view.')
    window.setTimeout(() => setDlMsg(null), 4000)
  }
  return (
    <div className="stack">
      {res.periodMismatch && <Notice kind="error" title={`Blocked: the time report is not ${q.label}.`}>Its dates run {res.periodMismatch.reportMonths[0]} to {res.periodMismatch.reportMonths[res.periodMismatch.reportMonths.length - 1]}. Upload the right quarter's report or rename the quarter before downloading.</Notice>}
      {!ready && !res.periodMismatch && <Notice kind="warn">Results need the time report, the CASL audits and at least one eligible cruiser.</Notice>}
      {ready && blockers.length > 0 && q.status !== 'final' && <Notice kind="warn" title={`${blockers.length} item(s) on the Review step still need a look before this is final.`} />}
      <div className="grid cols-4">
        <Stat value={money(res.totalPool)} label={`total pool · ${res.eligibleCount} eligible cruisers`} />
        <Stat value={money(res.qualityPool)} label="quality (⅓)" tone="teal" />
        <Stat value={money(res.productionPool)} label="production (⅔)" tone="orange" />
        <Stat value={num(sum(c => c.plots), 0)} label="adjusted plots paid on" tone="plain" />
      </div>
      <div className="card">
        <div className="row between">
          <div className="row"><h2>Incentive summary — {q.label}</h2><span className={`pill ${q.status === 'final' ? 'ok' : 'warn'}`}>{q.status}</span></div>
          <div className="row">
            {dlMsg && <span className="small muted">{dlMsg}</span>}
            <button className="primary" disabled={!ready} onClick={onDownload}>Download F&amp;W workbook</button>
            <button className={q.status === 'final' ? '' : 'accent'} disabled={!ready} onClick={() => update({ status: q.status === 'final' ? 'draft' : 'final' })}>{q.status === 'final' ? 'Reopen' : 'Mark final'}</button>
          </div>
        </div>
        <div className="scroll" style={{ marginTop: 12 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Center</th><th>Cruiser</th><th className="num">Hours</th><th className="num">Plots</th>
                <th className="num">Quality grade</th><th className="num">Quality $</th>
                <th className="num">Prod. grade</th><th className="num">Production $</th>
                <th className="num">$/plot</th><th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {el.map(c => (
                <tr key={c.empId}>
                  <td className="mono">{c.center || '—'}</td><td>{c.employee}<div className="small muted mono">{c.empId}</div></td>
                  <td className="num">{num(c.hours, 1)}</td><td className="num">{num(c.plots, 0)}</td>
                  <td className="num">{num(c.qualityGrade ?? 0, 1)}</td><td className="num">{money(c.qualityIncentive)}</td>
                  <td className="num">{num(c.productionGrade, 3)}</td><td className="num">{money(c.productionIncentive)}</td>
                  <td className="num">{num(c.totalPerPlot, 3)}</td><td className="num"><strong>{money(c.totalIncentive)}</strong></td>
                </tr>
              ))}
              <tr className="total">
                <td></td><td>Total · {el.length} cruisers</td><td className="num">{num(sum(c => c.hours), 1)}</td><td className="num">{num(sum(c => c.plots), 0)}</td>
                <td></td><td className="num">{money(sum(c => c.qualityIncentive))}</td>
                <td></td><td className="num">{money(sum(c => c.productionIncentive))}</td>
                <td></td><td className="num">{money(sum(c => c.totalIncentive))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>The workbook has this summary plus Cruisers (everyone, with eligibility reasons), Projects, Removed Rows, Audits and Settings tabs, formatted for printing.</p>
      </div>
      {ready && (
        <div className="card">
          <h2>Charts</h2>
          <div className="charts">
            <StandardScatter title="Plots per hour vs standard" points={res.projects} reg={res.regressionHr} y={p => p.plotsPerHr} yLabel="Plots per hour" hourWeighted />
            <StandardScatter title="Plots per day vs standard" points={res.projects} reg={res.regressionDay} y={p => p.plotsPerDay} yLabel="Plots per day" hourWeighted />
            <IncentiveBars cruisers={res.cruisers} />
            <GradeScatter cruisers={res.cruisers} hurdle={POLICY.hurdleGrade} />
            <ReasonBars title="Time entries removed, by reason" data={Object.entries(res.removedByReason)} unit="rows" />
            <ReasonBars title="Cruising hours by cruiser (counted)" data={res.cruisers.map(c => [c.eligible ? c.employee : `${c.employee} (not eligible)`, c.hours] as [string, number])} unit="hrs" />
          </div>
        </div>
      )}
      <div className="card soft">
        <h3>How this quarter was computed</h3>
        <ul className="policy">
          <li>Standard: plots/hr = {num(res.regressionHr.slope, 4)} × acres/plot + {num(res.regressionHr.intercept, 4)}; plots/day = {num(res.regressionDay.slope, 4)} × acres/plot + {num(res.regressionDay.intercept, 3)}; fit on {res.regressionHr.n} cruiser-project combinations.</li>
          <li>Production grade = ({q.settings.dayWeight} × day grade + hour grade) ÷ {q.settings.dayWeight + 1}. Quality grade = average approved audit grade for the quarter.</li>
          <li>Scale factor = 1 + (grade − lowest eligible grade) ÷ {num(res.qualityScaleUnit, 0)} points (quality) or ÷ {num(res.productionScaleUnit, 2)} (production). Incentive = adjusted plots × scale × pool rate; the pool is paid out in full.</li>
          <li>{res.rowsUsed} entries counted, {res.removedRows.length} removed by policy. Multipliers on {Object.keys(q.settings.plotMultipliers).length} project(s). {Object.keys(q.settings.removals).length} cruiser(s) removed by hand; {Object.keys(q.settings.priorAudits).length} using prior-quarter audits.</li>
        </ul>
      </div>
    </div>
  )
}


// ---------------------------------------------------------------- Data review (fix or remove individual time entries)
function DataReview({ q, res, updateSettings }: { q: Quarter; res: QuarterResult; updateSettings: (patch: Partial<QuarterSettings>) => void }) {
  const [find, setFind] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const whyOf = (id: string) => res.reviewed.find(e => e.row.id === id)?.flags ?? []
  const setEdit = (id: string, patch: Partial<RowEdit> | null) => {
    const next = { ...q.settings.rowEdits }
    if (patch === null) delete next[id]
    else {
      const cur = next[id] ?? { note: '', why: whyOf(id) }
      const merged: RowEdit = { ...cur, ...patch }
      for (const k of ['hours', 'acres', 'plots'] as const) if (merged[k] === undefined || Number.isNaN(merged[k])) delete merged[k]
      next[id] = merged
    }
    updateSettings({ rowEdits: next })
  }
  const setRemove = (id: string, on: boolean, note = '') => {
    const next = { ...q.settings.rowRemovals }
    if (!on) delete next[id]; else next[id] = { note, why: next[id]?.why ?? whyOf(id) }
    updateSettings({ rowRemovals: next })
  }
  const byId = useMemo(() => new Map(res.rowsAfterReview.map(r => [r.id, r])), [res.rowsAfterReview])
  const rawById = useMemo(() => new Map(q.timeRows.map(r => [r.id, r])), [q.timeRows])
  const shown = useMemo(() => {
    const ids = new Set(res.reviewed.map(e => e.row.id))
    const extra = picked.filter(id => !ids.has(id)).map(id => rawById.get(id)).filter((r): r is TimeRow => !!r)
      .map(r => ({ row: byId.get(r.id) ?? r, original: { hours: r.hours, acres: r.acres, plots: r.plots }, edit: q.settings.rowEdits[r.id], removed: q.settings.rowRemovals[r.id], flags: [] as string[] }))
    return [...res.reviewed, ...extra]
  }, [res.reviewed, picked, rawById, byId, q.settings.rowEdits, q.settings.rowRemovals])
  const matches = useMemo(() => {
    const t = find.trim().toLowerCase()
    if (t.length < 2) return []
    return q.timeRows.filter(r => `${r.employee} ${r.date} ${r.projectDescription} ${r.project}`.toLowerCase().includes(t)).slice(0, 12)
  }, [find, q.timeRows])
  const edits = Object.keys(q.settings.rowEdits).length, removals = Object.keys(q.settings.rowRemovals).length

  const Cell = ({ e, k }: { e: typeof shown[number]; k: 'hours' | 'acres' | 'plots' }) => {
    const cur = e.row[k], orig = e.original[k]
    const changed = e.edit?.[k] !== undefined
    return (
      <td className="num">
        <input className="inline" style={{ width: 84, fontWeight: changed ? 700 : 400, borderColor: changed ? 'var(--green)' : undefined }} type="number" step="any" value={cur}
          disabled={!!e.removed}
          onChange={ev => { const v = ev.target.value === '' ? NaN : Number(ev.target.value); setEdit(e.row.id, v === orig ? { [k]: undefined } : { [k]: v }) }} />
        {changed && <div className="small muted">was {num(orig, 2)}</div>}
      </td>
    )
  }

  return (
    <div className="card" id="data-review">
      <div className="row between">
        <h3>Data review</h3>
        <span className="small muted">{edits} edited · {removals} removed</span>
      </div>
      <p className="muted small">Entries that failed a check are listed here. If it's a typo, correct the number; if it shouldn't exist, remove it. Every change is recorded with your note in the workbook (Data Corrections tab). Use the search to pull up any other entry.</p>
      <div className="row" style={{ marginTop: 6 }}>
        <input type="text" placeholder="Find an entry: cruiser, date or project…" value={find} onChange={e => setFind(e.target.value)} style={{ width: 340 }} />
        {matches.length > 0 && (
          <div className="finder">
            {matches.map(r => <button key={r.id} className="small ghost" onClick={() => { setPicked(p => [...new Set([...p, r.id])]); setFind('') }}>{r.employee} · {r.date} · {r.projectDescription || r.project} · {r.hours}h {r.acres}ac {r.plots}p</button>)}
          </div>
        )}
      </div>
      {shown.length === 0 ? <p className="small muted" style={{ marginTop: 10 }}>No entries flagged. Nothing to review.</p> : (
        <div className="scroll" style={{ marginTop: 10, maxHeight: 420 }}>
          <table className="data">
            <thead><tr><th>Cruiser</th><th>Date</th><th>Project</th><th>WC</th><th className="num">Hours</th><th className="num">Acres</th><th className="num">Plots</th><th>Why it's here</th><th>Note</th><th>Remove</th><th></th></tr></thead>
            <tbody>
              {shown.map(e => (
                <tr key={e.row.id} className={e.removed ? 'dim' : ''}>
                  <td>{e.row.employee}<div className="small muted mono">{e.row.empId}</div></td>
                  <td className="mono">{e.row.date}</td>
                  <td className="small">{e.row.projectDescription || e.row.project}</td>
                  <td className="mono">{e.row.wc}</td>
                  <Cell e={e} k="hours" /><Cell e={e} k="acres" /><Cell e={e} k="plots" />
                  <td className="small" style={{ maxWidth: 280 }}>
                    {e.flags.map((f, i) => <div key={i}>{f.replace(/^[^:]*: /, '')}</div>)}
                    {!e.flags.length && <span className="muted">{e.removed ? 'removed in review' : e.edit ? 'corrected' : 'added by search'}</span>}
                    {e.edit && <span className="pill ok" style={{ marginTop: 4 }}>edited</span>}
                    {e.removed && <span className="pill no" style={{ marginTop: 4 }}>removed</span>}
                  </td>
                  <td><input type="text" placeholder="reason" value={e.removed?.note ?? e.edit?.note ?? ''} style={{ width: 150 }} onChange={ev => e.removed ? setRemove(e.row.id, true, ev.target.value) : setEdit(e.row.id, { note: ev.target.value })} disabled={!e.edit && !e.removed} /></td>
                  <td><input type="checkbox" checked={!!e.removed} onChange={ev => setRemove(e.row.id, ev.target.checked, e.removed?.note ?? e.edit?.note ?? '')} title="Remove this entry" /></td>
                  <td>{(e.edit || e.removed) && <button className="ghost small" onClick={() => { setEdit(e.row.id, null); setRemove(e.row.id, false) }}>Reset</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
