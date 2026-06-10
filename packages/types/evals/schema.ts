// packages/types/evals/schema.ts
//
// Zod schemas for the persisted Evals contracts. Parse all JSONB values through
// these at service boundaries (`@auxx/lib/evals`) and in web form resolvers, so
// a malformed `target` / `config` / `assertions` blob can never reach the engine.
// Zod 4 — use `z.enum`, never `nativeEnum`.

import { z } from 'zod'
import type { FieldReference } from '../field'
import { recordIdSchema } from '../resource/schema'
import type {
  AgentEvalAssertion,
  AgentEvalTarget,
  ArgMatch,
  AssertionResult,
  Comparator,
  EvalTraceEvent,
  SimulationConfig,
  SimulationToolMock,
} from './index'

/**
 * `FieldReference` is `FieldId | ResourceFieldId | FieldPath` — a plain string
 * or a non-empty array of strings. There's no canonical schema in `../field`, so
 * validate structurally here.
 */
export const fieldReferenceSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]) as unknown as z.ZodType<FieldReference>

export const comparatorSchema = z.union([
  z.object({ op: z.literal('equals') }),
  z.object({ op: z.literal('not_equals') }),
  z.object({ op: z.literal('exists') }),
  z.object({ op: z.literal('not_exists') }),
  z.object({ op: z.literal('contains') }),
  z.object({
    op: z.enum(['gt', 'gte', 'lt', 'lte']),
    tolerance: z.number().optional(),
  }),
]) satisfies z.ZodType<Comparator>

export const argMatchSchema = z.object({
  mode: z.enum(['exact', 'subset']),
  value: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<ArgMatch>

// ---- Target ----

export const agentEvalTargetSchema = z.discriminatedUnion('scope', [
  z.object({
    kind: z.literal('agent_simulation'),
    scope: z.literal('procedure'),
    agentId: z.string().min(1),
    procedureId: z.string().min(1),
    procedureVersionId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('agent_simulation'),
    scope: z.literal('agent'),
    agentId: z.string().min(1),
  }),
]) satisfies z.ZodType<AgentEvalTarget>

// ---- Assertions ----

const assertionIdSchema = z.string().min(1)

export const agentEvalAssertionSchema = z.discriminatedUnion('type', [
  z.object({
    id: assertionIdSchema,
    type: z.literal('terminal_outcome'),
    data: z.object({ outcome: z.enum(['finished', 'handoff', 'switch']) }),
  }),
  z.object({
    id: assertionIdSchema,
    type: z.literal('procedure_selected'),
    data: z.object({ procedureId: z.string().min(1) }),
  }),
  z.object({
    id: assertionIdSchema,
    type: z.literal('response_criteria'),
    data: z.object({ criteria: z.array(z.string().min(1)).min(1) }),
  }),
  z.object({
    id: assertionIdSchema,
    type: z.literal('crm_field'),
    data: z.object({
      ref: fieldReferenceSchema,
      comparator: comparatorSchema,
      expected: z.unknown().optional(),
    }),
  }),
  z.object({
    id: assertionIdSchema,
    type: z.literal('local_variable'),
    data: z.object({
      name: z.string().min(1),
      comparator: comparatorSchema,
      expected: z.unknown().optional(),
    }),
  }),
  z.object({
    id: assertionIdSchema,
    type: z.literal('tool_called'),
    data: z.object({ toolName: z.string().min(1), args: argMatchSchema.optional() }),
  }),
  z.object({
    id: assertionIdSchema,
    type: z.literal('tool_not_called'),
    data: z.object({ toolName: z.string().min(1), args: argMatchSchema.optional() }),
  }),
]) satisfies z.ZodType<AgentEvalAssertion>

/** Persisted cases reject empty assertion lists (conventions §9). */
export const agentEvalAssertionsSchema = z.array(agentEvalAssertionSchema).min(1)

// ---- Simulation config ----

export const simulationToolMockSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  args: argMatchSchema.optional(),
  output: z.unknown(),
  usage: z.enum(['once', 'repeat']),
}) satisfies z.ZodType<SimulationToolMock>

export const simulationConfigSchema = z.object({
  openingMessage: z.string().min(1),
  customerContext: z.string().nullable(),
  channel: z.enum(['chat', 'email']),
  timeFrozenAt: z.string().nullable(),
  maxCustomerTurns: z.number().int().positive(),
  subject: z.object({
    recordIds: z.array(recordIdSchema),
    identityVerified: z.boolean(),
    claimed: z.object({ name: z.string().optional(), email: z.string().optional() }).optional(),
    claimedManual: z
      .object({ name: z.boolean().optional(), email: z.boolean().optional() })
      .optional(),
  }),
  startingFields: z.array(z.object({ ref: fieldReferenceSchema, value: z.unknown() })),
  unmatchedToolPolicy: z.enum(['error', 'passthrough_readonly']),
  connectorMocks: z.array(simulationToolMockSchema),
}) satisfies z.ZodType<SimulationConfig>

// ---- Trace & results ----

export const evalTraceEventSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string(),
  kind: z.enum(['agent', 'workflow', 'system']),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<EvalTraceEvent>

export const assertionResultSchema = z.object({
  assertionId: z.string().min(1),
  type: z.string(),
  definition: z.unknown(),
  status: z.enum(['passed', 'failed', 'error']),
  actual: z.unknown().optional(),
  note: z.string().optional(),
}) satisfies z.ZodType<AssertionResult>
