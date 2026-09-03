// apps/web/src/components/purchasing/intake/hooks/use-intake-draft.ts
'use client'

// Local edit state for one intake draft, plus the debounced write-back to
// `purchasing.saveIntakeDraft` (plans/money/tasks/38 §6.1).
//
// 🛑 NOTHING here persists an `EntityInstance`. Every row the review screen shows
// is a line inside the intake draft's payload; the only write that mints
// records is `commitIntakeDraft`. That is the whole point of the draft — "a plan
// the user abandons at the preview must leave no records behind".
//
// The server row is the source of truth exactly once, at load. After that this
// hook owns the payload: a refetch that overwrote local state would silently drop
// whatever the person was typing when it landed.

import {
  effectiveUnitPriceCents,
  type IntakeDraftPayload,
  type IntakeFold,
  type IntakeLine,
  parseIntakeTotal,
  parseIntakeUnitPrice,
} from '@auxx/lib/purchasing/intake/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LinePatch } from '~/components/money/ui/line-builder/line-values'
import { api } from '~/trpc/react'

/** How long a keystroke sits before the draft is written back. */
const SAVE_DEBOUNCE_MS = 700

/**
 * What a folded line contributes to the header total it moved into.
 *
 * The line's own extended amount when it has one, otherwise the vendor's printed
 * line total. `0` for a line that carries neither — a fold cannot invent a number
 * the document does not print, and silently dropping the row instead would make
 * the §3.1 confrontation stop balancing for a reason nobody could see.
 */
export function foldAmountCents(line: IntakeLine, currency: string): number {
  const unit = effectiveUnitPriceCents(line)
  if (unit !== null) return Math.round(unit * line.quantity)
  return parseIntakeTotal(line.printed.lineTotalText, currency) ?? 0
}

export interface IntakeDraftEditor {
  payload: IntakeDraftPayload | null
  /** True while a local edit has not yet reached the server. */
  isDirty: boolean
  isSaving: boolean
  /** Replace the payload wholesale. Every other helper routes through this. */
  update: (next: (current: IntakeDraftPayload) => IntakeDraftPayload) => void
  /** Apply a line-builder patch to one line. */
  patchLine: (lineId: string, patch: LinePatch) => void
  /**
   * Adopt one of the vendor's printed quantity breaks as the line's price.
   *
   * `null` means the base printed price. This is separate from `patchLine`
   * because it is the one price write that KEEPS a `chosenBreakIndex` — a price
   * typed into the cell is nobody's break and clears it.
   */
  chooseBreak: (lineId: string, index: number | null) => void
  /** Take a line out of the order — reversible, see {@link IntakeDraftEditor.restoreLine}. */
  removeLine: (lineId: string) => void
  /** Put a removed line back as an ordinary line. */
  restoreLine: (lineId: string) => void
  /** §5.4: move a line's amount onto a header total and take the row out. */
  foldLine: (lineId: string, into: IntakeFold) => void
  unfoldLine: (lineId: string) => void
  /** Await any pending write. Call before committing. */
  flush: () => Promise<void>
}

export function useIntakeDraftEditor(
  draftId: string,
  serverPayload: IntakeDraftPayload | null
): IntakeDraftEditor {
  const [payload, setPayload] = useState<IntakeDraftPayload | null>(serverPayload)
  const [isDirty, setIsDirty] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Promise<unknown> | null>(null)
  const pendingRef = useRef<IntakeDraftPayload | null>(null)

  const saveDraft = api.purchasing.saveIntakeDraft.useMutation()
  const saveRef = useRef(saveDraft)
  saveRef.current = saveDraft

  // Seed once, when the payload first arrives. Keyed on "we have nothing yet"
  // rather than on the server value, so a background refetch cannot clobber an
  // edit in progress.
  useEffect(() => {
    setPayload((current) => current ?? serverPayload)
  }, [serverPayload])

  const write = useCallback(
    async (next: IntakeDraftPayload) => {
      try {
        const promise = saveRef.current.mutateAsync({ draftId, payload: next })
        inFlightRef.current = promise
        await promise
        // Only clear the flag if nothing new was queued while this was in flight.
        if (pendingRef.current === next) {
          pendingRef.current = null
          setIsDirty(false)
        }
      } catch (error) {
        toastError({
          title: 'Could not save the draft',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        inFlightRef.current = null
      }
    },
    [draftId]
  )

  const update = useCallback(
    (next: (current: IntakeDraftPayload) => IntakeDraftPayload) => {
      setPayload((current) => {
        if (!current) return current
        const updated = next(current)
        pendingRef.current = updated
        setIsDirty(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => void write(updated), SAVE_DEBOUNCE_MS)
        return updated
      })
    },
    [write]
  )

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (inFlightRef.current) await inFlightRef.current
    const pending = pendingRef.current
    if (pending) await write(pending)
  }, [write])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const mapLine = useCallback(
    (lineId: string, fn: (line: IntakeLine) => IntakeLine) => {
      update((current) => ({
        ...current,
        lines: current.lines.map((line) => (line.lineId === lineId ? fn(line) : line)),
      }))
    },
    [update]
  )

  const patchLine = useCallback(
    (lineId: string, patch: LinePatch) => {
      mapLine(lineId, (line) => ({
        ...line,
        ...(patch.partRecordId !== undefined ? { partRecordId: patch.partRecordId } : {}),
        ...(patch.vendorPartRecordId !== undefined
          ? { vendorPartRecordId: patch.vendorPartRecordId }
          : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.qty !== undefined ? { quantity: patch.qty } : {}),
        ...(patch.unitPriceCents !== undefined
          ? { unitPriceCents: patch.unitPriceCents, chosenBreakIndex: null }
          : {}),
      }))
    },
    [mapLine]
  )

  const chooseBreak = useCallback(
    (lineId: string, index: number | null) => {
      update((current) => ({
        ...current,
        lines: current.lines.map((line) => {
          if (line.lineId !== lineId) return line
          const text =
            index === null
              ? line.printed.unitPriceText
              : (line.printed.priceBreaks[index]?.unitPriceText ?? null)
          // A unit price, so RATE_DECIMALS: a fastener vendor quoting
          // `$15.94 per 1,000` means `0.01594` each, and rounding that to whole
          // minor units gives 2 cents - a 25% error that looks plausible.
          const price = parseIntakeUnitPrice(text, current.currency)
          // An unparseable break leaves the price alone rather than nulling it —
          // "POA" against a break is not an instruction to forget the price we
          // already have.
          return price === null ? line : { ...line, unitPriceCents: price, chosenBreakIndex: index }
        }),
      }))
    },
    [update]
  )

  /**
   * Take a line out of the order, keeping it on the draft.
   *
   * 🛑 A flag, not a `filter`. This screen autosaves, so dropping the line from
   * the array put it beyond recovery the moment the debounce fired — on a
   * forty-line quote the only way back was re-reading the document. `restoreLine`
   * is the other half, and `orderableLines` is what keeps the removal invisible
   * to the table, the totals, the commit gate and the commit.
   *
   * 🛑 Un-folds on the way out. A folded line's amount is already in
   * `shippingCents`/`taxCents`; removing it while folded would leave that money
   * on the header with nothing on screen accounting for it.
   */
  const removeLine = useCallback(
    (lineId: string) => {
      update((current) => {
        const target = current.lines.find((line) => line.lineId === lineId)
        if (!target || target.removed) return current
        const fold = target.foldedInto
        const amount = fold ? foldAmountCents(target, current.currency) : 0
        return {
          ...current,
          shippingCents: current.shippingCents - (fold === 'shipping' ? amount : 0),
          taxCents: current.taxCents - (fold === 'tax' ? amount : 0),
          lines: current.lines.map((line) =>
            line.lineId === lineId ? { ...line, removed: true, foldedInto: null } : line
          ),
        }
      })
    },
    [update]
  )

  /**
   * Put a removed line back.
   *
   * It returns as an ORDINARY line — its part, price and printed data are
   * untouched, because nothing about them changed when it left. A line that was
   * folded when it was removed comes back unfolded: the fold was undone on the
   * way out, and silently re-applying it would move money onto the header that
   * the person restoring the line never asked for.
   */
  const restoreLine = useCallback(
    (lineId: string) => {
      update((current) => ({
        ...current,
        lines: current.lines.map((line) =>
          line.lineId === lineId ? { ...line, removed: false } : line
        ),
      }))
    },
    [update]
  )

  const foldLine = useCallback(
    (lineId: string, into: IntakeFold) => {
      update((current) => {
        const target = current.lines.find((line) => line.lineId === lineId)
        if (!target || target.foldedInto !== null) return current
        const amount = foldAmountCents(target, current.currency)
        return {
          ...current,
          shippingCents: current.shippingCents + (into === 'shipping' ? amount : 0),
          taxCents: current.taxCents + (into === 'tax' ? amount : 0),
          lines: current.lines.map((line) =>
            line.lineId === lineId ? { ...line, foldedInto: into } : line
          ),
        }
      })
    },
    [update]
  )

  const unfoldLine = useCallback(
    (lineId: string) => {
      update((current) => {
        const target = current.lines.find((line) => line.lineId === lineId)
        if (!target || target.foldedInto === null) return current
        const amount = foldAmountCents(target, current.currency)
        return {
          ...current,
          shippingCents: current.shippingCents - (target.foldedInto === 'shipping' ? amount : 0),
          taxCents: current.taxCents - (target.foldedInto === 'tax' ? amount : 0),
          lines: current.lines.map((line) =>
            line.lineId === lineId ? { ...line, foldedInto: null } : line
          ),
        }
      })
    },
    [update]
  )

  return {
    payload,
    isDirty,
    isSaving: saveDraft.isPending,
    update,
    patchLine,
    chooseBreak,
    removeLine,
    restoreLine,
    foldLine,
    unfoldLine,
    flush,
  }
}
