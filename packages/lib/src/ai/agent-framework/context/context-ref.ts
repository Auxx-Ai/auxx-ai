// packages/lib/src/ai/agent-framework/context/context-ref.ts

import type { FieldReference } from '@auxx/types/field'
import type { ContextRef } from './context-manager'

/**
 * Parsed form of a {@link ContextRef} — a `(kind, root, path)` triple. The
 * `root` half (which source, which key) is store-specific; the `path` half is
 * handed to the one shared path walker (Phase 1) for in-value navigation.
 */
export type ParsedRef =
  | { kind: 'var'; root: string; path: string }
  | { kind: 'tool'; name: string; all: boolean; index?: number; path: string }
  | { kind: 'call'; toolCallId: string; path: string }
  | { kind: 'sys'; key: string }
  | { kind: 'field'; ref: FieldReference }

/** The four reserved, non-entity prefixes. An entity type can never use these. */
const RESERVED_PREFIXES = new Set(['var', 'tool', 'call', 'sys'])

/**
 * Split a remainder into its top-level root key and the navigation path that
 * follows. The root runs up to the first `.` or `[`; a leading `.` is stripped
 * from the path so `[n]`/`[*]` brackets stay attached.
 *
 *   'cart.total'   → { root: 'cart',  path: 'total' }
 *   'items[0]'     → { root: 'items', path: '[0]' }
 *   'items[*].id'  → { root: 'items', path: '[*].id' }
 *   'plan'         → { root: 'plan',  path: '' }
 */
function splitRootPath(rest: string): { root: string; path: string } {
  const match = rest.match(/^([^.[]+)(.*)$/)
  if (!match?.[1]) return { root: rest, path: '' }
  let path = match[2] ?? ''
  if (path.startsWith('.')) path = path.slice(1)
  return { root: match[1], path }
}

/** Parse the remainder of a `tool:` ref into name, view selector, and path. */
function parseTool(rest: string): ParsedRef {
  const match = rest.match(/^([^.[]+)(.*)$/)
  const name = match?.[1] ?? rest
  let tail = match?.[2] ?? ''

  let all = false
  let index: number | undefined

  // A bracket IMMEDIATELY after the name is the view selector, not navigation:
  //   foo[]   → all invocations
  //   foo[*]  → all invocations
  //   foo[0]  → the indexed invocation
  // A deeper `foo.orders[*]` has no selector — the bracket is part of `path`.
  const selector = tail.match(/^\[(\*|-?\d+)?\]/)
  if (selector) {
    const inner = selector[1]
    if (inner === undefined || inner === '*') {
      all = true
    } else {
      index = Number.parseInt(inner, 10)
    }
    tail = tail.slice(selector[0].length)
  }

  let path = tail
  if (path.startsWith('.')) path = path.slice(1)
  return { kind: 'tool', name, all, index, path }
}

/**
 * Parse a {@link ContextRef} into a {@link ParsedRef}.
 *
 * The reserved prefix is matched on the segment **before the first `:`**. The
 * array form is always a `FieldPath`; a colon-string whose root isn't reserved
 * (e.g. `contact:primary_email`, `contact:@app:shopify:customerId`) is a
 * `FieldReference`, with the whole string preserved.
 */
export function parseContextRef(ref: ContextRef): ParsedRef {
  // Array form is always a v8 FieldPath traversal.
  if (Array.isArray(ref)) {
    return { kind: 'field', ref }
  }

  const colonIdx = ref.indexOf(':')
  const prefix = colonIdx === -1 ? '' : ref.slice(0, colonIdx)

  if (!RESERVED_PREFIXES.has(prefix)) {
    // Not a reserved prefix → a FieldReference (system/custom/app field, with
    // any further colons — `@app:slug:key` — kept intact).
    return { kind: 'field', ref: ref as FieldReference }
  }

  const rest = ref.slice(colonIdx + 1)
  switch (prefix) {
    case 'sys':
      return { kind: 'sys', key: rest }
    case 'tool':
      return parseTool(rest)
    case 'call': {
      const { root, path } = splitRootPath(rest)
      return { kind: 'call', toolCallId: root, path }
    }
    default: {
      // 'var'
      const { root, path } = splitRootPath(rest)
      return { kind: 'var', root, path }
    }
  }
}
