// apps/web/src/components/custom-fields/ui/calc-editor/formula-converters.ts

import {
  extractFieldIdsFromString as extractFieldIdsFromStringLib,
  extractFieldIds as extractFieldIdsLib,
  formulaToString as formulaToStringLib,
  stringToFormula as stringToFormulaLib,
} from '@auxx/lib/custom-fields/client'
import type { JSONContent } from '@tiptap/core'

/**
 * Thin TipTap-typed wrappers around the shared converters in @auxx/lib.
 * Existing callers keep their `JSONContent` types; the lib implementations
 * use a structural node shape that `JSONContent` is assignment-compatible with.
 */

export function formulaToString(content: JSONContent): string {
  return formulaToStringLib(content)
}

export function stringToFormula(text: string): JSONContent {
  return stringToFormulaLib(text) as JSONContent
}

export function extractFieldIds(content: JSONContent): string[] {
  return extractFieldIdsLib(content)
}

export function extractFieldIdsFromString(text: string): string[] {
  return extractFieldIdsFromStringLib(text)
}
