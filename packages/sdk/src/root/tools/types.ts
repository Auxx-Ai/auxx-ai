// packages/sdk/src/root/tools/types.ts

import type { ComponentType } from 'react'
import type { z } from 'zod/v4'

/**
 * Entity ref kinds for fence-resolvable id fields in tool outputs.
 * Maps to system semantics on EntityDefinition (entityType / standardType).
 * See plans/kopilot/apps/refs.md §3.
 */
export type EntityRefKind =
  | 'contact'
  | 'company'
  | 'deal'
  | 'ticket'
  | 'task'
  | 'user'
  | 'article'
  | 'thread'

/**
 * Per-tool configuration. See plans/kopilot/apps/README.md §4.2.
 */
export interface ToolConfig {
  /** When true, the tool is hidden from registration if no connection exists. */
  readonly requiresConnection?: boolean

  /**
   * Default 15000ms. Hard cap 30000ms for buffered tools, 120000ms for
   * streaming tools (see plans/kopilot/apps/README.md §10).
   */
  readonly timeout?: number

  /** Read-only tools can opt-in. Bridge passes through to AgentToolDefinition. */
  readonly idempotent?: boolean

  /**
   * Author opt-in: this tool's `execute` returns an `AsyncGenerator` and
   * should be invoked through the streaming lambda endpoint
   * (`/ai-tool/stream`). Yields are forwarded as `tool-progress` agent
   * events; the generator's return value becomes the tool result.
   *
   * The runtime can also detect a generator return at execution time, but
   * the platform bridge needs to know at registration time which caller
   * (`invokeLambdaExecutor` vs `invokeLambdaExecutorStreaming`) to use, so
   * authors must declare it explicitly. See plans/kopilot/apps/README.md §6.
   */
  readonly streaming?: boolean
}

/**
 * Tool definition. Authors produce this via `defineTool({...})`.
 *
 * The build scanner walks `app.tools[].execute` to extract a module
 * reference (must be a default import from a `.tool.server.ts` file) — same
 * rule as workflow blocks.
 */
export interface ToolDefinition<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** Tool id — must match `^[a-zA-Z0-9_-]{1,64}$`. */
  readonly id: string

  /** Human-readable name shown in toolset listings. */
  readonly name: string

  /** Sent to the LLM as the tool description — should read like a hint. */
  readonly description: string

  /** Inline icon (component or image import) for UI surfaces. */
  readonly icon?: string | ComponentType

  /** Zod input schema. Converted to provider JSON Schema at registration. */
  readonly inputs: TInput

  /** Zod output schema. Output refs marker-fields are mined for fences. */
  readonly outputs: TOutput

  /** Runtime/auth configuration. */
  readonly config?: ToolConfig

  /**
   * Server-side executor. MUST be imported from a `.tool.server.ts(x)` module
   * (enforced by the build scanner). The compiler infers `input` from
   * `inputs` and checks the return against `outputs`.
   */
  readonly execute: (
    input: z.input<TInput>,
    ctx: ToolExecuteContext
  ) => Promise<z.output<TOutput>> | AsyncGenerator<unknown, z.output<TOutput>>
}

/**
 * Toolset declaration — groups tools for agent-side enablement filters.
 * The platform projects `<appSlug>.<localId>` into the runtime slug namespace
 * as `app:<appSlug>:<localId>`. See plans/kopilot/apps/README.md §4.4.
 *
 * No `isDefault` flag — admins pick every toolset deliberately at
 * agent-creation time, which doubles as the write-approval gate.
 * See plans/kopilot/apps/gog-calendar-overhaul.md §0.
 */
export interface Toolset {
  /** `<appSlug>.<localId>` convention; runtime slug is `app:<appSlug>:<localId>`. */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon?: string | ComponentType
  /** Tool ids belonging to this toolset. */
  readonly tools: readonly string[]
  /**
   * Optional grouping under the app row in the Tools tab. Free-form string —
   * toolsets sharing the same `subGroup` render under a collapsible header.
   * Omitted/null means the toolset hangs directly under the app row.
   */
  readonly subGroup?: string
}

/**
 * Lambda-side execution context for tools. The full surface lives in
 * the lambda runtime SDK (auth, fetch, connections, entities). This type
 * is intentionally permissive at the SDK layer — runtime injects the real
 * implementations. See plans/kopilot/agents/tool-loading-and-execution.md §7.
 */
export interface ToolExecuteContext {
  readonly organizationId: string
  readonly userId: string | null
  readonly appInstallationId: string
  readonly sessionId: string
  readonly agentId: string | null
  readonly triggerId: string | null
  /**
   * Lookup helper for `refs.entity('...')` resolution from integration ids.
   * Returns the auxx record (`<defId>:<instId>`) or null when not imported.
   * See plans/kopilot/apps/refs.md §4.1.
   */
  readonly entities: {
    findByIntegrationId: (input: {
      kind: EntityRefKind
      source: string
      externalId: string
    }) => Promise<{ recordId: string; displayName: string | null } | null>
  }
}
