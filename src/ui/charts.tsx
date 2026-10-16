import { useId, useMemo, useState, type ReactNode } from 'react'
import type { CruiserProjectAgg, CruiserResult, Regression } from '../engine/types'
import { money, num } from './common'

/* Chart palette: production = orange, quality = teal (matching the stat tiles); single-series marks = F&W green.
   The two-series chart carries a legend, direct labels and surface gaps so identity never rests on color alone. */
const C = { green: '#48773a', teal: '#115e67', orange: '#d95e16', ink: '#2c2a29', ink2: '#5b5755', ink3: '#8a8583', grid: '#e6e2db', surface: '#ffffff' }
const FONT = 'Arial, Helvetica, sans-serif'

function niceTicks(min: number, max: number, n = 5): number[] {
  if (!(max > min)) return [min]
  const span = max - min, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => span / st <= n) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null)
  const show = (e: React.MouseEvent | React.FocusEvent, body: ReactNode) => {
    const host = (e.currentTarget as Element).closest('.chart') as HTMLElement
    const r = host.getBoundingClientRect()
    const p = 'clientX' in e ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: r.width / 2, y: 20 }
    setTip({ x: p.x, y: p.y, body })
  }
  const hide = () => setTip(null)
  const node = tip ? <div className="tip" style={{ left: Math.min(tip.x + 12, 9999), top: tip.y + 12 }}>{tip.body}</div> : null
  return { show, hide, node }
}

/** Cruiser-project productivity against the standard: acres/plot (x) vs plots/hr or plots/day (y), with the fitted line. */
export function StandardScatter({ title, points, reg, y, yLabel, hourWeighted }: {
  title: string; points: CruiserProjectAgg[]; reg: Regression; y: (p: CruiserProjectAgg) => number; yLabel: string; hourWeighted?: boolean
}) {
  const W = 560, H = 320, m = { l: 48, r: 16, t: 16, b: 40 }
  const pts = points.filter(p => p.hours > 0 && p.plots > 0)
  const xs = pts.map(p => p.acresPerPlot), ys = pts.map(y)
  const xMax = Math.max(1, ...xs) * 1.05, yMax = Math.max(1, ...ys) * 1.1
  const sx = (v: number) => m.l + (v / xMax) * (W - m.l - m.r)
  const sy = (v: number) => H - m.b - (v / yMax) * (H - m.t - m.b)
  const xt = niceTicks(0, xMax), yt = niceTicks(0, yMax)
  const lineX0 = 0, lineX1 = xMax
  const ly0 = reg.slope * lineX0 + reg.intercept, ly1 = reg.slope * lineX1 + reg.intercept
  // clip the line to the plot area
  const clip = (x0: number, y0: number, x1: number, y1: number) => {
    let a = { x: x0, y: y0 }, b = { x: x1, y: y1 }
    const f = (p: { x: number; y: number }, q: { x: number; y: number }, yy: number) => ({ x: p.x + (q.x - p.x) * ((yy - p.y) / (q.y - p.y)), y: yy })
    if (a.y < 0) a = f(a, b, 0); if (b.y < 0) b = f(a, b, 0)
    if (a.y > yMax) a = f(a, b, yMax); if (b.y > yMax) b = f(a, b, yMax)
    return { a, b }
  }
  const { a, b } = clip(lineX0, ly0, lineX1, ly1)
  const rOf = (p: CruiserProjectAgg) => hourWeighted ? Math.max(4, Math.min(12, Math.sqrt(p.hours) * 1.1)) : 5
  const { show, hide, node } = useTooltip()
  const id = useId()
  return (
    <figure className="chart">
      <figcaption><strong>{title}</strong><span className="muted small"> · each dot is one cruiser on one project{hourWeighted ? ', sized by hours' : ''}; the line is the standard (y = {num(reg.slope, 4)}x + {num(reg.intercept, 3)}, R² {num(reg.r2, 3)})</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <title id={id}>{title}</title>
        {yt.map(v => <g key={v}><line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} stroke={C.grid} /><text x={m.l - 6} y={sy(v) + 3} fontSize="10" fill={C.ink3} textAnchor="end" fontFamily={FONT}>{num(v, 0)}</text></g>)}
        {xt.map(v => <text key={v} x={sx(v)} y={H - m.b + 14} fontSize="10" fill={C.ink3} textAnchor="middle" fontFamily={FONT}>{num(v, 0)}</text>)}
        <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke={C.ink3} />
        <text x={(m.l + W - m.r) / 2} y={H - 8} fontSize="11" fill={C.ink2} textAnchor="middle" fontFamily={FONT}>Acres per plot</text>
        <text transform={`translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`} fontSize="11" fill={C.ink2} textAnchor="middle" fontFamily={FONT}>{yLabel}</text>
        {Number.isFinite(a.x) && <line x1={sx(a.x)} y1={sy(a.y)} x2={sx(b.x)} y2={sy(b.y)} stroke={C.ink} strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" />}
        {pts.map(p => (
          <g key={`${p.empId}|${p.project}`} tabIndex={0}
            onMouseMove={e => show(e, <><div><strong>{p.employee}</strong></div><div className="small">{p.projectDescription || p.project}</div><div className="small">{num(p.acresPerPlot, 2)} acres/plot · {num(y(p), 2)} {yLabel.toLowerCase()} · standard {num(reg.slope * p.acresPerPlot + reg.intercept, 2)}</div><div className="small">{num(p.hours, 1)} hrs · {num(p.plots, 0)} plots · {p.days} days · ratio {num(y(p) / (reg.slope * p.acresPerPlot + reg.intercept), 2)}</div></>)}
            onMouseLeave={hide} onFocus={e => show(e, <strong>{p.employee}</strong>)} onBlur={hide}>
            <circle cx={sx(p.acresPerPlot)} cy={sy(y(p))} r={14} fill="transparent" />
            <circle cx={sx(p.acresPerPlot)} cy={sy(y(p))} r={rOf(p) + 2} fill={C.surface} />
            <circle cx={sx(p.acresPerPlot)} cy={sy(y(p))} r={rOf(p)} fill={C.green} fillOpacity={0.85} />
          </g>
        ))}
      </svg>
      {node}
    </figure>
  )
}

/** Stacked horizontal bars: quality + production incentive per eligible cruiser. */
export function IncentiveBars({ cruisers }: { cruisers: CruiserResult[] }) {
  const rows = useMemo(() => [...cruisers].filter(c => c.eligible).sort((a, b) => b.totalIncentive - a.totalIncentive), [cruisers])
  const W = 560, rowH = 26, m = { l: 150, r: 70, t: 8, b: 24 }
  const H = m.t + m.b + rows.length * rowH
  const max = Math.max(1, ...rows.map(c => c.totalIncentive))
  const sx = (v: number) => m.l + (v / max) * (W - m.l - m.r)
  const { show, hide, node } = useTooltip()
  const id = useId()
  const xt = niceTicks(0, max, 4)
  return (
    <figure className="chart">
      <figcaption><strong>Incentive by cruiser</strong><span className="muted small"> · quality and production dollars</span></figcaption>
      <div className="legend"><span><i style={{ background: C.teal }} />Quality</span><span><i style={{ background: C.orange }} />Production</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <title id={id}>Incentive by cruiser</title>
        {xt.map(v => <g key={v}><line x1={sx(v)} x2={sx(v)} y1={m.t} y2={H - m.b} stroke={C.grid} /><text x={sx(v)} y={H - 8} fontSize="10" fill={C.ink3} textAnchor="middle" fontFamily={FONT}>${num(v, 0)}</text></g>)}
        {rows.map((c, i) => {
          const y = m.t + i * rowH + 4, h = 18
          const q = sx(c.qualityIncentive) - m.l, p = sx(c.totalIncentive) - sx(c.qualityIncentive)
          return (
            <g key={c.empId} tabIndex={0} onMouseMove={e => show(e, <><div><strong>{money(c.totalIncentive)}</strong> {c.employee}</div><div className="small">Quality {money(c.qualityIncentive)} (grade {num(c.qualityGrade ?? 0, 1)}) · Production {money(c.productionIncentive)} (grade {num(c.productionGrade, 3)}) · {num(c.plots, 0)} plots</div></>)} onMouseLeave={hide} onFocus={e => show(e, <strong>{c.employee}</strong>)} onBlur={hide}>
              <rect x={0} y={y - 4} width={W} height={rowH} fill="transparent" />
              <text x={m.l - 8} y={y + h / 2 + 4} fontSize="11" fill={C.ink} textAnchor="end" fontFamily={FONT}>{c.employee}</text>
              <rect x={m.l} y={y} width={Math.max(0, q - 1)} height={h} fill={C.teal} />
              <rect x={m.l + q + 1} y={y} width={Math.max(0, p - 1)} height={h} rx={3} fill={C.orange} />
              <text x={sx(c.totalIncentive) + 6} y={y + h / 2 + 4} fontSize="11" fill={C.ink2} fontFamily={FONT} style={{ fontVariantNumeric: 'tabular-nums' }}>{money(c.totalIncentive)}</text>
            </g>
          )
        })}
      </svg>
      {node}
    </figure>
  )
}

/** Quality grade vs production grade per eligible cruiser; bubble area = adjusted plots. */
export function GradeScatter({ cruisers, hurdle }: { cruisers: CruiserResult[]; hurdle: number }) {
  const rows = cruisers.filter(c => c.eligible && c.qualityGrade != null)
  const W = 560, H = 340, m = { l: 48, r: 16, t: 16, b: 40 }
  const xMin = Math.min(0.4, ...rows.map(c => c.productionGrade)) * 0.95, xMax = Math.max(1.2, ...rows.map(c => c.productionGrade)) * 1.05
  const yMin = Math.min(hurdle, ...rows.map(c => c.qualityGrade!)) - 2, yMax = 100
  const sx = (v: number) => m.l + ((v - xMin) / (xMax - xMin)) * (W - m.l - m.r)
  const sy = (v: number) => H - m.b - ((v - yMin) / (yMax - yMin)) * (H - m.t - m.b)
  const maxPlots = Math.max(1, ...rows.map(c => c.plots))
  const r = (c: CruiserResult) => 5 + 13 * Math.sqrt(c.plots / maxPlots)
  const { show, hide, node } = useTooltip()
  const id = useId()
  const xt = niceTicks(xMin, xMax, 5), yt = niceTicks(yMin, yMax, 5)
  return (
    <figure className="chart">
      <figcaption><strong>Quality vs production</strong><span className="muted small"> · one bubble per eligible cruiser, area = adjusted plots; 1.0 production = right on the standard</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <title id={id}>Quality grade against production grade</title>
        {yt.map(v => <g key={v}><line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} stroke={C.grid} /><text x={m.l - 6} y={sy(v) + 3} fontSize="10" fill={C.ink3} textAnchor="end" fontFamily={FONT}>{num(v, 0)}</text></g>)}
        {xt.map(v => <text key={v} x={sx(v)} y={H - m.b + 14} fontSize="10" fill={C.ink3} textAnchor="middle" fontFamily={FONT}>{num(v, 1)}</text>)}
        <line x1={sx(1)} x2={sx(1)} y1={m.t} y2={H - m.b} stroke={C.ink3} strokeDasharray="4 4" />
        <text x={sx(1) + 4} y={m.t + 10} fontSize="10" fill={C.ink3} fontFamily={FONT}>standard</text>
        <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke={C.ink3} />
        <text x={(m.l + W - m.r) / 2} y={H - 8} fontSize="11" fill={C.ink2} textAnchor="middle" fontFamily={FONT}>Production grade</text>
        <text transform={`translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`} fontSize="11" fill={C.ink2} textAnchor="middle" fontFamily={FONT}>Quality grade</text>
        {rows.map(c => (
          <g key={c.empId} tabIndex={0} onMouseMove={e => show(e, <><div><strong>{c.employee}</strong></div><div className="small">quality {num(c.qualityGrade!, 1)} · production {num(c.productionGrade, 3)} · {num(c.plots, 0)} plots · {money(c.totalIncentive)}</div></>)} onMouseLeave={hide} onFocus={e => show(e, <strong>{c.employee}</strong>)} onBlur={hide}>
            <circle cx={sx(c.productionGrade)} cy={sy(c.qualityGrade!)} r={r(c) + 2} fill={C.surface} />
            <circle cx={sx(c.productionGrade)} cy={sy(c.qualityGrade!)} r={r(c)} fill={C.green} fillOpacity={0.55} />
            <text x={sx(c.productionGrade)} y={sy(c.qualityGrade!) - r(c) - 3} fontSize="9.5" fill={C.ink2} textAnchor="middle" fontFamily={FONT}>{c.employee.split(' ').slice(-1)[0]}</text>
          </g>
        ))}
      </svg>
      {node}
    </figure>
  )
}

/** Horizontal bars, single hue. */
export function ReasonBars({ title, data, unit }: { title: string; data: [string, number][]; unit: string }) {
  const rows = [...data].sort((a, b) => b[1] - a[1])
  const W = 560, rowH = 24, m = { l: 190, r: 50, t: 6, b: 6 }
  const H = m.t + m.b + Math.max(1, rows.length) * rowH
  const max = Math.max(1, ...rows.map(r => r[1]))
  const sx = (v: number) => m.l + (v / max) * (W - m.l - m.r)
  const id = useId()
  return (
    <figure className="chart">
      <figcaption><strong>{title}</strong></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <title id={id}>{title}</title>
        {rows.map(([k, v], i) => {
          const y = m.t + i * rowH + 3
          return (
            <g key={k}>
              <text x={m.l - 8} y={y + 13} fontSize="11" fill={C.ink} textAnchor="end" fontFamily={FONT}>{k}</text>
              <rect x={m.l} y={y} width={Math.max(2, sx(v) - m.l)} height={18} rx={3} fill={C.green} />
              <text x={sx(v) + 6} y={y + 13} fontSize="11" fill={C.ink2} fontFamily={FONT}>{num(v, 0)} {unit}</text>
            </g>
          )
        })}
        {rows.length === 0 && <text x={W / 2} y={H / 2} fontSize="11" fill={C.ink3} textAnchor="middle" fontFamily={FONT}>Nothing removed</text>}
      </svg>
    </figure>
  )
}
