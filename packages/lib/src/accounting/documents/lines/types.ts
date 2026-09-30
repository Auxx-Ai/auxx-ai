// packages/lib/src/accounting/documents/lines/types.ts

import type { LineForTotals } from '../../sales/types'
import type { CreateLineInput, LineDocumentType, LinePatch } from './client'

/** The document a read or write is scoped to. `documentId` is the header's instance id. */
export interface LineDocumentRef {
  documentType: LineDocumentType
  documentId: string
}

export interface ReadDocumentLinesInput extends LineDocumentRef {
  /** For the edit-snapshot engine only; the router never asks for archived lines. */
  includeArchived?: boolean
  /** work_order only: a visit's extras, or (null / absent) the job's own set. */
  visitId?: string | null
}

export interface CreateLinesInput extends LineDocumentRef {
  lines: CreateLineInput[]
  /** Splice the new lines in directly after this one; appended at the tail otherwise. */
  afterLineId?: string
}

export interface UpdateLineInput extends LineDocumentRef {
  lineId: string
  patch: LinePatch
}

export interface UpdateLinesInput extends LineDocumentRef {
  updates: Array<{ lineId: string; patch: LinePatch }>
}

export interface ReorderLinesInput extends LineDocumentRef {
  orderedIds: string[]
}

export interface DeleteLinesInput extends LineDocumentRef {
  ids: string[]
}

/** Request-path extras every write takes. */
export interface LineWriteOptions {
  /** The acting tab's socket, excluded from its own realtime frames. */
  socketId?: string
  /** Refuse creates past the org's records limit; set only at user-initiated doors. */
  enforceRecordLimit?: boolean
}

/** One line's contribution to its document's totals, as the totals engine reads it. */
export type LineForTotalsRow = LineForTotals & {
  lineInstanceId: string
  /** Transcribed per-line tax; credit memo lines only. */
  lineTax: number | null
  /** The stored allocated net; read by the order spec. */
  storedNetTotal: number | null
}
