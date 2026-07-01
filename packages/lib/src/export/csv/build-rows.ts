// packages/lib/src/export/csv/build-rows.ts

import type { RecordId } from '@auxx/types/resource'
import { csvCell } from '@auxx/utils/csv'
import type { TypedFieldValueResult } from '../../field-values/types'
import type { ExportColumn } from '../types'
import { formatCell } from './format-cell'

/** UTF-8 BOM so Excel opens the CSV with the right encoding. */
const BOM = '﻿'

/**
 * Stable string key for a `FieldReference` (matches how `batchGetValues` echoes
 * `fieldRef` back on each result): a direct `ResourceFieldId` stays a string, a
 * `FieldPath` is joined with `::`.
 */
export function fieldRefKey(fieldRef: ExportColumn['fieldRef']): string {
  return Array.isArray(fieldRef) ? fieldRef.join('::') : String(fieldRef)
}

/**
 * Index a flat page of `batchGetValues` results into
 * `Map<recordId, Map<fieldKey, result>>` for O(1) cell lookup while building rows.
 */
export function indexByRecord(
  results: TypedFieldValueResult[]
): Map<RecordId, Map<string, TypedFieldValueResult>> {
  const byRecord = new Map<RecordId, Map<string, TypedFieldValueResult>>()
  for (const result of results) {
    let row = byRecord.get(result.recordId)
    if (!row) {
      row = new Map()
      byRecord.set(result.recordId, row)
    }
    row.set(fieldRefKey(result.fieldRef), result)
  }
  return byRecord
}

/**
 * Build the ordered string cells for one record, in column order.
 */
export function buildRow(
  recordId: RecordId,
  columns: ExportColumn[],
  byRecord: Map<RecordId, Map<string, TypedFieldValueResult>>,
  nameCache: Map<RecordId, string>
): string[] {
  const row = byRecord.get(recordId)
  return columns.map((column) => formatCell(row?.get(fieldRefKey(column.fieldRef)), nameCache))
}

/**
 * Serialize a header + rows into CSV text with a leading BOM. Cells are escaped
 * per RFC 4180 via `csvCell`; column order and duplicate labels are preserved
 * (we build the header manually rather than using `toCsv`'s key-map mode).
 */
export function serializeCsv(header: string[], rows: string[][]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))]
  return BOM + lines.join('\n')
}
