// packages/sdk/src/root/ai/types.ts

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
export interface AiToolConfig {
  /** When true, the tool is hidden from registration if no connection exists. */
  readonly requiresConnection?: boolean

  /**
   * Required when requiresConnection is true and the parent app has both user
   * and organization ConnectionDefinitions. Optional when the app has exactly
   * one — the build scanner infers from the app declaration in that case.
   */
  readonly connectionScope?: 'user' | 'organization'

  /**
   * Default false. Authors opt in for sensitive writes. A predicate variant
   * (e.g. `(args) => args.send !== false`) is allowed but in v1 it's serialized
   * by the build step into a catalog string and re-evaluated bridge-side.
   */
  readonly requiresApproval?: boolean | ((args: Record<string, unknown>) => boolean)

  /** Default 15000ms. Hard cap 30000ms enforced server-side. */
  readonly timeout?: number

  /** Read-only tools can opt-in. Bridge passes through to AgentToolDefinition. */
  readonly idempotent?: boolean
}

/**
 * AI tool definition. Authors produce this via `defineAiTool({...})`.
 *
 * The build scanner walks `app.ai.tools[].execute` to extract a module
 * reference (must be a default import from a `.server.ts` file) — same
 * rule as workflow blocks.
 */
export interface AiTool<
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
  readonly config?: AiToolConfig

  /**
   * Server-side executor. MUST be imported from a `.server.ts(x)` module
   * (enforced by the build scanner). The compiler infers `input` from
   * `inputs` and checks the return against `outputs`.
   */
  readonly execute: (
    input: z.input<TInput>,
    ctx: AiToolExecuteContext
  ) => Promise<z.output<TOutput>> | AsyncGenerator<unknown, z.output<TOutput>>
}

/**
 * Toolset declaration — groups tools for agent-side enablement filters.
 * The platform projects `<appSlug>.<localId>` into the runtime slug namespace
 * as `app:<appSlug>:<localId>`. See plans/kopilot/apps/README.md §4.4.
 */
export interface AiToolset {
  /** `<appSlug>.<localId>` convention; runtime slug is `app:<appSlug>:<localId>`. */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon?: string | ComponentType
  /** Tool ids belonging to this toolset. */
  readonly tools: readonly string[]
  /** Included in master-Kopilot auto-on when true. */
  readonly isDefault?: boolean
}

/**
 * Lambda-side execution context for AI tools. The full surface lives in
 * the lambda runtime SDK (auth, fetch, connections, entities). This type
 * is intentionally permissive at the SDK layer — runtime injects the real
 * implementations. See plans/kopilot/agents/tool-loading-and-execution.md §7.
 */
export interface AiToolExecuteContext {
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
