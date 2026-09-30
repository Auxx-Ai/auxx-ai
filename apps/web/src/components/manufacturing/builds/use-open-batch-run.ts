// apps/web/src/components/manufacturing/builds/use-open-batch-run.ts
'use client'

import { openBatchRunSheet } from './build-sheet-store'

/** Open one batch run's builds in the build sheet. */
export function useOpenBatchRun(): (runNumber: number) => void {
  return openBatchRunSheet
}
