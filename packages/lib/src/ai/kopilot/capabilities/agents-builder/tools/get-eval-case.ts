// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/get-eval-case.ts

import { simulationConfigSchema } from '@auxx/types/evals/schema'
import { z } from 'zod'
import { getEvalCaseById } from '../../../../../evals/queries'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'

const outputSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.string(),
  procedureId: z.string().nullable(),
  /** The full simulation config — scenario, subject identity, and `connectorMocks`. */
  config: simulationConfigSchema,
  /** Assertion definitions are read-only context; there is no tool to edit them. */
  assertions: z.array(z.object({ id: z.string(), type: z.string(), data: z.unknown() })),
})

/**
 * Read one eval case's full definition — the scenario config (opening message,
 * subject identity, `connectorMocks`) plus its assertions. The grounding read
 * for `update_eval_case_mock`: a mock edit must be proposed against the mock
 * ids and the case's own scenario, never guessed.
 */
export function createGetEvalCaseTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_eval_case',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'admin',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Read simulation case',
    surfaces: ['builder'],
    idempotent: true,
    description: `Read a simulation (eval) case's full definition: scenario config, subject identity, tool mocks (\`connectorMocks\`, with their ids), and assertions. Call it before \`update_eval_case_mock\` so a mock edit targets a real mock id and matches the case's own scenario. Assertions are read-only context.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['caseId'],
      properties: {
        caseId: { type: 'string', minLength: 1, description: 'The eval case id to read.' },
      },
    },
    outputSchema,
    exampleOutput: {
      id: 'case_example',
      name: 'Refund for damaged item',
      scope: 'procedure',
      procedureId: 'proc_example',
      config: {
        openingMessage: 'My mug arrived broken, I want a refund.',
        customerContext: 'Ordered a mug two days ago.',
        channel: 'chat',
        timeFrozenAt: null,
        maxCustomerTurns: 4,
        subject: {
          recordIds: [],
          identityVerified: false,
          claimed: { name: 'Alex Morgan', email: 'alex.morgan@example.com' },
        },
        startingFields: [],
        unmatchedToolPolicy: 'error',
        connectorMocks: [
          {
            id: 'mock_example',
            toolName: 'order_lookup',
            args: { mode: 'subset', value: { orderId: '1001' } },
            output: { id: '1001', status: 'delivered' },
            usage: 'repeat',
          },
        ],
      },
      assertions: [
        { id: 'a1', type: 'terminal_outcome', data: { outcome: 'finished' } },
        {
          id: 'a2',
          type: 'response_criteria',
          data: { criteria: ['Confirms the refund timeline'] },
        },
      ],
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps, 'view')
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const caseId = typeof args.caseId === 'string' ? args.caseId : ''
      if (!caseId) return { success: false, output: null, error: 'caseId is required.' }

      const found = await getEvalCaseById({ organizationId: agentDeps.organizationId, id: caseId })
      // Session-agent scoping on top of org scoping: a case id from another
      // agent reads as not-found rather than leaking cross-agent definitions.
      if (found.isErr() || !found.value || found.value.agentId !== ctx.agentId) {
        return { success: false, output: null, error: `Eval case not found: ${caseId}` }
      }
      const row = found.value

      const config = simulationConfigSchema.safeParse(row.config)
      if (!config.success) {
        return {
          success: false,
          output: null,
          error: 'Case config is malformed — fix it in the simulation case editor.',
        }
      }

      const target = row.target as { scope?: string } | null
      const assertions = (row.assertions as { id?: string; type?: string; data?: unknown }[])
        .filter((a) => typeof a?.id === 'string' && typeof a?.type === 'string')
        .map((a) => ({ id: a.id as string, type: a.type as string, data: a.data }))

      return {
        success: true,
        output: {
          id: row.id,
          name: row.name,
          scope: target?.scope ?? 'procedure',
          procedureId: row.procedureId,
          config: config.data,
          assertions,
        },
      }
    },
  }
}
