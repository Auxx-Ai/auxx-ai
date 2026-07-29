// apps/homepage/src/app/platform/sequences/_mocks/runs.ts

/**
 * Fixture data for the Sequences product mocks. Mirrors the real shapes in
 * `packages/lib/src/sequences/types.ts` — `SequenceRunListItem` (status +
 * exitReason + lastCompletedStep) and `SequenceStats` — so the marketing mock
 * can't drift into showing states the product doesn't have.
 */

export type MockRunStatus = 'active' | 'completed' | 'exited' | 'failed'

/** Matches `EXIT_REASON_LABEL` in `sequence-recipients.tsx`. */
export type MockExitReason = 'Replied' | 'Bounced' | 'Unsubscribed' | 'Removed manually'

export interface MockRun {
  name: string
  email: string
  status: MockRunStatus
  exitReason?: MockExitReason
  /** `lastCompletedStep` — rendered as `Step {n}/{total}`. */
  step: number
  enrolledAt: string
}

/** Badge variants copied from `STATUS_META` in `sequence-recipients.tsx`. */
export const RUN_STATUS_CLASS: Record<MockRunStatus, string> = {
  active: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  completed: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  exited: 'bg-zinc-500/12 text-zinc-600 dark:text-zinc-400',
  failed: 'bg-red-500/12 text-red-600 dark:text-red-400',
}

export const RUN_STATUS_LABEL: Record<MockRunStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  exited: 'Exited',
  failed: 'Failed',
}

export const TOTAL_STEPS = 3

export const MOCK_RUNS: MockRun[] = [
  {
    name: 'Dana Whitfield',
    email: 'dana@northfield.co',
    status: 'active',
    step: 2,
    enrolledAt: '2h ago',
  },
  {
    name: 'Marcus Bell',
    email: 'm.bell@bellworks.com',
    status: 'exited',
    exitReason: 'Replied',
    step: 1,
    enrolledAt: '5h ago',
  },
  {
    name: 'Priya Raman',
    email: 'priya@ramanhvac.com',
    status: 'active',
    step: 1,
    enrolledAt: '6h ago',
  },
  {
    name: 'Owen Castillo',
    email: 'owen.castillo@gmail.com',
    status: 'completed',
    step: 3,
    enrolledAt: 'Yesterday',
  },
  {
    name: 'Lena Fischer',
    email: 'lena@fischerbau.de',
    status: 'exited',
    exitReason: 'Unsubscribed',
    step: 2,
    enrolledAt: 'Yesterday',
  },
  {
    name: 'Tomás Reyes',
    email: 't.reyes@reyesplumbing.net',
    status: 'exited',
    exitReason: 'Bounced',
    step: 1,
    enrolledAt: '2 days ago',
  },
]

/** Mirrors the 7 cards in `sequence-stats-strip.tsx`, in the same order. */
export const MOCK_STATS = [
  { label: 'Enrolled', value: '152', tone: 'text-blue-500' },
  { label: 'Active', value: '128', tone: 'text-indigo-500' },
  { label: 'Completed', value: '18', tone: 'text-emerald-500' },
  { label: 'Exited', value: '6', tone: 'text-muted-foreground' },
  { label: 'Failed', value: '0', tone: 'text-red-500' },
  { label: 'Reply rate', value: '12%', tone: 'text-emerald-500' },
  { label: 'Bounce rate', value: '1%', tone: 'text-amber-500' },
]
