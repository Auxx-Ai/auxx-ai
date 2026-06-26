// apps/web/src/components/data-connectors/ui/field-mapping-edits.ts
// Pure transforms over a mapping's `fieldMappings` array (relationship-linking v3
// — unified picker). Shared by the M-level (direct) and drilled-child binding
// paths so both produce identical entry shapes. No React / no I/O — unit-testable.

import { generateId } from '@auxx/utils'
import type { FieldMapping } from '../hooks/use-stream-mutations'

/** A degenerate single-token `{path}` expression (one-click row, not a calc). */
export function isBareToken(expression: string): boolean {
  return /^\{[^{}]+\}$/.test(expression.trim())
}

/** The source path inside a bare-token expression (`{customer.email}` → `customer.email`). */
export function bareTokenSource(expression: string): string {
  return expression.replace(/^\{|\}$/g, '')
}

/** A fresh bare-token binding for `sourcePath` → `targetFieldRef` (null = unassigned). */
export function bindingFor(sourcePath: string, targetFieldRef: string | null): FieldMapping {
  return {
    id: generateId(),
    targetFieldRef,
    expression: `{${sourcePath}}`,
    sourceFields: { [sourcePath]: sourcePath },
  }
}

/**
 * Replace any prior bare-token binding on `sourcePath`, then append the new one
 * (1 source → 1 target). Mirrors the inline logic the direct-bind path uses; the
 * drilled-child path reuses it so a drilled binding is byte-identical.
 */
export function upsertBinding(
  entries: FieldMapping[],
  sourcePath: string,
  targetFieldRef: string
): FieldMapping[] {
  return [...removeBindingForSource(entries, sourcePath), bindingFor(sourcePath, targetFieldRef)]
}

/** Drop the bare-token binding on `sourcePath` (if any). */
export function removeBindingForSource(
  entries: FieldMapping[],
  sourcePath: string
): FieldMapping[] {
  return entries.filter(
    (e) => !(isBareToken(e.expression) && bareTokenSource(e.expression) === sourcePath)
  )
}

/**
 * Re-home a formula entry onto a new target field, preserving its `expression`,
 * `sourceFields`, `id`, and any identity role. Used when a formula's target picker
 * moves the entry between the parent mapping (a root scalar) and a flat drilled
 * child (a field across a relationship) — only the target pointer changes.
 */
export function retargetFormulaEntry(entry: FieldMapping, targetFieldRef: string): FieldMapping {
  return { ...entry, targetFieldRef }
}

/**
 * Set/clear an entry's identity role, keeping External ID a radio WITHIN this entry
 * list (picking it clears any other External ID first). `null` clears the role. The
 * entry must already exist (the drilled-child path always binds a field before it
 * can be keyed). `normalize` is the match normalizer when role === 'match'.
 */
export function setEntryIdentityRole(
  entries: FieldMapping[],
  entryId: string,
  role: 'externalId' | 'match' | null,
  normalize: 'email' | 'phone' | 'domain' | 'none' = 'none'
): FieldMapping[] {
  return entries.map((e) => {
    if (e.id === entryId) {
      const identityRole =
        role == null
          ? undefined
          : role === 'externalId'
            ? ({ kind: 'externalId' } as const)
            : ({ kind: 'match', normalize } as const)
      return { ...e, identityRole }
    }
    // Radio: only one primary External ID per mapping.
    if (role === 'externalId' && e.identityRole?.kind === 'externalId') {
      return { ...e, identityRole: undefined }
    }
    return e
  })
}
