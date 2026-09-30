// packages/lib/src/accounting/documents/lines/writes.ts

// No permission checks: the router asserts on the parent document (docs/lib-module-guide.md §6).
// Lock guards stay field and entity hooks in L0 and fire through the crud layer.
import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { BadRequestError } from '../../../errors'
import { UnifiedCrudHandler } from '../../../resources/crud'
import { createGuard } from '../../../utils/guard'
import { releaseLineAllocations } from '../../sales/billing/allocations'
import { syncInvoiceBillingProjection } from '../../sales/billing/projection'
import { recomputeTotals } from '../../sales/totals/totals-hooks'
import { type Line, type LineDocumentType, type LinePatch, linePatchSchemaFor } from './client'
import { readLines, readOwnedLineIds } from './reads'
import { publishLinesUpdated } from './realtime'
import {
  createStoredLine,
  deleteStoredLine,
  readInvoiceStatus,
  readStoredLines,
  writeStoredLine,
  writeStoredSortOrder,
} from './storage/field-value'
import type {
  CreateLinesInput,
  DeleteLinesInput,
  LineDocumentRef,
  LineWriteOptions,
  ReorderLinesInput,
  UpdateLineInput,
  UpdateLinesInput,
} from './types'

const guard = createGuard('accounting:lines')

/** Kinds whose header totals nothing else recomputes after a line delete. */
const RECOMPUTE_AFTER_DELETE = {
  quote: 'quote',
  order: 'order',
  purchase_order: 'purchase_order',
} as const satisfies Partial<Record<LineDocumentType, string>>

function handlerFor(
  db: Database,
  organizationId: string,
  userId: string,
  options: LineWriteOptions
): UnifiedCrudHandler {
  // No socket: the acting tab's other line readers (field store, record lists) still need
  // the per-field frames; only `lines:updated` excludes it.
  return new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    enforceRecordLimit: options.enforceRecordLimit,
  })
}

function parsePatch(documentType: LineDocumentType, patch: unknown): LinePatch {
  const parsed = linePatchSchemaFor(documentType).safeParse(patch)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) =>
        issue.code === 'unrecognized_keys' ? issue.keys.join(', ') : issue.path.join('.')
      )
      .join('; ')
    throw new BadRequestError(`A ${documentType} line cannot take: ${detail}`)
  }
  return parsed.data as LinePatch
}

async function assertOnDocument(
  db: Database,
  organizationId: string,
  ref: LineDocumentRef,
  ids: readonly string[]
): Promise<void> {
  const owned = await readOwnedLineIds(db, organizationId, { ...ref, ids })
  const missing = ids.find((id) => !owned.has(id))
  if (missing) {
    throw new BadRequestError(`Line ${missing} is not on this ${ref.documentType}`, {
      lineId: missing,
      documentId: ref.documentId,
    })
  }
}

function announce(
  organizationId: string,
  ref: LineDocumentRef,
  upserted: Line[],
  deleted: string[],
  options: LineWriteOptions
): void {
  void publishLinesUpdated(
    organizationId,
    { documentType: ref.documentType, documentId: ref.documentId, upserted, deleted },
    { excludeSocketId: options.socketId }
  ).catch(() => {})
}

/** A document's own lines in render order, across every visit split. */
async function readAllOwned(db: Database, organizationId: string, ref: LineDocumentRef) {
  const stored = await readStoredLines(db, organizationId, ref.documentType, {
    documentId: ref.documentId,
  })
  return stored
    .filter((row) => row.owned)
    .map((row) => row.line)
    .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || (a.id < b.id ? -1 : 1))
}

/** Rewrite `sortOrder = index` for every line whose stored position differs. */
async function writePositions(
  handler: UnifiedCrudHandler,
  documentType: LineDocumentType,
  ordered: Array<Pick<Line, 'id' | 'sortOrder'>>
): Promise<string[]> {
  const moved: string[] = []
  for (const [index, line] of ordered.entries()) {
    if (line.sortOrder === index) continue
    await writeStoredSortOrder(handler, documentType, line.id, index)
    moved.push(line.id)
  }
  return moved
}

/**
 * Create lines one crud create each, so pre-create guards and derive hooks fire. Not one
 * transaction (the hooks read through pool-scoped services); a failure deletes what was made.
 */
export async function createLines(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateLinesInput,
  options: LineWriteOptions = {}
): Promise<Result<Line[], Error>> {
  return guard(
    async () => {
      const { documentType, documentId } = input
      const patches = input.lines.map((line) => parsePatch(documentType, line))
      if (patches.length === 0) return []

      const existing = await readAllOwned(db, organizationId, input)
      const anchor = input.afterLineId
        ? existing.find((line) => line.id === input.afterLineId)
        : undefined
      if (input.afterLineId && !anchor) {
        throw new BadRequestError(`Line ${input.afterLineId} is not on this ${documentType}`)
      }
      const tail = existing.reduce((max, line) => Math.max(max, line.sortOrder ?? -1), -1) + 1

      const handler = handlerFor(db, organizationId, userId, options)
      const created: string[] = []
      try {
        for (const [index, patch] of patches.entries()) {
          created.push(
            await createStoredLine(handler, documentType, documentId, patch, tail + index)
          )
        }
      } catch (error) {
        // Best effort: a failed cleanup must not mask the original error.
        for (const id of [...created].reverse()) {
          await deleteStoredLine(handler, documentType, id).catch(() => {})
        }
        throw error
      }

      let moved: string[] = []
      if (anchor) {
        // Splice within the anchor's own list: a work order's visit sets never interleave.
        const list = existing.filter((line) => (line.visitId ?? null) === (anchor.visitId ?? null))
        const at = list.indexOf(anchor) + 1
        if (at < list.length) {
          const createdRows = created.map((id, index) => ({ id, sortOrder: tail + index }))
          moved = await writePositions(handler, documentType, [
            ...list.slice(0, at),
            ...createdRows,
            ...list.slice(at),
          ])
        }
      }

      const touched = [...new Set([...created, ...moved])]
      const lines = await readLines(db, organizationId, { documentType, ids: touched })
      announce(organizationId, input, lines, [], options)
      const byId = new Map(lines.map((line) => [line.id, line]))
      return created.flatMap((id) => byId.get(id) ?? [])
    },
    'Failed to create lines',
    { documentType: input.documentType, documentId: input.documentId }
  )
}

/** Write one line's patch. Field pre-hooks refuse loudly; derive hooks recompute totals. */
export async function updateLine(
  db: Database,
  organizationId: string,
  userId: string,
  input: UpdateLineInput,
  options: LineWriteOptions = {}
): Promise<Result<Line, Error>> {
  return guard(
    async () => {
      const [line] = await writeUpdates(db, organizationId, userId, input, options, [
        { lineId: input.lineId, patch: input.patch },
      ])
      if (!line)
        throw new BadRequestError(`Line ${input.lineId} is not on this ${input.documentType}`)
      return line
    },
    'Failed to update line',
    { documentType: input.documentType, documentId: input.documentId, lineId: input.lineId }
  )
}

/** Write several lines' patches: the builder's diff-flush after create and the part prefill. */
export async function updateLines(
  db: Database,
  organizationId: string,
  userId: string,
  input: UpdateLinesInput,
  options: LineWriteOptions = {}
): Promise<Result<Line[], Error>> {
  return guard(
    () => writeUpdates(db, organizationId, userId, input, options, input.updates),
    'Failed to update lines',
    { documentType: input.documentType, documentId: input.documentId }
  )
}

async function writeUpdates(
  db: Database,
  organizationId: string,
  userId: string,
  ref: LineDocumentRef,
  options: LineWriteOptions,
  updates: Array<{ lineId: string; patch: LinePatch }>
): Promise<Line[]> {
  const parsed = updates.map((update) => ({
    lineId: update.lineId,
    patch: parsePatch(ref.documentType, update.patch),
  }))
  const ids = [...new Set(parsed.map((update) => update.lineId))]
  await assertOnDocument(db, organizationId, ref, ids)

  const handler = handlerFor(db, organizationId, userId, options)
  for (const update of parsed) {
    await writeStoredLine(handler, ref.documentType, update.lineId, update.patch)
  }

  const lines = await readLines(db, organizationId, { documentType: ref.documentType, ids })
  announce(organizationId, ref, lines, [], options)
  return lines
}

/**
 * Persist a drag result as `sortOrder = index`, writing only the lines that moved. Allowed on
 * issued documents: sort order is not a locked attr anywhere.
 */
export async function reorderLines(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReorderLinesInput,
  options: LineWriteOptions = {}
): Promise<Result<Line[], Error>> {
  return guard(
    async () => {
      const { documentType, orderedIds } = input
      if (new Set(orderedIds).size !== orderedIds.length) {
        throw new BadRequestError('A reorder names each line once')
      }
      await assertOnDocument(db, organizationId, input, orderedIds)

      const current = await readLines(db, organizationId, { documentType, ids: orderedIds })
      const handler = handlerFor(db, organizationId, userId, options)
      const moved = await writePositions(handler, documentType, current)

      const lines = await readLines(db, organizationId, { documentType, ids: orderedIds })
      const movedSet = new Set(moved)
      announce(
        organizationId,
        input,
        lines.filter((line) => movedSet.has(line.id)),
        [],
        options
      )
      return lines
    },
    'Failed to reorder lines',
    { documentType: input.documentType, documentId: input.documentId }
  )
}

/**
 * Delete lines through the crud handler, then recompute the header inline. The invoice arm is
 * `deleteInvoiceLine`'s: draft only, allocations released, billing projection re-synced.
 */
export async function deleteLines(
  db: Database,
  organizationId: string,
  userId: string,
  input: DeleteLinesInput,
  options: LineWriteOptions = {}
): Promise<Result<string[], Error>> {
  return guard(
    async () => {
      const { documentType, documentId } = input
      const ids = [...new Set(input.ids)]
      if (ids.length === 0) return []
      await assertOnDocument(db, organizationId, input, ids)

      const isInvoice = documentType === 'invoice'
      if (isInvoice) {
        const status = await readInvoiceStatus(db, organizationId, documentId)
        if (status !== 'draft') {
          throw new BadRequestError(
            `Cannot delete a line — invoice must be 'draft' (currently '${status ?? 'unknown'}')`
          )
        }
      }

      const handler = handlerFor(db, organizationId, userId, options)
      const deleted: string[] = []
      let failure: unknown
      for (const id of ids) {
        try {
          if (isInvoice) {
            await releaseLineAllocations(db, organizationId, { invoiceLineItemId: id })
            // This command runs the recompute and the projection sync itself, below.
            await deleteStoredLine(handler, documentType, id, { suppressPostDeleteHooks: true })
          } else {
            await deleteStoredLine(handler, documentType, id)
          }
          deleted.push(id)
        } catch (error) {
          failure = error
          break
        }
      }

      if (deleted.length > 0) {
        if (isInvoice) {
          await recomputeTotals({
            organizationId,
            userId,
            documentType: 'invoice',
            documentInstanceId: documentId,
            db,
          })
          await syncInvoiceBillingProjection({
            db,
            organizationId,
            userId,
            invoiceInstanceId: documentId,
          })
        } else if (documentType in RECOMPUTE_AFTER_DELETE) {
          await recomputeTotals({
            organizationId,
            userId,
            documentType:
              RECOMPUTE_AFTER_DELETE[documentType as keyof typeof RECOMPUTE_AFTER_DELETE],
            documentInstanceId: documentId,
            db,
          })
        }
        announce(organizationId, input, [], deleted, options)
      }
      if (failure) throw failure
      return deleted
    },
    'Failed to delete lines',
    { documentType: input.documentType, documentId: input.documentId }
  )
}
