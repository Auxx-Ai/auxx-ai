// apps/web/src/components/resources/providers/resource-provider.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import type { Actor, ActorId } from '@auxx/types/actor'
import { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { useRecordBatchFetcher } from '../hooks/use-record-batch-fetcher'
import {
  getActorStoreState,
  getRecordStoreState,
  getRelationshipStoreState,
  useActorStore,
  useRelationshipStore,
} from '../store'
import { initComputedFieldSync } from '../store/computed-field-registry'
import { fieldValueFetchQueue } from '../store/field-value-fetch-queue'
import { useFieldValueStore } from '../store/field-value-store'
import { getResourceStoreState } from '../store/resource-store'

/**
 * Component that handles batch fetching of records.
 */
function RecordBatchFetcher() {
  useRecordBatchFetcher()
  return null
}

const BATCH_DELAY = 50
const MAX_RELATIONSHIP_BATCH = 100

/**
 * ResourceProvider - Centralized resource data management
 *
 * Provides:
 * 1. Resources - Unified list of system + custom resources with fields (loaded once upfront)
 * 2. Relationship Items - RecordPickerItem objects (batch fetched on demand)
 * 3. Record Items - Batch fetched on demand
 *
 * All data is stored in Zustand stores for selective subscriptions.
 */
export function ResourceProvider({ children }: { children: React.ReactNode }) {
  // === INITIALIZE COMPUTED FIELD SYNC ===
  // Sets up subscription to auto-register CALC fields from resource store
  useEffect(() => {
    initComputedFieldSync()
  }, [])

  // === PRELOADED: RESOURCES (with fields embedded) ===
  const resourcesQuery = api.resource.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Sync query data to store
  useEffect(() => {
    if (resourcesQuery.data) {
      getResourceStoreState().setResources(resourcesQuery.data)
    }
  }, [resourcesQuery.data])

  // Sync loading state to store
  useEffect(() => {
    getResourceStoreState().setLoading(resourcesQuery.isLoading)
  }, [resourcesQuery.isLoading])

  // === FIELD VALUE FETCH QUEUE INITIALIZATION ===
  const fieldValueBatchGet = api.fieldValue.batchGet.useMutation()
  const fieldValueInitRef = useRef(false)

  useEffect(() => {
    if (fieldValueInitRef.current) return
    fieldValueInitRef.current = true

    fieldValueFetchQueue.setFetchFn(async (params) => {
      return fieldValueBatchGet.mutateAsync(params)
    })
  }, [fieldValueBatchGet])

  // === PRELOADED: ACTORS (users + groups) ===
  const actorsQuery = api.actor.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Sync actors to store
  useEffect(() => {
    if (actorsQuery.data) {
      getActorStoreState().setActors(actorsQuery.data)
      getActorStoreState().setInitialized(true)
    }
  }, [actorsQuery.data])

  useEffect(() => {
    getActorStoreState().setLoading(actorsQuery.isLoading)
  }, [actorsQuery.isLoading])

  // === ACTOR BATCH FETCHER (for lazy loading) ===
  const actorPendingSize = useActorStore((s) => s.pendingIds.size)
  const [actorBatch, setActorBatch] = useState<ActorId[]>([])

  useEffect(() => {
    if (actorPendingSize === 0 || actorBatch.length > 0) return
    const timeout = setTimeout(() => {
      const actorIds = getActorStoreState().startBatch()
      if (actorIds.length > 0) {
        setActorBatch(actorIds)
      }
    }, BATCH_DELAY)
    return () => clearTimeout(timeout)
  }, [actorPendingSize, actorBatch.length])

  const { data: actorData } = api.actor.getByIds.useQuery(
    { ids: actorBatch },
    { enabled: actorBatch.length > 0, staleTime: Infinity, refetchOnWindowFocus: false }
  )

  useEffect(() => {
    if (!actorData || actorBatch.length === 0) return
    const actors = Object.values(actorData) as Actor[]
    getActorStoreState().completeBatch(actors, actorBatch)
    setActorBatch([])
  }, [actorData, actorBatch])

  // === RELATIONSHIP ITEMS BATCHING ===
  const [relationshipBatch, setRelationshipBatch] = useState<RecordId[]>([])
  const relationshipPendingSize = useRelationshipStore((s) => s.pendingIds.size)

  useEffect(() => {
    if (relationshipPendingSize === 0 || relationshipBatch.length > 0) return
    const timeout = setTimeout(() => {
      const state = getRelationshipStoreState()
      const recordIds = state.getItemsToFetch().slice(0, MAX_RELATIONSHIP_BATCH)
      if (recordIds.length === 0) return
      state.markLoading(recordIds)
      setRelationshipBatch(recordIds)
    }, BATCH_DELAY)
    return () => clearTimeout(timeout)
  }, [relationshipPendingSize, relationshipBatch.length])

  const { data: relationshipData, error: relationshipError } = api.record.getByIds.useQuery(
    { items: relationshipBatch },
    { enabled: relationshipBatch.length > 0, staleTime: Infinity, refetchOnWindowFocus: false }
  )

  useEffect(() => {
    if (!relationshipData || relationshipBatch.length === 0) return
    // Pass requested keys so missing items (deleted entities) get marked as not found
    getRelationshipStoreState().addHydratedItems(relationshipData, relationshipBatch)
    setRelationshipBatch([])
  }, [relationshipData, relationshipBatch.length])

  useEffect(() => {
    if (!relationshipError || relationshipBatch.length === 0) return
    console.error('Failed to fetch relationships:', relationshipError)
    getRelationshipStoreState().markError(relationshipBatch)
    setRelationshipBatch([])
  }, [relationshipError, relationshipBatch])

  return (
    <>
      <RecordBatchFetcher />
      {children}
    </>
  )
}

/**
 * Clear all resource-related caches.
 * Call on logout or organization switch.
 */
export function clearResourceCaches() {
  getResourceStoreState().reset()
  getRelationshipStoreState().reset()
  getRecordStoreState().clearAll()
  useFieldValueStore.getState().clearAll()
  getActorStoreState().reset()
}
