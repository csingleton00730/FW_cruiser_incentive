/**
 * Incentive policy. These rules are fixed in code on purpose: they cannot be
 * changed from the app. Changing one is a code change, reviewed and deployed.
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

export const POLICY_TEXT = [
  `A cruiser must have at least ${POLICY.minHours} field cruising hours in the quarter. This is not rounded or bent.`,
  `A cruiser's average approved audit grade for the quarter must be ${POLICY.hurdleGrade} or better.`,
  `Only work codes ${POLICY.countedWc.join(', ')} count as cruising. CM, AUD, FC, TF2, M1, M2, M3 and blank codes are removed.`,
  'Days with no plots, no hours or no acres recorded are removed.',
  `Western-division employees (Emp # starting with ${POLICY.excludedEmpIdPrefixes.join(', ')}) are not in the North & South program and are removed.`,
  'Plot multipliers come from the scale-up factor table in the SP/MP report. A project not in that table has a factor of 1.',
  'Single-product and multi-product cruisers are paid from the same pool.',
  'Cruisers can be removed from a quarter with a written reason, but never added back once a rule excludes them.',
]
