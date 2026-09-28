// apps/web/src/components/manufacturing/parts/use-kind-conflict-confirm.tsx
'use client'

import { type KindConflictReason, kindConflictFor } from '@auxx/lib/inventory/builds/client'
import { PartKind } from '@auxx/lib/resources/client'
import { useCallback } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** One part a kind is about to be written to, with its BOM facts. */
export interface KindConflictPart {
  partId: string
  title: string
  isSubpartOfAssembly: boolean
  hasBom: boolean
}

/** What to write: `apply` gets the kind; `confirmIds` (the conflicting ones kept) get "keep it". */
export interface KindConflictDecision {
  apply: string[]
  keepConfirmed: boolean
  confirmIds: string[]
}

/** The confirm's copy, or `null` when no part conflicts with `kind` (plans/mrp/17 D4). */
export function kindConflictPrompt(
  parts: readonly KindConflictPart[],
  kind: string
): {
  conflicting: KindConflictPart[]
  title: string
  description: string
  confirmText: string
  alternateText?: string
} | null {
  const reasons = parts.map((part) => kindConflictFor({ kind, ...part, confirmed: false }))
  const conflicting = parts.filter((_, index) => reasons[index] !== null)
  // One kind yields one reason: Finished Good only meets (a), Component only (b).
  const reason: KindConflictReason | null = reasons.find((found) => found !== null) ?? null
  if (conflicting.length === 0 || !reason) return null

  const label = PartKind.values.find((option) => option.value === kind)?.label ?? kind
  const usually =
    reason === 'finished_good_in_bom'
      ? {
          single: 'is used inside other parts',
          many: 'are used inside other parts',
          kind: 'Components',
          one: 'a Component',
        }
      : {
          single: 'has its own bill of materials',
          many: 'have their own bill of materials',
          kind: 'Subassemblies or Finished Goods',
          one: 'a Subassembly or Finished Good',
        }

  if (parts.length === 1) {
    const [part] = conflicting
    return {
      conflicting,
      title: `Set ${part?.title || 'this part'} to ${label}?`,
      description: `It ${usually.single} and is usually ${usually.one}.`,
      confirmText: `Set ${label} anyway`,
    }
  }

  const rest = parts.length - conflicting.length
  const n = conflicting.length
  return {
    conflicting,
    title: `Set ${parts.length} parts to ${label}?`,
    description:
      n === 1
        ? `1 of these ${usually.single} and is usually ${usually.one}.`
        : `${n} of these ${usually.many} and are usually ${usually.kind}.`,
    ...(rest > 0
      ? {
          confirmText: `Set ${rest}, skip ${n === 1 ? 'this one' : `these ${n}`}`,
          alternateText: `Set all ${parts.length} anyway`,
        }
      : { confirmText: `Set all ${parts.length} anyway` }),
  }
}

/**
 * The D4 check before a kind is saved from the app: asks only when a part would conflict, and
 * `keepConfirmed` marks the kept conflicts so the backflush gate skips them. Render `KindConflictDialog`.
 */
export function useKindConflictConfirm() {
  const [confirm, KindConflictDialog] = useConfirm()
  const utils = api.useUtils()
  const { mutateAsync: confirmKindConflicts } = api.builds.confirmKindConflicts.useMutation()

  const confirmKind = useCallback(
    async (
      parts: readonly KindConflictPart[],
      kind: string
    ): Promise<KindConflictDecision | null> => {
      const all = parts.map((part) => part.partId)
      const prompt = kindConflictPrompt(parts, kind)
      if (!prompt) return { apply: all, keepConfirmed: false, confirmIds: [] }

      const answer = await confirm({
        title: prompt.title,
        description: prompt.description,
        confirmText: prompt.confirmText,
        alternateText: prompt.alternateText,
        cancelText: 'Cancel',
      })
      if (answer === false) return null

      const conflictIds = prompt.conflicting.map((part) => part.partId)
      const skip = answer === true && prompt.alternateText !== undefined
      if (skip) {
        const skipped = new Set(conflictIds)
        return { apply: all.filter((id) => !skipped.has(id)), keepConfirmed: false, confirmIds: [] }
      }
      return { apply: all, keepConfirmed: true, confirmIds: conflictIds }
    },
    [confirm]
  )

  /** Store "keep it" for `decision.confirmIds`. Call only after the kind write has landed. */
  const keepConfirmed = useCallback(
    async (decision: KindConflictDecision) => {
      if (!decision.keepConfirmed || decision.confirmIds.length === 0) return
      await confirmKindConflicts({ partIds: decision.confirmIds })
      void utils.builds.kindConflicts.invalidate()
    },
    [confirmKindConflicts, utils]
  )

  return { confirmKind, keepConfirmed, KindConflictDialog }
}
