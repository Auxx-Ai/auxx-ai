// apps/web/src/components/drawers/use-part-kind-gate.ts
'use client'

import type { RecordId } from '@auxx/types/resource'
import { useCallback } from 'react'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { isHiddenForPartKind } from './part-kind-gates'

const PART_KIND_ATTRIBUTES = ['part_kind'] as const

/** `(surfaceId) => hidden` for a part record's kind-gated tabs; always false off `part`. */
export function usePartKindGate(
  recordId: RecordId | null | undefined,
  entityType: string | null | undefined
): (surfaceId: string) => boolean {
  const enabled = entityType === 'part'
  const { values } = useSystemValues(recordId, PART_KIND_ATTRIBUTES, { autoFetch: true, enabled })
  const partKind = enabled ? values.part_kind : undefined
  return useCallback((surfaceId: string) => isHiddenForPartKind(surfaceId, partKind), [partKind])
}
