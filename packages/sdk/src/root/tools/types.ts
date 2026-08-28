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
 *
 * Admission rule: an entity a user thinks about and could open — business
 * records, not join rows or ledger lines. So no `line_item`, `subpart`,
 * `stock_movement`, `purchase_order_line`, `vendor_bill_line` or
 * `gl_posting_line`. `quote` / `work_order` / `payment` / `vendor_payment`
 * would qualify under the rule but wait for a consumer.
 *
 * 🛑 The HAZARD the rule guards against is admitting a kind **no org
 * resolves**: `provisionAppField` warns-and-skips when `getCachedEntityDefId`
 * returns nothing, so an app author declares a field, sees no error, and gets
 * nothing. Every kind below must therefore be a system def seeded into EXISTING
 * orgs by an entity migration, not merely present in `SYSTEM_ENTITIES` (which
 * `ensureEntityDefinitions` only ever INSERTs, so it reaches fresh orgs alone).
 * `order` is seeded by entity-migration **107**; `purchase_order`,
 * `vendor_bill` and `gl_account` by **108**; `build` by **109**;
 * `gl_posting` by **103**.
 *
 * 🛑 `deal`, `task` and `user` were REMOVED 2026-08-28 — they were the hazard
 * above, shipping. None of the three has an `EntityDefinition` row in any org
 * (verified across all 28) and none is in `SYSTEM_ENTITIES`, so every field an
 * app declared against them was warned-and-skipped in silence. Removing them
 * is a breaking SDK change made deliberately: it converts that silent runtime
 * no-op into a compile error, which is the only place the author can act on it.
 * Verified before removal — no reference in the platform repo, none in
 * `auxxai-apps`, and no stored `targetEntity` among 45 `AppDeployment` rows.
 * **Do not re-add any of them without seeding the def by an entity migration
 * in the same change.**
 *
 * ⚠️ `gl_posting` and `gl_account` are the two deliberate EXCEPTIONS to the
 * rule, flagged rather than quietly folded in. Both are `isVisible: false` and
 * machine-written, and `gl_posting` IS a ledger header — a user never opens
 * either. They are admitted because provider identity hangs off them:
 * the QuickBooks app must put a connection-scoped `qboJournalEntryId` identity
 * field on `gl_posting` (gap-b §6.2), which is what makes double-posting to the
 * general ledger unrepresentable rather than merely detectable; and money
 * decision `P2` keys every posting line on an account **CODE**, so the
 * provider's own account id lives in `RecordIdentity` hung off `gl_account`.
 * That is precisely the "an app addresses this record" case the union exists
 * for. Note this also widens `ref.entity(kind)`, the app TOOL surface, which is
 * the part of the trade worth revisiting if the rule is ever tightened.
 */
export type EntityRefKind =
  | 'contact'
  | 'company'
  | 'ticket'
  | 'article'
  | 'thread'
  | 'order'
  | 'invoice'
  | 'catalog_item'
  | 'part'
  | 'product'
  | 'build'
  | 'purchase_order'
  | 'vendor_bill'
  | 'gl_account'
  | 'gl_posting'

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
 * Where an agent tool may run — mirrors the host's `AgentSurface`. An app tool
 * is offered on every surface by default; narrow it only when it makes no sense
 * in a context. NOT a security boundary. See
 * plans/chat/v6/chat-tool-availability.md.
 */
export type AgentSurface = 'internal' | 'chat' | 'email' | 'builder'

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
   * Surfaces this tool is offered on (allow-list). Absent ⇒ every surface.
   * Narrow it only when the tool makes no sense in a context. NOT a security
   * gate — the admin adding the tool to an agent is. See
   * plans/chat/v6/chat-tool-availability.md.
   */
  readonly surfaces?: AgentSurface[]
  /**
   * Advisory: verified safe for an untrusted, externally-identified caller
   * (anonymous chat visitor / email sender). Absent ⇒ the chat/email Tools UI
   * flags it with a warning. An identity-scoped read (see `inputBindings`) is
   * the typical opt-in. Replaces `chatSafe`; not a gate. See
   * plans/chat/v6/chat-tool-availability.md.
   */
  readonly externalSafe?: boolean
  /**
   * Per-input **default** binding (plans/chat/v8 phase-3). The platform resolves
   * each from the turn's subject and clamps it onto the args before `execute`;
   * the model never supplies a bound input. The admin can override per agent.
   * Absence ⇒ the model supplies the input normally.
   *
   * An app tool references a field it owns via the `@app:<slug>:<key>` segment —
   * the author knows its own slug + field key at author time; the *connection*
   * is resolved at turn time. Top-level scalar input names only.
   *
   * e.g. Shopify's order lookup ships
   * `{ name: 'customerId', default: { kind: 'var', ref: 'contact:@app:shopify:customerId' } }`.
   * Structurally typed here — the runtime narrows `ref` to a `VarRef`.
   */
  readonly inputBindings?: ReadonlyArray<{
    name: string
    default:
      | { kind: 'var'; ref: string | readonly string[] }
      | { kind: 'const'; value: unknown }
      | { kind: 'model' }
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
  /**
   * Per-input presentation overrides for the quick-action form, keyed by
   * top-level input name. Does NOT replace the Zod input schema — that stays the
   * source of truth for validation. The annotation only layers presentation +
   * option-resolution metadata onto named inputs. Absent inputs render from the
   * JSON Schema as usual. See plans/actions/09-dynamic-action-inputs.md.
   */
  readonly inputs?: Record<string, ActionInputHint>
}

/**
 * A presentation override for a single quick-action input. Discriminated by
 * `kind` so new control flavors (`currency`, `entity-picker`, …) can be added
 * without breaking existing readers.
 */
export type ActionInputHint = { kind: 'dynamic-select'; dynamicSelect: DynamicSelectHint }

/**
 * Loads a select field's options at form-open time by running an app resolver
 * tool, scoped to the thread's contact. The human-form analog of
 * `ToolAgentSurface.inputBindings`. See plans/actions/09-dynamic-action-inputs.md.
 */
export interface DynamicSelectHint {
  /** Local tool id (same app) whose execute() returns the candidate list. */
  readonly optionsFrom: string
  /**
   * Maps the resolver tool's inputs to var refs resolved against the thread's
   * contact — same ref grammar as `ToolAgentSurface.inputBindings`
   * (e.g. `{ stripeCustomerId: 'contact:@app:stripe:customerId' }`).
   */
  readonly bindArgsFrom?: Record<string, string>
  /** Constant args merged into the resolver call (e.g. `{ limit: 20 }`). */
  readonly args?: Record<string, unknown>
  /**
   * Path into each output item that becomes the field's stored value. The
   * resolver output is treated as an array; if it's an object, `itemsPath`
   * selects the array first.
   */
  readonly valuePath: string
  readonly itemsPath?: string
  /** `{field}` template over each item for the option label. */
  readonly labelTemplate: string
  /** Optional `{field}` template for a dimmer secondary line. */
  readonly sublabelTemplate?: string
  /** Text shown disabled when no options resolve. */
  readonly emptyHint?: string
  /**
   * When true, the resolved tool options are treated as **suggestions** rather
   * than a whitelist: the field also commits a free-text value the resolver
   * never returned (a *creatable* select). Use for open identifiers like an
   * `owner/repo` full-name; leave off for closed pickers that must match a real
   * remote record (e.g. a Shopify collection).
   */
  readonly allowCustom?: boolean
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

  /**
   * One realistic example of this tool's success output. Authored once by the
   * tool owner; reused by eval autofill, capture/headless mode, and docs.
   * Must satisfy `outputs` (validated at compile/extract time) and be
   * JSON-serializable. For outputs containing `refs.entity(...)` marker fields,
   * use `null` or a sample `RecordId`. See plans/evals/tool-example-outputs.md.
   */
  readonly exampleOutput?: z.output<TOutput>

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
