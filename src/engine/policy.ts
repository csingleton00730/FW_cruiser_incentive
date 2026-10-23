/**
 * Incentive policy. The rules themselves are fixed in code and cannot be edited
 * from the app. A reviewer can include an individual cruiser the hours or quality
 * rule excludes, but only as a recorded exception (see Exception in types.ts):
 * a leave-of-absence proration the manual allows, or an acknowledged departure
 * from the manual with the approver's name and reason.
 *
 * Confirmed with Chance Singleton 2026-10-16 against the 1Q 2026 workbook
 * (Crystal Report → Corrected) and the 2Q 2026 SP/MP sort workbook.
 */
export interface Policy {
  /** Minimum field cruising hours in the quarter to be eligible. Not bendable. */
  minHours: number
  /** Minimum average approved audit grade to be eligible. */
  hurdleGrade: number
  /** Work codes that count as field cruising. Everything else is removed. */
  countedWc: string[]
  /** Remove days with no plots recorded. */
  dropZeroPlotDays: boolean
  /** Remove days with no hours recorded. */
  dropZeroHourDays: boolean
  /** Remove days with no acres recorded. */
  dropZeroAcreDays: boolean
  /** Employees whose Emp # starts with one of these are outside the program (Western division = 3xxxx). */
  excludedEmpIdPrefixes: string[]
}

export const POLICY: Readonly<Policy> = Object.freeze({
  minHours: 40,
  hurdleGrade: 80,
  countedWc: Object.freeze(['F1', 'F2', 'F3', 'FS']) as unknown as string[],
  dropZeroPlotDays: true,
  dropZeroHourDays: true,
  dropZeroAcreDays: true,
  excludedEmpIdPrefixes: Object.freeze(['3']) as unknown as string[],
})

/**
 * The eligibility language of the F&W Cruiser Manual (2026, rev. 03/11/26),
 * section "Cruiser Incentive Program and Quarterly Audits — Procedures and
 * Eligibility Requirements". Quoted verbatim in the exception dialog and workbook.
 */
export const MANUAL = {
  title: 'F&W Cruiser Manual (2026) — Cruiser Incentive Program and Quarterly Audits, Procedures and Eligibility Requirements',
  hours: {
    ref: 'Item 8',
    text: 'An employee is eligible for a quarterly cruise incentive distribution if a minimum of 40 timber cruising hours (Task = CRU) are recorded on their timecards within the quarter being audited. All cruising hours must be tasked as CRU and dated between the first and last day of the quarter being audited to be included in the cruise incentive calculations. If an employee does not meet the cruising hours requirement they are not eligible for that quarter’s cruise incentive distribution. It is the cruiser’s responsibility to accurately record his or her cruising hours during the quarter.',
  },
  quality: {
    ref: 'Item 13',
    text: 'If both the plot and hour requirements have been met, and an eligible employee’s audits receive a quality score of 80.0 or above, they will qualify for that quarter’s cruise incentive distributions. A minimum of two passing audits is required for eligibility.',
  },
  loa: {
    ref: 'Item 11',
    text: 'If an employee incurs a Leave of Absence from his/her employment within a portion of a calendar quarter and not to exceed a complete quarter, their cruising hours requirement will be prorated from the required 40 cruising hours based on the length of their leave of absence. For example, a one week leave of absence within a calendar quarter equates to 40 cruising hours less ((1/12)*40), resulting in a 36.67 cruising hour minimum requirement.',
  },
} as const

/** Prorated hour minimum for a leave of absence of `weeks` weeks (Manual item 11: 40 × (1 − weeks/12)). */
export function proratedMinHours(weeks: number, minHours = POLICY.minHours): number {
  const w = Math.min(Math.max(weeks, 0), 12)
  return Math.round(minHours * (1 - w / 12) * 100) / 100
}

export const POLICY_TEXT = [
  `A cruiser must have at least ${POLICY.minHours} field cruising hours in the quarter (Cruiser Manual item 8). The only allowance in the manual is a leave of absence, which prorates the minimum (item 11).`,
  `A cruiser's average approved audit grade for the quarter must be ${POLICY.hurdleGrade} or better (Cruiser Manual item 13).`,
  `Only work codes ${POLICY.countedWc.join(', ')} count as cruising. CM, AUD, FC, TF2, M1, M2, M3 and blank codes are removed.`,
  'Days with no plots, no hours or no acres recorded are removed.',
  `Western-division employees (Emp # starting with ${POLICY.excludedEmpIdPrefixes.join(', ')}) are not in the North & South program and are removed.`,
  'Plot multipliers come from the scale-up factor table in the SP/MP report. A project not in that table has a factor of 1.',
  'Single-product and multi-product cruisers are paid from the same pool.',
  'Cruisers can be removed from a quarter with a written reason. A cruiser the hours or quality rule excludes can be included only as a recorded exception: a leave-of-absence proration (manual item 11), or an acknowledged departure from the Cruiser Manual and company policy with the approver’s name and reason. Every exception is printed in the F&W workbook.',
]
