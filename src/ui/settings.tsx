import { useState } from 'react'
import type { QuarterSettings } from '../engine/types'
import { DEFAULT_SETTINGS } from '../engine/types'
import { POLICY_TEXT } from '../engine/policy'
import { NumberField, money, num } from './common'

/**
 * Admin settings. These are the knobs that are allowed to move; policy (hurdles, work codes) is not here.
 * Defaults apply to new quarters; an open quarter keeps its own copy.
 */
export function SettingsView({ defaults, onSaveDefaults }: {
  defaults: QuarterSettings
  onSaveDefaults: (s: QuarterSettings) => void
}) {
  const [s, setS] = useState<QuarterSettings>(defaults)
  const [saved, setSaved] = useState(false)
  const set = (patch: Partial<QuarterSettings>) => { setS({ ...s, ...patch }); setSaved(false) }
  const setPool = (patch: Partial<QuarterSettings['pool']>) => set({ pool: { ...s.pool, ...patch } })
  const example = 16
  const total = s.pool.overrideTotal ?? (example * s.pool.share / s.pool.divisor * s.pool.base * s.pool.multiplier)

  return (
    <div className="stack">
      <div className="card locked">
        <div className="row between"><h2>Policy</h2><span className="pill no">Locked</span></div>
        <p className="muted small">These rules are fixed in the application and apply to every quarter. They cannot be changed from this screen.</p>
        <ul className="policy">{POLICY_TEXT.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </div>

      <div className="card">
        <div className="row between">
          <h2>Defaults for new quarters</h2>
          <div className="row">
            {saved && <span className="small muted">Saved</span>}
            <button className="ghost small" onClick={() => set({ ...DEFAULT_SETTINGS })}>Reset to workbook values</button>
            <button className="primary" onClick={() => { onSaveDefaults(s); setSaved(true) }}>Save defaults</button>
          </div>
        </div>
        <h3 style={{ marginTop: 16 }}>Incentive pool</h3>
        <p className="muted small">Total pool = eligible cruisers × share ÷ divisor × base × multiplier. Enter an override to use a fixed dollar amount instead.</p>
        <div className="grid cols-4" style={{ marginTop: 10 }}>
          <NumberField label="Share" value={s.pool.share} onChange={v => setPool({ share: v ?? 0 })} />
          <NumberField label="Divisor" value={s.pool.divisor} onChange={v => setPool({ divisor: v ?? 1 })} />
          <NumberField label="Base ($)" value={s.pool.base} onChange={v => setPool({ base: v ?? 0 })} />
          <NumberField label="Multiplier" value={s.pool.multiplier} onChange={v => setPool({ multiplier: v ?? 1 })} />
        </div>
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ width: 220 }}><NumberField label="Override total pool ($, optional)" value={s.pool.overrideTotal} onChange={v => setPool({ overrideTotal: v })} /></div>
          <div className="formula">With {example} eligible cruisers: {example} × {s.pool.share} ÷ {s.pool.divisor} × {num(s.pool.base)} × {s.pool.multiplier} = <strong style={{ color: 'var(--green)' }}>{money(total)}</strong></div>
        </div>
        <div className="grid cols-3" style={{ marginTop: 12 }}>
          <NumberField label="Quality share of pool (rest is production)" value={s.qualityShare} onChange={v => set({ qualityShare: v ?? 0 })} step="0.0001" suffix={`${Math.round(s.qualityShare * 100)}% / ${Math.round((1 - s.qualityShare) * 100)}%`} />
        </div>

        <h3 style={{ marginTop: 20 }}>Payout curve</h3>
        <p className="muted small">Each cruiser's scale factor = 1 + (grade − lowest eligible grade) ÷ scale unit, where scale unit = points per step ÷ scale added per step.</p>
        <div className="grid cols-4" style={{ marginTop: 10 }}>
          <NumberField label="Quality: points per step" value={s.qualityStepPoints} onChange={v => set({ qualityStepPoints: v ?? 1 })} />
          <NumberField label="Quality: scale added per step" value={s.qualityStepScale} onChange={v => set({ qualityStepScale: v ?? 0 })} />
          <NumberField label="Production: grade per step" value={s.productionStepGrade} onChange={v => set({ productionStepGrade: v ?? 1 })} />
          <NumberField label="Production: scale added per step" value={s.productionStepScale} onChange={v => set({ productionStepScale: v ?? 0 })} />
        </div>
        <div className="grid cols-3" style={{ marginTop: 12 }}>
          <NumberField label="Day-grade weight (production grade = (w × day + hour) ÷ (w + 1))" value={s.dayWeight} onChange={v => set({ dayWeight: v ?? 2 })} />
        </div>

        <h3 style={{ marginTop: 20 }}>Production standard</h3>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="check"><input type="radio" checked={s.mode === 'fixed'} onChange={() => set({ mode: 'fixed' })} /> Fit from each quarter's data (recommended)</label>
          <label className="check"><input type="radio" checked={s.mode === 'legacy'} onChange={() => set({ mode: 'legacy', legacyCoefficients: s.legacyCoefficients ?? { hr: [-0.0849, 4.2042], day: [-0.3268, 21.592] } })} /> Fixed coefficients</label>
        </div>
        {s.mode === 'legacy' && s.legacyCoefficients && (
          <div className="grid cols-4" style={{ marginTop: 10 }}>
            <NumberField label="Plots/hr slope" value={s.legacyCoefficients.hr[0]} onChange={v => set({ legacyCoefficients: { ...s.legacyCoefficients!, hr: [v ?? 0, s.legacyCoefficients!.hr[1]] } })} />
            <NumberField label="Plots/hr intercept" value={s.legacyCoefficients.hr[1]} onChange={v => set({ legacyCoefficients: { ...s.legacyCoefficients!, hr: [s.legacyCoefficients!.hr[0], v ?? 0] } })} />
            <NumberField label="Plots/day slope" value={s.legacyCoefficients.day[0]} onChange={v => set({ legacyCoefficients: { ...s.legacyCoefficients!, day: [v ?? 0, s.legacyCoefficients!.day[1]] } })} />
            <NumberField label="Plots/day intercept" value={s.legacyCoefficients.day[1]} onChange={v => set({ legacyCoefficients: { ...s.legacyCoefficients!, day: [s.legacyCoefficients!.day[0], v ?? 0] } })} />
          </div>
        )}
      </div>

    </div>
  )
}
