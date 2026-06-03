// packages/sdk/src/root/tools/types.ts

import type { ComponentType } from 'react'
import type { z } from 'zod/v4'

/**
 * An entity instance resolved from the thread context (passed to
 * `ToolActionSurface` callbacks). Generic shape — works for any entity
 * definition (ticket, contact, order, company, custom).
 */
export interface ToolActionEntity {
  id: string
  entityDefinitionId: string
  /** Entity definition slug (e.g., "shopify-order", "company") */
  entityDefinitionSlug: string
  displayName: string
  /** Custom field values, keyed by field slug */
  fields: Record<string, unknown>
}

/**
 * A thread participant with optional linked contact entity.
 */
export interface ToolActionParticipant {
  email: string
  name?: string
  isInternal: boolean
  /** Linked contact entity (if resolved) */
  contact?: ToolActionEntity
}

/**
 * Context provided to a tool's `action` surface callbacks.
 * Built by the platform — never constructed by the author.
 */
export interface ToolActionContext {
  /** The thread being replied to */
  threadId: string

  /** Ticket entity instance linked to this thread (if any) */
  ticket?: ToolActionEntity

  /** Thread participants */
  participants: ToolActionParticipant[]

  /**
   * All entity instances associated with the thread context.
   * Includes ticket, contacts, and any entities linked via relationship fields
   * (e.g., a Shopify order linked on the ticket, a company linked on the contact).
   */
  entities: ToolActionEntity[]
}

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
   * (`/tool/stream`). Yields are forwarded as `tool-progress` agent
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
 * Agent-surface projection of a tool — opt in by setting `tool.agent = {…}`.
 * Presence of this key exposes the tool to the LLM as a callable function.
 */
export interface ToolAgentSurface {
  /** LLM-facing name (snake_case convention, e.g. `send_whatsapp_text`). */
  readonly name?: string
  /** LLM-facing description — hint-style, written for model consumption. */
  readonly description?: string
  /** Toolset for agent-side enablement grouping. */
  readonly toolsetSlug?: string
  /** Author opt-in: execute returns AsyncGenerator. */
  readonly streaming?: boolean
  /** LLM hint for read-only tools. */
  readonly idempotent?: boolean
  /**
   * Soft hint: is this tool appropriate to *recommend* for a visitor-facing
   * chat-kind agent? Default (absent) = false. NOT a security gate in v6 — the
   * admin explicitly adding a tool is the coarse gate. Drives builder-Kopilot
   * recommendations and picker decluttering only. Read-only customer-scoped
   * reads set `true`; mutating/admin tools set `false`. See plans/chat/v6
   * phase-3.
   */
  readonly chatSafe?: boolean
  /**
   * Input args that carry caller identity / record scope. In a visitor (chat)
   * invocation each MUST be bound to a restriction or the engine refuses the
   * call (fail-closed). Ignored on internal invocations. Scalar top-level arg
   * names only in v6. `suggestedVar` lets the app point an arg at the var it
   * itself contributes (phase 2) so the UI can pre-fill the binding at
   * tool-enable time — e.g. Shopify's `list_customer_orders` declares
   * `{ name: 'customerId', suggestedVar: 'visitor.shopify.customerId' }`.
   * See plans/chat/v6 phase-3.
   */
  readonly identityScopedInputs?: ReadonlyArray<{
    name: string
    /** Registry var key to pre-fill in the Add-Restriction flow. */
    suggestedVar?: string
  }>
}

/**
 * Action-surface projection of a tool — opt in by setting `tool.action = {…}`.
 * Presence of this key exposes the tool as an action button in the ticket /
 * email-editor context.
 */
export interface ToolActionSurface {
  /** Display label shown on the action chip. */
  readonly label: string
  readonly description?: string
  readonly icon?: string | ComponentType
  readonly color?: string
  readonly surface: 'ticket-header' | 'email-editor'
  readonly requiresConfirmation?: boolean
  readonly confirmationMessage?: string
  readonly shouldShow?: (ctx: ToolActionContext) => boolean
  readonly getDefaults?: (ctx: ToolActionContext) => Record<string, unknown>
}

/**
 * Tool definition. Authors produce this via `defineTool({...})`.
 *
 * A tool is the atomic unit of behavior. It opts into being surfaced via
 * explicit keys — `agent` (LLM-callable) and `action` (quick-action button).
 * A tool with no surface key is internal — invocable only from a workflow
 * block's dispatcher.
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

  /** Surface key — exposes the tool to the LLM as a callable function. */
  readonly agent?: ToolAgentSurface

  /** Surface key — exposes the tool as a quick-action button. */
  readonly action?: ToolActionSurface
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
 * Lambda-side execution context for tools. Intentionally minimal — entity
 * lookups and value I/O are delivered as `@auxx/sdk/server` functions
 * (`findByIntegrationId`, `getFieldValue`, `setFieldValues`, …), not on `ctx`.
 * See plans/kopilot/agents/tool-loading-and-execution.md §7.
 */
export interface ToolExecuteContext {
  readonly organizationId: string
  readonly userId: string | null
  readonly appInstallationId: string
  readonly sessionId: string
  readonly agentId: string | null
  readonly triggerId: string | null
}
