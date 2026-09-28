// apps/web/src/components/manufacturing/parts/part-kind-commit-guard.tsx
'use client'

import { getInstanceId, type RecordId } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { type MutableRefObject, useEffect } from 'react'
import type { FieldCommitGuard } from '~/components/fields/property-provider'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'
import { kindConflictPrompt, useKindConflictConfirm } from './use-kind-conflict-confirm'

const TITLE_ATTRIBUTES = ['part_title'] as const

/** A SINGLE_SELECT commit arrives as a string, a one-element array, or an option envelope. */
function readKind(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'string') return first || null
  if (first && typeof first === 'object') {
    const inner = first as { optionId?: unknown; value?: unknown }
    if (typeof inner.optionId === 'string') return inner.optionId
    if (typeof inner.value === 'string') return inner.value
  }
  return null
}

/**
 * The D4 check (plans/mrp/17) on a part's `part_kind` field editor: fills `guardRef` so the
 * property provider asks before saving a conflicting kind. Fails open until the BOM facts load.
 */
export function PartKindCommitGuard({
  recordId,
  guardRef,
}: {
  recordId: RecordId
  guardRef: MutableRefObject<FieldCommitGuard | null>
}) {
  const partId = getInstanceId(recordId)
  const facts = api.builds.kindConflictFacts.useQuery({ partIds: [partId] }, { staleTime: 30_000 })
  const { values } = useSystemValues(recordId, TITLE_ATTRIBUTES, { autoFetch: true })
  const title = typeof values.part_title === 'string' ? values.part_title : ''
  const { confirmKind, keepConfirmed, KindConflictDialog } = useKindConflictConfirm()
  const fact = facts.data?.[0]

  useEffect(() => {
    guardRef.current = (newValue) => {
      const kind = readKind(newValue)
      if (!kind || !fact) return null
      const part = {
        partId,
        title,
        isSubpartOfAssembly: fact.isSubpartOfAssembly,
        hasBom: fact.hasBom,
      }
      if (!kindConflictPrompt([part], kind)) return null
      return confirmKind([part], kind).then((decision) => {
        if (!decision || decision.apply.length === 0) return false
        return async () => {
          try {
            await keepConfirmed(decision)
          } catch (error) {
            toastError({
              title: 'Kind saved, but "keep it" was not',
              description: error instanceof Error ? error.message : undefined,
            })
          }
        }
      })
    }
    return () => {
      guardRef.current = null
    }
  }, [guardRef, partId, title, fact, confirmKind, keepConfirmed])

  return <KindConflictDialog />
}
