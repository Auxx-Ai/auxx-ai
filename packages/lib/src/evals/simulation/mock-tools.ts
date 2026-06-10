// packages/lib/src/evals/simulation/mock-tools.ts
//
// The load-bearing part of a Simulation: getting valid, consistent fake data
// back from tools so an eval never hits a real Shopify/Stripe backend. One
// primitive — a per-tool response (mirroring Fin's `data_connector_mocks`) —
// wraps each resolved `AgentToolDefinition` so `execute` (and `captureMint`)
// return the configured `output` instead of running for real. Matching is by
// `tool.name` in stored order, after domain input transforms and binding clamps
// (the engine clamps args BEFORE calling `execute`, so the wrapped `execute`
// already sees the effective invocation). See plans/evals/phase-1-agent-simulation.md §1.6.

import type { ArgMatch, SimulationToolMock } from '@auxx/types/evals'
import { deepEqual } from '@auxx/utils/objects'
import type { z } from 'zod'
import { toolCategory } from '../../agents/tool-visibility'
import type { ToolContext } from '../../ai/agent-framework/tool-context'
import type {
  AgentToolDefinition,
  AgentToolResult,
  ToolProgressPayload,
} from '../../ai/agent-framework/types'

export type UnmatchedToolPolicy = 'error' | 'passthrough_readonly'

/** Stable error code the wrapped tool returns when fail-closed and unmatched. */
export const UNMATCHED_MOCK_ERROR = 'unmatched_mock' as const

/**
 * One recorded tool invocation. The executor feeds these into the trace and the
 * grader's `tool_called` / `tool_not_called` checks. `args` are the EFFECTIVE
 * args (post domain transforms + binding clamps) the tool actually executed with.
 */
export interface ToolInvocationRecord {
  toolName: string
  args: Record<string, unknown>
  output: unknown
  /** Which mock matched, or `null` for tool-example / passthrough / unmatched. */
  mockId: string | null
  resolution: 'mock' | 'tool_example' | 'passthrough' | 'unmatched_error' | 'recorded'
  /** True iff produced through the capture path (engine wraps with `_captured`). */
  captured: boolean
}

// ── Argument matching ────────────────────────────────────────────────────

/**
 * Does a mock's optional arg matcher accept these effective args?
 * - no matcher → matches any call to the tool (name-only mock).
 * - `exact` → canonical (order-independent) deep equality of the whole object.
 * - `subset` → every configured key present and deep-equal; extra runtime keys allowed.
 */
export function argsMatch(matcher: ArgMatch | undefined, args: Record<string, unknown>): boolean {
  if (!matcher) return true
  if (matcher.mode === 'exact') return deepEqual(args, matcher.value)
  // subset
  return Object.entries(matcher.value).every(
    ([key, value]) => Object.hasOwn(args, key) && deepEqual(args[key], value)
  )
}

// ── Resolver (stateful: once/repeat consumption) ─────────────────────────

export interface MockMatch {
  mock: SimulationToolMock
  output: unknown
}

/**
 * Stateful matcher over the configured mocks. Evaluates mocks in stored order;
 * the first matching, not-yet-consumed mock wins. A `once` mock is consumed after
 * its first match; `repeat` persists. Distinct arg matchers let one tool return
 * different responses per call (order 1234 → found, 9999 → not found).
 */
export function createMockResolver(mocks: SimulationToolMock[]) {
  const consumed = new Set<string>()
  return {
    resolve(toolName: string, args: Record<string, unknown>): MockMatch | null {
      for (const mock of mocks) {
        if (mock.toolName !== toolName) continue
        if (consumed.has(mock.id)) continue
        if (!argsMatch(mock.args, args)) continue
        if (mock.usage === 'once') consumed.add(mock.id)
        return { mock, output: mock.output }
      }
      return null
    },
    /** Mocks never matched during the run — surfaced by `validate` as unused. */
    unusedMockIds(): string[] {
      // `repeat` mocks are never "consumed"; track matched ids separately.
      return mocks.filter((m) => m.usage === 'once' && !consumed.has(m.id)).map((m) => m.id)
    },
  }
}

// ── Tool wrapping ────────────────────────────────────────────────────────

export interface WrapToolsDeps {
  mocks: SimulationToolMock[]
  unmatchedPolicy: UnmatchedToolPolicy
  /** Called for every wrapped invocation (mock hit, passthrough, or unmatched). */
  onInvocation: (record: ToolInvocationRecord) => void
  /** Called when a fail-closed unmatched call occurs (marks the run UNMATCHED_MOCK). */
  onUnmatched: (toolName: string) => void
  /** Called when a real read-only passthrough runs (flips the run non-offline). */
  onPassthrough?: (toolName: string) => void
}

/**
 * Wrap a resolved effective toolset so each tool returns mocked data. The real
 * `execute` is bypassed. Resolution order per call: (1) a matched literal mock
 * returns `{ success: true, output }`; (2) a tool declaring `exampleOutput`
 * returns it (live default — repeat, any args); (3) the unmatched policy: fail
 * closed (`error`) or, under `passthrough_readonly`, run for real ONLY when
 * `tool.idempotent === true` (read-only) — writes are always bypassed. Gate
 * strictly on the tool's own `idempotent` flag, never a name list (conventions §6).
 *
 * `category: 'control'` tools (procedure/plan signals) pass through UNWRAPPED:
 * their `execute` is an in-memory signal write (`PROC_SIGNAL_KEY`) the stepper
 * needs and which is offline-safe. They aren't `idempotent`, so wrapping them
 * would fail the first unmatched `advance_procedure` closed and a procedure sim
 * could never advance past step 1. Same spirit as the `idempotent` carve-out:
 * gate on the tool's own declared `category`, not a name list. No invocation
 * record is emitted for them — the stepper-observer transition events are the
 * trace's representation of control flow.
 */
export function wrapToolsWithMocks(
  tools: AgentToolDefinition[],
  deps: WrapToolsDeps
): AgentToolDefinition[] {
  const resolver = createMockResolver(deps.mocks)
  return tools.map((tool) =>
    toolCategory(tool) === 'control' ? tool : wrapTool(tool, resolver, deps)
  )
}

function wrapTool(
  tool: AgentToolDefinition,
  resolver: ReturnType<typeof createMockResolver>,
  deps: WrapToolsDeps
): AgentToolDefinition {
  const execute: AgentToolDefinition['execute'] = async (args, ctx) => {
    const match = resolver.resolve(tool.name, args)
    if (match) {
      deps.onInvocation({
        toolName: tool.name,
        args,
        output: match.output,
        mockId: match.mock.id,
        resolution: 'mock',
        captured: false,
      })
      return { success: true, output: match.output }
    }

    // Live default: a tool that declares an `exampleOutput` returns it when no
    // literal mock matched. Referenced live from the rebuilt runtime (snapshots
    // store a manifest only), so it never goes stale. Deliberately wins over
    // `passthrough_readonly` — the offline, deterministic example beats a real
    // read-only call. See plans/evals/live-tool-default-mocks-plan.md.
    if (tool.exampleOutput !== undefined) {
      deps.onInvocation({
        toolName: tool.name,
        args,
        output: tool.exampleOutput,
        mockId: null,
        resolution: 'tool_example',
        captured: false,
      })
      return { success: true, output: tool.exampleOutput }
    }

    // Unmatched. `passthrough_readonly` lets a genuinely read-only tool run for
    // real; everything else (incl. all writes) fails closed.
    if (deps.unmatchedPolicy === 'passthrough_readonly' && tool.idempotent === true) {
      const real = await bufferExecute(tool, args, ctx)
      deps.onPassthrough?.(tool.name)
      deps.onInvocation({
        toolName: tool.name,
        args,
        output: real.output,
        mockId: null,
        resolution: 'passthrough',
        captured: false,
      })
      return real
    }

    deps.onUnmatched(tool.name)
    deps.onInvocation({
      toolName: tool.name,
      args,
      output: { error: UNMATCHED_MOCK_ERROR, toolName: tool.name },
      mockId: null,
      resolution: 'unmatched_error',
      captured: false,
    })
    return {
      success: false,
      output: { error: UNMATCHED_MOCK_ERROR, toolName: tool.name },
      error: `No mock matched tool "${tool.name}" and the unmatched policy is fail-closed`,
    }
  }

  // Capture mode (approvalMode: 'capture') predicts approval-tool output without
  // executing. Mirror the same mock resolution so a captured call sees mock data.
  const captureMint: AgentToolDefinition['captureMint'] = (args, mintCtx) => {
    const match = resolver.resolve(tool.name, args)
    if (match) {
      deps.onInvocation({
        toolName: tool.name,
        args,
        output: match.output,
        mockId: match.mock.id,
        resolution: 'mock',
        captured: true,
      })
      return match.output
    }
    // Prefer the tool's own mint — it can be args-aware (e.g. create-task echoes
    // its input), which a static example can't match. App tools' bridged mint IS
    // their example, so order only matters for native tools.
    if (tool.captureMint) return tool.captureMint(args, mintCtx)
    // Live-default fallback, mirroring `execute` (engine placeholder if absent).
    if (tool.exampleOutput !== undefined) {
      deps.onInvocation({
        toolName: tool.name,
        args,
        output: tool.exampleOutput,
        mockId: null,
        resolution: 'tool_example',
        captured: true,
      })
      return tool.exampleOutput
    }
    return undefined
  }

  return { ...tool, execute, captureMint }
}

/** Drain a possibly-streaming `execute` to its final `AgentToolResult`. */
async function bufferExecute(
  tool: AgentToolDefinition,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<AgentToolResult> {
  const ret = tool.execute(args, ctx)
  if (isAsyncGenerator(ret)) {
    let next = await ret.next()
    while (!next.done) next = await ret.next()
    return next.value
  }
  return ret
}

function isAsyncGenerator(
  value: Promise<AgentToolResult> | AsyncGenerator<ToolProgressPayload, AgentToolResult, void>
): value is AsyncGenerator<ToolProgressPayload, AgentToolResult, void> {
  return typeof (value as { next?: unknown }).next === 'function'
}

// ── Authoring helpers (validate / scaffold) ──────────────────────────────

export type MockOutputValidation =
  | { ok: true }
  | { ok: true; warning: string }
  | { ok: false; error: string }

/**
 * Validate a mock's `output` against the tool's declared `outputSchema` so a
 * malformed response can never reach the model. Tools without a declared schema
 * accept free-form output with a warning. Evals are the one place `outputSchema`
 * is enforced — at authoring time (production leaves tool output `unknown`).
 */
export function validateMockOutput(
  tool: Pick<AgentToolDefinition, 'name' | 'outputSchema'>,
  output: unknown
): MockOutputValidation {
  if (!tool.outputSchema) {
    return {
      ok: true,
      warning: `Tool "${tool.name}" declares no output schema; output is unchecked`,
    }
  }
  const parsed = tool.outputSchema.safeParse(output)
  if (parsed.success) return { ok: true }
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
  return { ok: false, error: `Mock output does not match "${tool.name}" output schema: ${issues}` }
}

/**
 * Best-effort valid-shaped skeleton from a Zod `outputSchema`, so an author edits
 * a correct starting point instead of a blank when the tool has no `exampleOutput`.
 * Defensive: anything it can't introspect collapses to `null`. The real guard is
 * {@link validateMockOutput} on save — this only seeds the editor.
 */
export function scaffoldFromSchema(schema: z.ZodType): unknown {
  try {
    return scaffold(schema as ZodLike)
  } catch {
    return null
  }
}

// Minimal structural view over Zod internals (v4 exposes `def`, older `_def`).
type ZodLike = { def?: ZodDef; _def?: ZodDef }
interface ZodDef {
  type?: string
  typeName?: string
  shape?: Record<string, ZodLike> | (() => Record<string, ZodLike>)
  element?: ZodLike
  innerType?: ZodLike
  values?: unknown[] | Record<string, unknown>
  entries?: Record<string, unknown>
  value?: unknown
  options?: ZodLike[]
}

function getDef(schema: ZodLike): ZodDef {
  return schema.def ?? schema._def ?? {}
}

function scaffold(schema: ZodLike): unknown {
  const def = getDef(schema)
  const kind = def.type ?? def.typeName

  switch (kind) {
    case 'object':
    case 'ZodObject': {
      const rawShape = typeof def.shape === 'function' ? def.shape() : def.shape
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(rawShape ?? {})) {
        out[key] = scaffold(child)
      }
      return out
    }
    case 'array':
    case 'ZodArray':
      return def.element ? [scaffold(def.element)] : []
    case 'string':
    case 'ZodString':
      return ''
    case 'number':
    case 'ZodNumber':
      return 0
    case 'boolean':
    case 'ZodBoolean':
      return false
    case 'null':
    case 'ZodNull':
      return null
    case 'literal':
    case 'ZodLiteral':
      return def.value ?? null
    case 'enum':
    case 'ZodEnum': {
      const values = Array.isArray(def.values)
        ? def.values
        : Object.values(def.values ?? def.entries ?? {})
      return values[0] ?? ''
    }
    case 'optional':
    case 'ZodOptional':
    case 'nullable':
    case 'ZodNullable':
      return def.innerType ? scaffold(def.innerType) : null
    case 'union':
    case 'ZodUnion':
      return def.options?.[0] ? scaffold(def.options[0]) : null
    default:
      return null
  }
}
