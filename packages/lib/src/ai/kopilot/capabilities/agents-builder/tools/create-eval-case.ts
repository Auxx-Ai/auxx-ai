// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/create-eval-case.ts

import type { AgentEvalTarget } from '@auxx/types/evals'
import { z } from 'zod'
import { listAgentProceduresForAuthoring } from '../../../../../agents/procedures/authoring'
import {
  buildSimulationCaseFromAuthoring,
  resolveAgentMockToolContext,
} from '../../../../../evals/authoring'
import { createEvalCase } from '../../../../../evals/queries'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'

const outputSchema = z.object({
  caseId: z.string(),
  name: z.string(),
  scope: z.enum(['procedure', 'agent']),
  procedureId: z.string().nullable(),
  assertionCount: z.number(),
  mockCount: z.number(),
})

/**
 * Author a NEW simulation (eval) case — scenario, tool mocks, and assertions —
 * and persist it against the session agent. Approval-gated: the admin reviews
 * the proposed scenario + assertions + mocks before it lands, so authoring a
 * test the model will later be graded against still has a human in the loop.
 *
 * The model authors the same flat shape the suggester emits; it runs through the
 * shared `buildSimulationCaseFromAuthoring` validator (canonical tool names,
 * mock outputs checked against each tool's real schema, the safe-4 assertion
 * allowlist, final schema gate). To repair an EXISTING case's fixtures use
 * `update_eval_case_mock` instead.
 */
export function createCreateEvalCaseTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_eval_case',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'admin',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Create simulation case',
    surfaces: ['builder'],
    requiresApproval: true,
    description: `Create a NEW simulation (eval) case for this agent: a scenario the synthetic customer plays, optional tool mocks, and assertions checked after the run. Pass \`procedureId\` to scope the case to one procedure (the normal case while authoring a procedure — cover the happy path, each branch, and a missing-info case); omit it for a whole-conversation agent-scoped case. Assertions are limited to: terminal_outcome (finished | handoff | switch), response_criteria (each criterion one checkable statement), tool_called, tool_not_called. Provide a mock only when a path needs a tool to return something OTHER than its declared example (e.g. order-not-found); \`toolName\` must be the exact backticked identifier from the tool list. Mocks model reality — never shape one to force an assertion to pass. To fix an existing case's mocks use \`update_eval_case_mock\`.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'openingMessage', 'customerContext', 'channel', 'assertions'],
      properties: {
        procedureId: {
          type: 'string',
          minLength: 1,
          description:
            'Attached procedure to scope the case to. Omit for an agent-scoped (whole-conversation) case.',
        },
        name: {
          type: 'string',
          minLength: 1,
          description:
            'Short label naming the path under test, ≤5 words (e.g. "Missing order number").',
        },
        openingMessage: {
          type: 'string',
          minLength: 1,
          description: "The customer's first message, verbatim.",
        },
        customerContext: {
          type: ['string', 'null'],
          description:
            'What the customer knows, wants, and refuses to provide, so the persona can play the path. Use concrete values (order numbers, names) — never placeholders like "[redacted]".',
        },
        claimed: {
          type: 'object',
          additionalProperties: false,
          description:
            'Identity the customer states when asked. Concrete values, or null for a path that needs no identity.',
          properties: {
            name: { type: ['string', 'null'] },
            email: { type: ['string', 'null'] },
          },
        },
        channel: { type: 'string', enum: ['chat', 'email'] },
        maxCustomerTurns: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'How many turns the synthetic customer may take. Defaults to 4.',
        },
        mocks: {
          type: 'array',
          description: 'Tool mocks — only for paths needing a non-default tool output.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['toolName', 'output'],
            properties: {
              toolName: { type: 'string', minLength: 1 },
              output: {
                type: 'string',
                description: "The tool's mock output, encoded as a JSON string.",
              },
            },
          },
        },
        assertions: {
          type: 'array',
          minItems: 1,
          description:
            'At least one assertion. Per-type fields: set the ones the type needs, null the rest.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: {
                type: 'string',
                enum: ['terminal_outcome', 'response_criteria', 'tool_called', 'tool_not_called'],
              },
              outcome: { type: ['string', 'null'], enum: ['finished', 'handoff', 'switch', null] },
              criteria: { type: ['array', 'null'], items: { type: 'string' } },
              toolName: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    outputSchema,
    exampleOutput: {
      caseId: 'case_example',
      name: 'Missing order number',
      scope: 'procedure',
      procedureId: 'proc_example',
      assertionCount: 2,
      mockCount: 1,
    },
    buildDigest: (output) => {
      const o = output as { caseId?: string; name?: string } | null
      return { caseId: o?.caseId, name: o?.name }
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps)
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }
      const { agentId } = ctx
      const { organizationId, userId } = agentDeps

      // Resolve the case target. A procedureId scopes it to that procedure and
      // pins a version (active if published, else the working draft so cases work
      // mid-build); omitting it makes a whole-conversation agent-scoped case.
      const procedureId = typeof args.procedureId === 'string' ? args.procedureId : null
      let target: AgentEvalTarget
      if (procedureId) {
        const procs = await listAgentProceduresForAuthoring({ organizationId, agentId })
        if (procs.isErr()) {
          return { success: false, output: null, error: 'Could not load the agent’s procedures.' }
        }
        const proc = procs.value.find((p) => p.procedureId === procedureId)
        if (!proc) {
          return {
            success: false,
            output: null,
            error: `Procedure not attached to this agent: ${procedureId}`,
          }
        }
        const procedureVersionId = proc.activeVersionId ?? proc.draftVersionId
        if (!procedureVersionId) {
          return {
            success: false,
            output: null,
            error: 'Procedure has no version to pin yet — add a step to it first.',
          }
        }
        target = {
          kind: 'agent_simulation',
          scope: 'procedure',
          agentId,
          procedureId,
          procedureVersionId,
        }
      } else {
        target = { kind: 'agent_simulation', scope: 'agent', agentId }
      }

      // Resolve the agent's mock-targetable toolset (shared with the suggester),
      // then map+validate the authored shape through the one shared builder.
      let toolMap: Awaited<ReturnType<typeof resolveAgentMockToolContext>>['toolMap']
      try {
        ;({ toolMap } = await resolveAgentMockToolContext({
          organizationId,
          userId,
          agentId,
          sessionId: `eval-create-${agentId}`,
        }))
      } catch {
        return { success: false, output: null, error: 'Could not build the agent runtime.' }
      }

      const authored = {
        name: args.name,
        openingMessage: args.openingMessage,
        customerContext: args.customerContext ?? null,
        claimed: args.claimed,
        channel: args.channel,
        maxCustomerTurns: typeof args.maxCustomerTurns === 'number' ? args.maxCustomerTurns : 4,
        mocks: Array.isArray(args.mocks) ? args.mocks : [],
        assertions: Array.isArray(args.assertions) ? args.assertions : [],
      }
      const built = buildSimulationCaseFromAuthoring(authored, toolMap)
      if (built.isErr()) {
        return { success: false, output: null, error: built.error }
      }

      const created = await createEvalCase({
        organizationId,
        createdById: userId,
        name: built.value.name,
        target,
        config: built.value.config,
        assertions: built.value.assertions,
      })
      if (created.isErr()) {
        return {
          success: false,
          output: null,
          error: `Failed to create case: ${created.error.message}`,
        }
      }

      return {
        success: true,
        output: {
          caseId: created.value.id,
          name: built.value.name,
          scope: procedureId ? ('procedure' as const) : ('agent' as const),
          procedureId,
          assertionCount: built.value.assertions.length,
          mockCount: built.value.config.connectorMocks.length,
        },
      }
    },
  }
}
