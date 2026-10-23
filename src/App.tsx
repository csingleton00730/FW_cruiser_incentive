import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { calculateQuarter, parseQuarterLabel } from './engine/calculate'
import { DEFAULT_SETTINGS, type QuarterSettings } from './engine/types'
import { newId, repository, type Quarter, type QuarterSummary } from './storage/repository'

import { sampleQuarter } from '@sample'

const INCLUDE_SAMPLE = typeof sampleQuarter === 'function'
import { Logo } from './ui/common'
import { SettingsView } from './ui/settings'
import { ResultsStep, ReviewStep, UploadStep, type StepProps } from './ui/steps'

const STEPS: { key: string; label: string; comp: (p: StepProps) => ReactElement; done: (q: Quarter) => boolean }[] = [
  { key: 'upload', label: 'Upload', comp: UploadStep, done: q => q.timeRows.length > 0 && q.audits.length > 0 },
  { key: 'review', label: 'Review', comp: ReviewStep, done: q => q.timeRows.length > 0 && q.audits.length > 0 },
  { key: 'results', label: 'Results', comp: ResultsStep, done: q => q.status === 'final' },
]

const DEFAULTS_KEY = 'cruiser-incentive:defaults'
function loadDefaults(): QuarterSettings {
  try { const raw = localStorage.getItem(DEFAULTS_KEY); if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } } catch { /* ignore */ }
  return DEFAULT_SETTINGS
}
function storeDefaults(s: QuarterSettings) { try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(s)) } catch { /* ignore */ } }

function defaultLabel() {
  const d = new Date(); const q = Math.floor(d.getMonth() / 3) // the quarter being paid is usually the one just ended
  const year = q === 0 ? d.getFullYear() - 1 : d.getFullYear()
  return `${q === 0 ? 4 : q}Q ${year}`
}

type View = { kind: 'home' } | { kind: 'quarter'; q: Quarter } | { kind: 'settings' }

export default function App() {
  const [list, setList] = useState<QuarterSummary[]>([])
  const [defaults, setDefaults] = useState<QuarterSettings>(loadDefaults)
  const [view, setView] = useState<View>({ kind: 'home' })
  const refresh = useCallback(async () => { setList(await repository.list()) }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [view.kind])

  const open = async (id: string) => { const q = await repository.get(id); if (q) setView({ kind: 'quarter', q }) }
  const create = async (label: string) => {
    const now = new Date().toISOString()
    const q: Quarter = { id: newId(), label, createdAt: now, updatedAt: now, settings: { ...defaults, plotMultipliers: {}, removals: {}, priorAudits: {} }, timeRows: [], timeFileName: null, audits: [], auditFileName: null, multiplierTable: [], multiplierFileName: null, status: 'draft' }
    await repository.save(q); await refresh(); setView({ kind: 'quarter', q })
  }
  const loadSample = async () => {
    if (!sampleQuarter) return
    const quarter = sampleQuarter()
    await repository.save(quarter); await refresh(); setView({ kind: 'quarter', q: quarter })
  }
  const remove = async (id: string) => { await repository.remove(id); await refresh() }
  const saveDefaults = (s: QuarterSettings) => { setDefaults(s); storeDefaults(s) }

  return (
    <>
      <header className="topbar">
        <Logo />
        <div>
          <h1>SilvaIncentive</h1>
          <div className="sub">F&amp;W Forestry Services · quarterly cruising incentive</div>
        </div>
        <span className="spacer" />
        {view.kind !== 'home' && <button className="link" onClick={async () => { setView({ kind: 'home' }); await refresh() }}>Quarters</button>}
        {view.kind !== 'settings' && <button className="link" onClick={() => setView({ kind: 'settings' })}>Settings</button>}
      </header>
      <main className="page">
        {view.kind === 'quarter' && <QuarterView key={view.q.id} initial={view.q} />}
        {view.kind === 'settings' && <SettingsView defaults={defaults} onSaveDefaults={saveDefaults} />}
        {view.kind === 'home' && <Home list={list} onOpen={open} onCreate={create} onDelete={remove} onSample={loadSample} />}
      </main>
      <div className="footer-note">Quarters are saved in this browser. Download the F&amp;W workbook for the permanent record.</div>
    </>
  )
}

function Home({ list, onOpen, onCreate, onDelete, onSample }: {
  list: QuarterSummary[]; onOpen: (id: string) => void; onCreate: (label: string) => void; onDelete: (id: string) => void; onSample: () => void
}) {
  const [label, setLabel] = useState(defaultLabel())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  return (
    <div className="stack">
      <div className="card hero">
        <div>
          <h2>Start a quarter</h2>
          <p className="muted">Three steps: upload the Crystal time report, the CASL export and Andy's SP/MP report; review what the rules did; download the F&amp;W workbook. The 40-hour minimum, the 80 audit hurdle, the work-code rules and the Western-division exclusion apply automatically.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)} style={{ width: 150 }} placeholder="e.g. 1Q 2026" aria-label="Quarter label" />
            <button className="primary" disabled={!parseQuarterLabel(label)} title={parseQuarterLabel(label) ? '' : 'Name the quarter like 1Q 2026'} onClick={() => parseQuarterLabel(label) && onCreate(label.trim())}>New quarter</button>
            {!parseQuarterLabel(label) && <span className="small" style={{ color: 'var(--danger)' }}>Name it like "1Q 2026" — the quarter picks the audits and dates.</span>}
            {INCLUDE_SAMPLE && <button onClick={onSample}>Open the 1Q 2026 example</button>}
          </div>
        </div>
        <ol className="how">
          <li><b>Upload</b> the two files</li>
          <li><b>Review</b> what was removed, new projects, eligibility</li>
          <li><b>Results</b> and the F&amp;W workbook</li>
        </ol>
      </div>
      {list.length > 0 && (
        <div>
          <h2 style={{ marginBottom: 10 }}>Saved quarters</h2>
          <div className="quarter-list">
            {list.map(q => (
              <div key={q.id} className="quarter-card" onClick={() => onOpen(q.id)} role="button">
                <div className="row between">
                  <h3>{q.label}</h3>
                  <span className={`pill ${q.status === 'final' ? 'ok' : 'warn'}`}>{q.status}</span>
                </div>
                <div className="small muted">{q.rows.toLocaleString()} time entries · {q.cruisers} cruisers</div>
                <div className="small muted">Updated {new Date(q.updatedAt).toLocaleString()}</div>
                <div className="row" style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
                  {confirmDelete === q.id ? (
                    <>
                      <span className="small">Delete this quarter and its uploaded data?</span>
                      <button className="small danger" onClick={() => { onDelete(q.id); setConfirmDelete(null) }}>Yes, delete</button>
                      <button className="small ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="small" onClick={() => onOpen(q.id)}>Open</button>
                      <button className="small danger ghost" onClick={() => setConfirmDelete(q.id)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function QuarterView({ initial }: { initial: Quarter }) {
  const [q, setQ] = useState<Quarter>(initial)
  const [step, setStep] = useState(initial.timeRows.length && initial.audits.length ? (initial.status === 'final' ? 2 : 1) : 0)
  const saveTimer = useRef<number | null>(null)
  const [saved, setSaved] = useState(true)
  const [renaming, setRenaming] = useState(false)

  const commit = useCallback((next: Quarter) => {
    setQ(next); setSaved(false)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => { await repository.save(next); setSaved(true) }, 400)
  }, [])
  const update = useCallback((patch: Partial<Quarter>) => commit({ ...q, ...patch, updatedAt: new Date().toISOString() }), [q, commit])
  const updateSettings = useCallback((patch: Partial<QuarterSettings>) => update({ settings: { ...q.settings, ...patch } }), [q, update])

  const res = useMemo(() => calculateQuarter(q.timeRows, q.audits, q.settings, { quarterLabel: q.label, multiplierTable: q.multiplierTable }), [q.timeRows, q.audits, q.settings, q.label, q.multiplierTable])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [step]) // each step starts at the top, not where the last one was scrolled
  const Step = STEPS[step].comp
  const canNext = step === 0 ? q.timeRows.length > 0 : true

  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="row">
          {renaming
            ? <input type="text" value={q.label} autoFocus style={{ width: 140, fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700 }} aria-label="Quarter label"
                onChange={e => update({ label: e.target.value })} onBlur={() => setRenaming(false)} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setRenaming(false) }} />
            : <h2>{q.label}</h2>}
          <button className="ghost small" title="Rename quarter" onClick={() => setRenaming(r => !r)}>✎</button>
          {!parseQuarterLabel(q.label) && <span className="pill no">unreadable quarter name</span>}
          <span className={`pill ${q.status === 'final' ? 'ok' : 'warn'}`}>{q.status}</span>
        </div>
        <span className="small muted">{saved ? 'Saved' : 'Saving…'}</span>
      </div>
      <nav className="steps">
        {STEPS.map((s, i) => (
          <button key={s.key} className={`${i === step ? 'active' : ''} ${s.done(q) ? 'done' : ''}`} onClick={() => setStep(i)}>
            <span className="n">{i + 1}</span>{s.label}
          </button>
        ))}
      </nav>
      <Step q={q} res={res} update={update} updateSettings={updateSettings} />
      <div className="row between" style={{ marginTop: 20 }}>
        <button disabled={step === 0} onClick={() => setStep(step - 1)}>← Back</button>
        {step < STEPS.length - 1 && <button className="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next: {STEPS[step + 1].label} →</button>}
      </div>
    </div>
  )
}
