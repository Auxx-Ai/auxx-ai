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

// ── The two array-path vocabularies ──────────────────────────────────────────
// A leaf inside a NAMED array property is spelled differently by the schema tree
// and by the runtime, and the builder sits between them:
//
//   NODE path    `defaultFields.emails[].value`   — what `use-source-paths` names
//                the element shape, and what `[]` means everywhere else in the
//                builder (a fan-out `rootPath` addressing EVERY element).
//   BINDING path `defaultFields.emails[0].value`  — what `map-record.getByPath`
//                resolves. Its `INDEXED_SEGMENT` is `/^(.*?)\[(\d+)\]$/`, so a
//                digit-less `[]` never matches: the segment is read as the literal
//                key `emails[]`, and the whole path resolves `undefined`.
//
// Writing the node path straight into an expression — which is what the builder
// did — produces a binding that resolves to nothing. It is not inert: the key
// still reaches the write set carrying `undefined`. Multi-value targets are
// protected (`entity-sink` skips blanks on `options.multi`), a scalar target on
// the default `overwrite` strategy is not.
//
// So both directions need translating, and the two functions below are the only
// places that know it. Neither touches a TRAILING `[]` — that is a branch/rootPath
// fan-out marker, a different thing from addressing one element's leaf.

/** NODE → BINDING: address the first element (`emails[].value` → `emails[0].value`). */
export function toBindingPath(nodePath: string): string {
  return nodePath.replace(/\[\]\./g, '[0].')
}

/** BINDING → NODE: array-normalize for tree matching (`emails[0].value` → `emails[].value`). */
export function toNodePath(bindingPath: string): string {
  return bindingPath.replace(/\[\d+\]\./g, '[].')
}

/**
 * The NODE path a bare-token binding renders on — the key every source-tree lookup
 * must use, so a stored `[0]` binding finds its `[]` leaf.
 */
export function bareTokenNodePath(expression: string): string {
  return toNodePath(bareTokenSource(expression))
}

/**
 * A fresh bare-token binding for `sourcePath` → `targetFieldRef` (null = unassigned).
 * `sourcePath` is a NODE path (that is what the tree hands every caller); the stored
 * expression is its BINDING form so the runtime can resolve it.
 */
export function bindingFor(sourcePath: string, targetFieldRef: string | null): FieldMapping {
  const bindingPath = toBindingPath(sourcePath)
  return {
    id: generateId(),
    targetFieldRef,
    expression: `{${bindingPath}}`,
    sourceFields: { [bindingPath]: bindingPath },
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

/**
 * Drop the bare-token binding on `sourcePath` (if any). Compared in NODE space so
 * one leaf never ends up carrying two bindings that differ only by array spelling.
 */
export function removeBindingForSource(
  entries: FieldMapping[],
  sourcePath: string
): FieldMapping[] {
  const nodePath = toNodePath(sourcePath)
  return entries.filter(
    (e) => !(isBareToken(e.expression) && bareTokenNodePath(e.expression) === nodePath)
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
