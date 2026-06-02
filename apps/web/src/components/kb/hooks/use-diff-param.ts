// apps/web/src/components/kb/hooks/use-diff-param.ts
'use client'

import { useQueryState } from 'nuqs'

/**
 * Shared `?diff=` query state that drives the inline diff view in the editor
 * pane. Values: `review` (draft vs published), `v:<revisionId>` (a version vs
 * published), `kopilot` (Kopilot turn review). `null` = editing normally.
 *
 * Returns `[value, setValue]`; call `setValue(null)` to close the diff.
 */
export function useDiffParam() {
  return useQueryState('diff')
}
