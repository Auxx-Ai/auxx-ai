// apps/web/src/components/agents/procedures/hooks/use-procedure.ts
'use client'

import { useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { api } from '~/trpc/react'
import { normalizeServerProcedure } from '../store/normalize-server-procedure'
import {
  getProcedureStoreState,
  type ProcedureMeta,
  selectProcedure,
  useProcedureStore,
} from '../store/procedure-store'

interface UseProcedureResult {
  /** Effective (optimistic) trigger meta — instant reads, survives refetches. */
  meta: ProcedureMeta | undefined
  /** The heavy draft TipTap doc; the editor seeds it once and owns it thereafter. */
  draftDoc: Record<string, unknown> | null
  isLoading: boolean
  /** True once the initial fetch has resolved — gates one-time doc seeding. */
  isLoaded: boolean
}

/**
 * Shared procedure load: fetch `getById` once (React Query dedupes across the
 * editor + detail bar), hydrate the store, and return the effective meta. Both
 * consumers therefore share one fetch and one optimistic overlay. Mirrors KB's
 * `useArticle` + the query that feeds it.
 */
export function useProcedure(procedureId: string): UseProcedureResult {
  const query = api.procedure.getById.useQuery({ id: procedureId })

  useEffect(() => {
    if (query.data) {
      getProcedureStoreState().setProcedureFromServer(normalizeServerProcedure(query.data))
    }
  }, [query.data])

  const meta = useProcedureStore(useShallow((s) => selectProcedure(s, procedureId)))

  return {
    meta,
    draftDoc: (query.data?.draftDoc ?? null) as Record<string, unknown> | null,
    isLoading: query.isLoading,
    isLoaded: query.isSuccess,
  }
}
