import { useRef, useState, type ReactNode } from 'react'

export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
export const num = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
export const pct = (n: number, d = 0) => (n * 100).toLocaleString('en-US', { maximumFractionDigits: d }) + '%'

export function Stat({ value, label, tone = '' }: { value: ReactNode; label: string; tone?: '' | 'orange' | 'teal' | 'plain' }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  )
}

export function Notice({ kind, title, items, children }: { kind: 'warn' | 'error' | 'ok'; title?: string; items?: string[]; children?: ReactNode }) {
  return (
    <div className={`notice ${kind}`}>
      {title && <strong>{title}</strong>}
      {children}
      {items && items.length > 0 && <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>}
    </div>
  )
}

export function Dropzone({ onFile, label, hint, busy }: { onFile: (f: File) => void; label: string; hint: string; busy?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
    >
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      <div><strong>{busy ? 'Reading…' : label}</strong></div>
      <div className="small">{hint}</div>
    </div>
  )
}

export function NumberField({ label, value, onChange, step = 'any', min, suffix, width }: {
  label: string; value: number | null | undefined; onChange: (v: number | null) => void; step?: string; min?: number; suffix?: string; width?: number
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input
          type="number" step={step} min={min} value={value ?? ''} style={width ? { width } : undefined}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        {suffix && <span className="muted small nowrap">{suffix}</span>}
      </div>
    </label>
  )
}

export function Logo() {
  return (
    <svg className="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 123.1768 135.6038" aria-label="F&W Forestry">
      <path fill="#fff" d="m63.512,113.0566l-2.1857,1.234-2.1857-1.234c-29.877-16.8469-36.769-35.6526-37.9048-57.0923l-.0277-.5118c0,.0138-.0083-24.7128-.0111-34.3702h80.9101c0,2.7488-.0028,34.6303-.0028,34.6303-1.0361,21.4356-8.3958,40.3201-38.5923,57.3441M105.1741,18l-87.1741.0097.0429,37.9864c.7608,22.2905,9.3683,42.481,39.5233,59.4842l2.1843,1.234,1.5757.8895,1.5729-.8895,2.1885-1.234c30.3833-17.1305,39.3504-35.6899,40.0891-59.7678l-.0027-37.7125Z"/>
      <path fill="#fff" d="m26.4691,26.4119v28.8325l-.0042.0055c.137,5.7964,1.5259,15.0526,5.1075,23.2658,4.5043,10.3201,12.8683,19.8253,28.1823,28.8049l.1757-.0055c.3666-9.1317.9476-10.8029-.6668-24.0115-3.4529,2.219-3.9634,2.4638-9.9244,3.3118,2.3061-5.8614-1.4802-4.5001-5.5086-3.3118.9089-3.1098-1.5563-2.8539-1.1026-5.51,6.4355.2878,5.2098,3.969,12.16.0664-6.8879-1.815-6.5116.5907-11.0574-4.4683,4.1156.0775,7.6128-.469,9.9189-2.2162-3.4612-.4427-4.5112-3.9648-6.6292,0-2.2314-3.1762-5.5432-8.126-3.2897-9.9078,5.2887,7.1327,1.2686,1.2506,9.4859,3.8209-1.7583-7.3554-4.8432,1.0279-3.9772-6.0205-.6682.6281-5.712,1.8357-6.0053-.7512,3.6508-.0221,3.0213-1.6808,3.8611-3.8652-2.5621.3403-2.6049,1.4567-3.3644-1.9948,2.9729-.3348,1.9768-4.6343,4.4157-5.5142,1.3945.8218,6.3249,2.2425,9.2549-.2075-2.1775-1.8523-.7512-.783-3.7517-.8853,1.5065-4.46-2.3932-3.4889-2.2092-6.6043,8.7596.0664,5.1697-5.4519,11.0131-7.7193,2.0405,6.7232,4.0326.0567,7.711,4.4033-.8148,1.7569-5.3869-.2462-4.4019,3.316,1.6559-1.7638,4.6385.0263,5.5045,2.194-1.3142.5409-2.4956,1.1731-3.3118,2.1996,3.72.339,7.5381.5547,9.9217,2.2107-3.7739,6.8035-8.7001-3.4889-13.2183,2.2023,4.6911-.1272,5.2306,2.4251,11.009,3.3091,1.0514-.9241,2.9743-2.1428,4.9193,1.4747-.718,1.411-1.1385,3.6563-2.71,7.3388-1.2492-1.2118-4.2678-1.2118-5.5114,0,3.262,1.5037,6.993,2.551,9.9147,4.4047-.92,2.3407-1.4512,1.8427-.7291,6.939-4.9954-.5132-3.6079-1.5107-9.1857-1.4359.9186,2.7668,3.8707,3.4903,5.5114,5.51-1.0279,1.1786-4.0713.3389-3.3118,3.2966,3.3602-.7913,3.2496,1.9132,6.6126,1.1205.9615,4.2608-4.8031,1.7942-3.3007,6.6057-9.1138.3195-7.8701-2.6118-14.7151-2.461.5741,1.6282.3943,13.9099.3943,17.8788-.0235.848-.0332,3.1818-.0401,5.1075,15.2089-8.9768,23.1496-18.5775,27.9886-28.6153,4.5195-9.3724,5.1517-23.3502,5.1517-23.3502v-28.7634H26.4691Z"/>
    </svg>
  )
}
