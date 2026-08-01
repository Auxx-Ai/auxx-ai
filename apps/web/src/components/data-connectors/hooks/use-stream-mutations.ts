// apps/web/src/components/data-connectors/hooks/use-stream-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import type { PaginationSpec } from '../lib/describe-pagination'

/**
 * The request fields the stream config UI edits and persists — a subset of the
 * engine's `StreamRequestConfig`. The canonical client shape the draft store + commit
 * diff hold for a stream's request config.
 *
 * Keys outside this subset (`backfillWindow`, `webhookTrigger`) still round-trip: every
 * writer merges onto the draft's full `requestConfig` through `Record<string, unknown>`.
 */
export type UiRequestConfig = {
  path?: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  params?: Record<string, unknown>
  body?: Record<string, unknown>
  /** Written by `PaginationSection`'s "Use this" apply; `requestConfigSchema` accepts it. */
  pagination?: PaginationSpec
}

/** Per-field merge strategy. Folded into each binding entry (absent ⇒ 'overwrite'). */
export type FieldMergeStrategy =
  | 'overwrite'
  | 'fill_blank'
  | 'connector_owned_only'
  | 'manual_review'
  | 'ignore'

/** The identity role a binding plays (relationship-linking v3 §9.5). */
export type IdentityRole =
  | { kind: 'externalId'; order?: number }
  | { kind: 'match'; normalize?: 'email' | 'phone' | 'domain' | 'none' }

/**
 * One binding entry. Identity is the stable `id`; `targetFieldRef` is a canonical
 * `ResourceFieldId` (`${entityDefinitionId}:${fieldId}`), nullable (`null` = an
 * unassigned draft formula / External-ID-only entry the runtime doesn't write).
 * `identityRole` designates the field as the primary `externalId` anchor or a
 * secondary `match` key.
 */
export type FieldMapping = {
  id: string
  targetFieldRef: string | null
  expression: string
  sourceFields: Record<string, string>
  identityRole?: IdentityRole
  mergeStrategy?: FieldMergeStrategy
  /** Provisioning hint (template/app-seeded; the UI never sets it, but preserves it).
   *  `appFieldKey` (05e) is the stable idempotency key, distinct from the display `name`. */
  provision?: {
    name: string
    type: string
    icon?: string
    isHidden?: boolean
    appFieldKey?: string
  }
}
/** A mapping's bindings — an ordered array of entries (not keyed by target). */
export type FieldMappings = FieldMapping[]

/**
 * Imperative stream READS for the editor. Since the unified saving model
 * (plans/data-connectors/v4) every PERSISTING stream/mapping edit goes through the
 * connector draft store + `commit()` — this hook is now only the live test-fetch,
 * which sends the (uncommitted) draft request config and persists nothing. That's why
 * the old optimistic-immediate mutation surface (and its per-edit `getStatus`
 * invalidation storm) is gone.
 */
export function useStreamMutations(_connectorId: string) {
  const sampleFetchM = api.dataConnector.sampleFetch.useMutation({
    onError: (e) => toastError({ title: 'Test-fetch failed', description: e.message }),
  })

  const sampleFetch = useCallback(
    (input: Parameters<typeof sampleFetchM.mutateAsync>[0]) => sampleFetchM.mutateAsync(input),
    [sampleFetchM]
  )

  return {
    sampleFetch,
    isSampling: sampleFetchM.isPending,
  }
}
