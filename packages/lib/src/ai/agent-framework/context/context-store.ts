// packages/lib/src/ai/agent-framework/context/context-store.ts

import { createScopedLogger } from '@auxx/logger'
import { type FieldReference, fieldRefToKey } from '@auxx/types/field'
import type { ToolContext } from '../tool-context'
import type {
  CapturedInvocation,
  ContextEntryDescriptor,
  ContextManager,
  ContextRef,
  SerializedContext,
} from './context-manager'
import { parseContextRef } from './context-ref'
import { walkPath } from './path-walker'
import { buildFieldSource } from './sources/field-source'
import { createSysSource } from './sources/sys-source'

const logger = createScopedLogger('kopilot-context-store')

/** Key under which the serialized context slice rides on `domainState`. */
export const CONTEXT_SLICE_KEY = '__context'

/** Coarse cap on the persisted slice (Open Q6). On overflow we drop the turn sub-slice. */
const MAX_CONTEXT_BYTES = 256 * 1024

/**
 * The kopilot {@link ContextManager} — the real backing store (chat v9). Backs
 * `var:*` scratch (persists across turns), `sys:*` system values, the v8
 * `FieldReference` source (resolved off `ctx.subject`, memoized per turn), and
 * captured `tool:*` / `call:*` invocations (turn-scoped).
 *
 * Phase 1 covers reads, whole-value `var:*` writes, interpolation, and
 * serialize/hydrate. Nested `var:*` writes land in Phase 2; the dispatch-path
 * wiring of {@link captureToolResult} and the turn-reset seam land in Phase 3.
 */
export class KopilotContextStore implements ContextManager {
  private vars: Record<string, unknown>
  private tools = new Map<string, CapturedInvocation[]>()
  private callsById = new Map<string, CapturedInvocation>()
  /** Per-turn `FieldReference` read cache — in-memory only, never serialized. */
  private fieldMemo = new Map<string, unknown>()
  private nextSeq = 0
  private readonly resolveField: (ref: FieldReference) => Promise<unknown>
  private readonly readSys: (key: string) => unknown

  constructor(deps: { ctx: ToolContext; initial?: SerializedContext }) {
    this.vars = { ...(deps.initial?.vars ?? {}) }

    const turn = deps.initial?.turn
    if (turn) {
      for (const [name, list] of Object.entries(turn.tools)) this.tools.set(name, [...list])
      for (const [id, inv] of Object.entries(turn.calls)) this.callsById.set(id, inv)
      for (const inv of this.callsById.values()) this.nextSeq = Math.max(this.nextSeq, inv.seq + 1)
    }

    this.resolveField = buildFieldSource(deps.ctx)
    this.readSys = createSysSource(deps.ctx)
  }

  async read(ref: ContextRef): Promise<unknown> {
    const parsed = parseContextRef(ref)

    switch (parsed.kind) {
      case 'var':
        return walkPath(this.vars[parsed.root], parsed.path)

      case 'sys':
        return this.readSys(parsed.key)

      case 'field': {
        const key = fieldRefToKey(parsed.ref)
        if (this.fieldMemo.has(key)) return this.fieldMemo.get(key)
        const value = await this.resolveField(parsed.ref)
        this.fieldMemo.set(key, value)
        return value
      }

      case 'call': {
        const inv = this.callsById.get(parsed.toolCallId)
        return inv ? walkPath(inv.result, parsed.path) : undefined
      }

      case 'tool': {
        const list = this.tools.get(parsed.name) ?? []
        if (parsed.all) {
          return walkPath(
            list.map((inv) => inv.result),
            parsed.path
          )
        }
        const inv =
          parsed.index === undefined
            ? list[list.length - 1] // latest
            : parsed.index < 0
              ? list[list.length + parsed.index]
              : list[parsed.index]
        return inv ? walkPath(inv.result, parsed.path) : undefined
      }
    }
  }

  /**
   * Write into `var:*` scratch. A bare `var:cart` sets the whole value; a nested
   * `var:cart.total` walks/creates intermediate objects and sets the leaf.
   *
   * `tool:*` / `call:*` / `sys:*` are engine-owned / read-only and throw;
   * `FieldReference` write-back is not enabled until Phase 5 and throws an
   * explicit (not silent) error.
   */
  async write(ref: ContextRef, value: unknown): Promise<void> {
    const parsed = parseContextRef(ref)
    switch (parsed.kind) {
      case 'var':
        if (!parsed.path) {
          this.vars[parsed.root] = value
        } else {
          setNestedVar(this.vars, parsed.root, parsed.path, value)
        }
        return
      case 'field':
        throw new Error('context write-back to entity fields is not enabled (Phase 5)')
      default:
        throw new Error(`context write supports only var:* (got ${parsed.kind})`)
    }
  }

  /** Replace `{{ref}}` occurrences with display-formatted resolved values. */
  async interpolate(text: string): Promise<string> {
    if (!text) return text
    const matches = [...text.matchAll(/\{\{([^}]+)\}\}/g)]
    if (matches.length === 0) return text

    let result = text
    for (const match of matches) {
      const ref = match[1]?.trim()
      if (!ref) continue
      const value = await this.read(ref as ContextRef)
      const replacement =
        value === null || value === undefined
          ? ''
          : typeof value === 'object'
            ? formatForDisplay(value)
            : String(value)
      // Escape `$` so String.replace doesn't treat `$&`/`$1` etc. specially.
      result = result.replace(match[0], replacement.replace(/\$/g, '$$$$'))
    }
    return result
  }

  /**
   * Capture a successful tool result. Implemented here so reads (`tool:*` /
   * `call:*`) are coherent; the dispatch-path call sites and the turn-reset wire
   * land in Phase 3.
   */
  captureToolResult(toolCallId: string, toolName: string, result: unknown): void {
    const invocation: CapturedInvocation = {
      toolCallId,
      toolName,
      result,
      seq: this.nextSeq++,
    }
    this.callsById.set(toolCallId, invocation)
    const list = this.tools.get(toolName) ?? []
    list.push(invocation)
    this.tools.set(toolName, list)
  }

  /** Clear the turn-scoped capture slice; `var:*` and `sys:*` are untouched. */
  resetTurn(): void {
    this.tools.clear()
    this.callsById.clear()
    this.fieldMemo.clear()
    this.nextSeq = 0
  }

  list(): ContextEntryDescriptor[] {
    const entries: ContextEntryDescriptor[] = []
    for (const key of Object.keys(this.vars)) entries.push({ ref: `var:${key}`, kind: 'var' })
    for (const name of this.tools.keys()) entries.push({ ref: `tool:${name}`, kind: 'tool' })
    for (const id of this.callsById.keys()) entries.push({ ref: `call:${id}`, kind: 'call' })
    return entries
  }

  serialize(): SerializedContext {
    return {
      vars: this.vars,
      turn: {
        tools: Object.fromEntries(this.tools),
        calls: Object.fromEntries(this.callsById),
      },
    }
  }
}

/**
 * Set a nested `var:*` leaf, creating intermediate objects along the dotted
 * path. `setNestedVar(vars, 'a', 'b.c', 1)` → `vars.a = { b: { c: 1 } }`.
 */
function setNestedVar(
  vars: Record<string, unknown>,
  root: string,
  path: string,
  value: unknown
): void {
  if (vars[root] === null || typeof vars[root] !== 'object') {
    vars[root] = {}
  }
  let node = vars[root] as Record<string, unknown>
  const segments = path.split('.')
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!
    if (node[segment] === null || typeof node[segment] !== 'object') {
      node[segment] = {}
    }
    node = node[segment] as Record<string, unknown>
  }
  node[segments[segments.length - 1]!] = value
}

/** Display-string coercion for interpolation (mirrors ECM's `formatForDisplay`). */
function formatForDisplay(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.map(formatForDisplay).join(', ')
  const obj = value as Record<string, unknown>
  if (typeof obj.name === 'string') return obj.name
  if (typeof obj.label === 'string') return obj.label
  if (typeof obj.displayName === 'string') return obj.displayName
  if (typeof obj.value === 'string') return obj.value
  return JSON.stringify(value)
}

/** Narrow an unknown `domainState[__context]` to a {@link SerializedContext}. */
function isSerializedContext(value: unknown): value is SerializedContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'vars' in value &&
    typeof (value as { vars: unknown }).vars === 'object'
  )
}

/** Read the persisted context slice off a `domainState` for store hydration. */
export function readContextSlice(
  domainState: Record<string, unknown> | undefined
): SerializedContext | undefined {
  const slice = domainState?.[CONTEXT_SLICE_KEY]
  return isSerializedContext(slice) ? slice : undefined
}

/**
 * Write the store's serialized state back onto `domainState` under
 * {@link CONTEXT_SLICE_KEY}. Called at every point `domainState` is persisted
 * (wired in Phase 2). On overflow of the coarse byte cap, drops the turn
 * sub-slice rather than persist an unbounded row.
 */
export function syncContextSlice(
  domainState: Record<string, unknown>,
  store: KopilotContextStore
): void {
  const slice = store.serialize()
  try {
    if (JSON.stringify(slice).length > MAX_CONTEXT_BYTES) {
      logger.warn('context slice exceeds byte cap — dropping turn capture sub-slice')
      domainState[CONTEXT_SLICE_KEY] = { vars: slice.vars } satisfies SerializedContext
      return
    }
  } catch {
    // Non-serializable (e.g. a circular captured result) — persist vars only.
    domainState[CONTEXT_SLICE_KEY] = { vars: slice.vars } satisfies SerializedContext
    return
  }
  domainState[CONTEXT_SLICE_KEY] = slice
}
