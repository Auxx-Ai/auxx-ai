// packages/lib/src/workflow-engine/catalog/types.ts

import type { z } from 'zod'
import type { WorkflowTriggerType } from '../core/types'

/**
 * The node catalog: one server-safe declaration of what a workflow node *is*,
 * shared by the builder (apps/web merges in the React parts via
 * `registerFromManifest`), the engine processors, and — later — Kopilot's
 * authoring tools. Replaces the three drifting copies (builder
 * `NodeDefinition`, engine shadow interfaces, and the parity suite's static
 * extraction) one migrated node type at a time; `not-yet-migrated.ts` is the
 * tracker.
 */

/**
 * UI node categories for organization.
 * Relocated from apps/web types/registry.ts (which re-exports it) so the
 * catalog can categorize without importing web code.
 */
export enum NodeCategory {
  TRIGGER = 'trigger',
  INPUT = 'input',
  CONDITION = 'condition',
  ACTION = 'action',
  TRANSFORM = 'transform',
  FLOW_CONTROL = 'flow_control',
  DATA = 'data',
  DATASET = 'dataset',
  INTEGRATION = 'integration',
  AI = 'ai',
  DEBUG = 'debug',
  UTILITY = 'utility',
}

/**
 * Per-field validation result a node validator returns.
 *
 * NOT the engine's `ValidationResult` (core/types.ts — `{ valid, errors:
 * string[] }`, a whole-workflow publish check). This is the builder-checklist
 * shape; apps/web types/registry.ts re-exports it under its historical name
 * `ValidationResult`.
 */
export interface NodeValidationResult {
  isValid: boolean
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
}

/** A branch handle a node exposes for a given config (if-else cases, fail branches, …). */
export interface NodeBranch {
  id: string
  name: string
  kind: 'default' | 'fail'
}

/**
 * Connection rules for a node type — how the canvas may wire it.
 * Mirrors the connection-related fields of the builder's `NodeDefinition`.
 */
export interface NodeConnectionRules<TConfig = unknown> {
  canConnect?: boolean
  canRunSingle?: boolean
  acceptsInputNodes?: boolean
  availableNextNodes?: string[]
  availablePrevNodes?: string[]
  maxIncomingConnections?: number
  maxOutgoingConnections?: number
  /**
   * Branch handles this node exposes for a given config. The single source
   * for the handle id the canvas renders AND the handle the processor emits —
   * asserted by the parity suite's handle checks.
   */
  branches?: (config: TConfig) => NodeBranch[]
}

/** Prompt-facing documentation consumed by agent-authoring tools (`describe_node_type`). */
export interface NodeAgentDocs {
  /** May Kopilot author this node type? Non-authorable types are read-only to the agent. */
  authorable: boolean
  /** Short usage guidance the tool returns verbatim. */
  usage: string
  examples: Array<{ description: string; config: unknown }>
}

/**
 * The data half of a workflow node definition — everything about a node type
 * that is not React. The web registry merges a manifest with its components
 * (`node.tsx` / `panel.tsx` / `trace-renderer.tsx`, which never move) via
 * `registerFromManifest`; server callers read manifests directly.
 */
export interface NodeManifest<TConfig = unknown> {
  /** NodeType value, e.g. 'wait' — the `data.type` persisted on graph nodes. */
  id: string
  category: NodeCategory
  displayName: string
  description: string
  /** Icon NAME only — apps/web resolves the actual component. */
  icon: string
  color?: string
  /** Dynamic icon name based on config (optional). */
  getIcon?: (config: TConfig) => string

  /** Only set for trigger nodes. */
  triggerType?: WorkflowTriggerType
  defaultData: () => Partial<TConfig>

  /**
   * Authoritative config schema. Unlike the legacy `NodeDefinition.schema`
   * (typed `any`, never parsed), manifests are held to `configSchema
   * .safeParse(defaultData())` by the catalog test, and later phases parse on
   * save.
   */
  configSchema: z.ZodType<TConfig>

  /**
   * Agent-facing projection of the SAME configuration, present only where the
   * persisted shape is hostile to a model (Tiptap docs, positional payload
   * items, `z.any()`). Absent ⇒ `configSchema` is used directly. Must never
   * admit something `configSchema` would reject after `fromAgentConfig`.
   */
  agentSchema?: z.ZodType
  fromAgentConfig?: (friendly: unknown, ctx: unknown) => TConfig

  validate: (config: TConfig) => NodeValidationResult
  extractVariables?: (config: TConfig) => string[]

  // resolveOutputs: OutputResolver<TConfig>
  // ^ deliberately deferred — output resolution gets a server-callable context
  //   in the next phase; adding the member now would force a design under
  //   time pressure. The web merge falls back to the legacy `outputVariables`
  //   until then.

  connection: NodeConnectionRules<TConfig>
  agent?: NodeAgentDocs
}
