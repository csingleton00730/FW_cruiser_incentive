/** One row of the time-system export: one cruiser, one project, one day. */
export interface TimeRow {
  id: string
  employee: string
  empId: string
  center: string
  monthYear: string
  date: string // ISO yyyy-mm-dd
  project: string
  projectDescription: string
  customerId: string
  customerName: string
  hours: number
  acres: number
  /** Plots as recorded in the time system (before any multiplier). */
  plots: number
  noDays: number
  projType: string
  wc: string
}

/** One audit record from CASL. */
export interface AuditRow {
  id: string
  auditDate: string
  year: number | null
  qtr: number | null
  cruiserName: string
  cruiserId: string
  projectId: string
  grade: number | null
  auditId: string
  /** CASL Status (Approved, Created, Ready for Analysis…). Only Approved with a grade counts. */
  status: string
  cruiseType: string
}

/** A correction to one time row. Only the fields present are changed. */
export interface RowEdit {
  hours?: number
  acres?: number
  plots?: number
  note: string
  /** The check(s) that flagged the row when the reviewer acted, kept so the reason stays visible after the fix. */
  why?: string[]
}

/** A row as it stands after review, with what changed. */
export interface ReviewedRow {
  row: TimeRow
  original: Pick<TimeRow, 'hours' | 'acres' | 'plots'>
  edit?: RowEdit
  removed?: { note: string; why?: string[] }
  /** Current check messages; falls back to the reason recorded when the reviewer acted. */
  flags: string[]
}

/** One row of the scale-up factor table in the SP/MP report ("Carbon Calcs" sheet). */
export interface MultiplierRow {
  id: string
  job: string
  plotsPerHour: number | null
  factor: number
}

export interface PoolInputs {
  share: number
  divisor: number
  base: number
  multiplier: number
  overrideTotal?: number | null
}

/** Admin-adjustable settings. Eligibility rules live in policy.ts and are not here. */
export interface QuarterSettings {
  pool: PoolInputs
  qualityShare: number
  qualityStepPoints: number
  qualityStepScale: number
  productionStepGrade: number
  productionStepScale: number
  dayWeight: number
  /** Per-project plot multiplier for this quarter, matched from the SP/MP report table (project id → factor). */
  plotMultipliers: Record<string, number>
  /** Per-cruiser removal with a reason. A removal can only exclude, never include. */
  removals: Record<string, { note: string }>
  /** Data-entry corrections to individual time rows, keyed by row id (deterministic from the row's original values). */
  rowEdits: Record<string, RowEdit>
  /** Time rows removed by the reviewer (bad entry), keyed by row id. */
  rowRemovals: Record<string, { note: string; why?: string[] }>
  /** Cruisers for whom the most recent prior-quarter approved audits are used because none exist this quarter. */
  priorAudits: Record<string, { note: string }>
  mode: 'fixed' | 'legacy'
  legacyCoefficients?: { hr: [number, number]; day: [number, number] }
}

export const DEFAULT_SETTINGS: QuarterSettings = {
  pool: { share: 0.67, divisor: 16, base: 7756.23, multiplier: 2, overrideTotal: null },
  qualityShare: 1 / 3,
  qualityStepPoints: 5,
  qualityStepScale: 0.5,
  productionStepGrade: 0.1,
  productionStepScale: 0.2,
  dayWeight: 2,
  plotMultipliers: {},
  removals: {},
  rowEdits: {},
  rowRemovals: {},
  priorAudits: {},
  mode: 'fixed',
}

export interface CruiserProjectAgg {
  empId: string
  employee: string
  center: string
  project: string
  projectDescription: string
  factor: number
  /** True when the cruiser is eligible — only these rows define the standard (as the workbook's Corrected tab did). */
  inStandard: boolean
  plots: number
  originalPlots: number
  hours: number
  acres: number
  days: number
  acresPerPlot: number
  plotsPerHr: number
  plotsPerDay: number
  expPlotsPerHr: number
  expPlotsPerDay: number
  hrRatio: number
  dayRatio: number
}

export interface ProjectSummary {
  project: string
  description: string
  /** Multiplier this quarter (1 when the project is not in the SP/MP table). */
  factor: number
  /** The table job this project matched, if any. */
  matchedJob: string | null
  cruisers: number
  hours: number
  acres: number
  originalPlots: number
  adjustedPlots: number
}

export interface Regression { slope: number; intercept: number; r2: number; n: number }

export interface CruiserResult {
  empId: string
  employee: string
  center: string
  hours: number
  days: number
  plots: number
  originalPlots: number
  acres: number
  hourGrade: number
  dayGrade: number
  productionGrade: number
  /** Audits counted toward the quality grade (in-quarter approved, or prior-quarter if chosen). */
  audits: AuditRow[]
  /** Most recent prior-quarter approved audits available for fallback. */
  priorAudits: AuditRow[]
  usedPriorAudits: boolean
  qualityGrade: number | null
  eligible: boolean
  eligibilityReasons: string[]
  removed: boolean
  removalNote: string
  qualityScale: number
  qualityPerPlot: number
  qualityIncentive: number
  productionScale: number
  productionPerPlot: number
  productionIncentive: number
  totalPerPlot: number
  totalIncentive: number
}

export interface RemovedRow extends TimeRow { reason: string }

export interface DataFlag {
  kind: 'audit' | 'data' | 'project' | 'eligibility'
  severity: 'warn' | 'info'
  message: string
  empId?: string
  project?: string
  /** Time rows this flag is about (for the data review table). */
  rowIds?: string[]
}

export interface QuarterResult {
  rowsUsed: number
  removedRows: RemovedRow[]
  removedByReason: Record<string, number>
  projects: CruiserProjectAgg[]
  projectSummaries: ProjectSummary[]
  regressionHr: Regression
  regressionDay: Regression
  cruisers: CruiserResult[]
  eligibleCount: number
  totalPool: number
  qualityPool: number
  productionPool: number
  qualityRate: number
  productionRate: number
  qualityScaleUnit: number
  productionScaleUnit: number
  flags: DataFlag[]
  /** Audits in the file that belong to this quarter (approved or not). */
  quarterAudits: AuditRow[]
  /** Rows that were flagged, edited or removed in review — what the Data review table shows. */
  reviewed: ReviewedRow[]
  /** Every row after review edits (for the row finder). */
  rowsAfterReview: TimeRow[]
  /** When the time report's dates don't belong to the labelled quarter. */
  periodMismatch: { quarter: string; reportMonths: string[]; shareOutside: number } | null
}
