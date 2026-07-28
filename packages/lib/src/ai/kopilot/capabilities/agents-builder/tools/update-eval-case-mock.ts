// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/update-eval-case-mock.ts

import type { SimulationToolMock } from '@auxx/types/evals'
import { simulationConfigSchema } from '@auxx/types/evals/schema'
import { generateId } from '@auxx/utils'
import { z } from 'zod'
import { validateAgentToolMock } from '../../../../../evals/editor-support'
import { getEvalCaseById, updateEvalCase } from '../../../../../evals/queries'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveProcedureAuthoring } from './procedure-authoring-guard'

const outputSchema = z.object({
  caseId: z.string(),
  /** The case's full mock list after the edit. */
  mocks: z.array(z.object({ id: z.string(), toolName: z.string(), usage: z.string() })),
  /** Non-blocking validation warnings (e.g. a tool without an output schema). */
  warnings: z.array(z.string()),
})

interface UpsertMockArg {
  id?: string
  toolName: string
  args?: { mode: 'exact' | 'subset'; value: Record<string, unknown> }
  output: unknown
  usage?: 'once' | 'repeat'
}

function parseUpsertMocks(raw: unknown): UpsertMockArg[] | string {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return 'upsertMocks must be an array.'
  const parsed: UpsertMockArg[] = []
  for (const entry of raw as Record<string, unknown>[]) {
    if (typeof entry?.toolName !== 'string' || entry.toolName.length === 0) {
      return 'Every upserted mock needs a toolName.'
    }
    if (!('output' in entry)) {
      return `Mock for "${entry.toolName}" is missing an output.`
    }
    parsed.push(entry as unknown as UpsertMockArg)
  }
  return parsed
}

/**
 * Repair a case's tool mocks (`connectorMocks`) — the ONLY eval-case surface
 * Kopilot can write. Approval-gated: the admin reviews the proposed mock diff
 * before it lands. Assertions stay tRPC/editor-only by design — a model that
 * can edit assertions can grade its own homework; a model that can fix a
 * broken fixture (a mock contradicting the case's own scenario) cannot.
 * Mock outputs are validated against the tool's real output schema before save.
 */
export function createUpdateEvalCaseMockTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_eval_case_mock',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'admin',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Update simulation case mocks',
    surfaces: ['builder'],
    requiresApproval: true,
    description: `Add, replace, or remove tool mocks (\`connectorMocks\`) on one simulation case. Use it ONLY to repair a broken fixture — a mock whose data contradicts the case's own scenario (wrong customer, wrong order, missing match) so the case can never pass. Read the case with \`get_eval_case\` first and target real mock ids. Never shape a mock to force a failing assertion to pass with data the real tool would not return — mocks model reality. Assertions cannot be edited; flag wrong-looking assertions to the user instead.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['caseId'],
      properties: {
        caseId: { type: 'string', minLength: 1, description: 'The eval case to edit.' },
        upsertMocks: {
          type: 'array',
          description:
            'Mocks to add or replace. With `id`, replaces that existing mock in place; without, appends a new one.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['toolName', 'output'],
            properties: {
              id: {
                type: 'string',
                minLength: 1,
                description: 'Existing mock id to replace (from `get_eval_case`). Omit to add.',
              },
              toolName: { type: 'string', minLength: 1 },
              args: {
                type: 'object',
                additionalProperties: false,
                required: ['mode', 'value'],
                properties: {
                  mode: { enum: ['exact', 'subset'] },
                  value: { type: 'object' },
                },
                description:
                  'Optional argument matcher — the mock only fires when the call args match. Omit to match any call to the tool.',
              },
              output: {
                description: 'The mocked tool output (validated against the tool schema).',
              },
              usage: { enum: ['once', 'repeat'], description: 'Defaults to repeat.' },
            },
          },
        },
        removeMockIds: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description: 'Mock ids to delete (from `get_eval_case`).',
        },
      },
    },
    outputSchema,
    exampleOutput: {
      caseId: 'case_example',
      mocks: [{ id: 'mock_example', toolName: 'order_lookup', usage: 'repeat' }],
      warnings: [],
    },
    buildDigest: (output) => {
      const o = output as { caseId?: string; mocks?: unknown[] } | null
      return { caseId: o?.caseId, mockCount: o?.mocks?.length }
    },
    execute: async (args, agentDeps) => {
      const ctx = await resolveProcedureAuthoring(getDeps, agentDeps, 'edit')
      if (!ctx.ok) return { success: false, output: null, error: ctx.error }

      const caseId = typeof args.caseId === 'string' ? args.caseId : ''
      if (!caseId) return { success: false, output: null, error: 'caseId is required.' }

      const upserts = parseUpsertMocks(args.upsertMocks)
      if (typeof upserts === 'string') return { success: false, output: null, error: upserts }
      const removeIds = Array.isArray(args.removeMockIds)
        ? (args.removeMockIds as unknown[]).filter(
            (id): id is string => typeof id === 'string' && id.length > 0
          )
        : []
      if (upserts.length === 0 && removeIds.length === 0) {
        return {
          success: false,
          output: null,
          error: 'Provide at least one mock to upsert or remove.',
        }
      }

      const found = await getEvalCaseById({ organizationId: agentDeps.organizationId, id: caseId })
      // Session-agent scoping on top of org scoping, same as `get_eval_case`.
      if (found.isErr() || !found.value || found.value.agentId !== ctx.agentId) {
        return { success: false, output: null, error: `Eval case not found: ${caseId}` }
      }

      const parsedConfig = simulationConfigSchema.safeParse(found.value.config)
      if (!parsedConfig.success) {
        return {
          success: false,
          output: null,
          error: 'Case config is malformed — fix it in the simulation case editor.',
        }
      }
      const config = parsedConfig.data

      let mocks: SimulationToolMock[] = [...config.connectorMocks]
      for (const id of removeIds) {
        if (!mocks.some((m) => m.id === id)) {
          return { success: false, output: null, error: `No mock with id "${id}" on this case.` }
        }
        mocks = mocks.filter((m) => m.id !== id)
      }

      // Validate every upserted output against the tool's real output schema
      // BEFORE any write — a mock that fails validation aborts the whole edit.
      const warnings: string[] = []
      for (const upsert of upserts) {
        const verdict = await validateAgentToolMock({
          organizationId: agentDeps.organizationId,
          userId: agentDeps.userId,
          agentId: ctx.agentId,
          toolName: upsert.toolName,
          output: upsert.output,
        })
        if (!verdict.ok) {
          return {
            success: false,
            output: null,
            error: `Mock for "${upsert.toolName}" is invalid: ${verdict.error}`,
          }
        }
        if (verdict.warning) warnings.push(`${upsert.toolName}: ${verdict.warning}`)

        const next: SimulationToolMock = {
          id: upsert.id ?? generateId('mock'),
          toolName: upsert.toolName,
          ...(upsert.args ? { args: upsert.args } : {}),
          output: upsert.output,
          usage: upsert.usage ?? 'repeat',
        }
        if (upsert.id) {
          const at = mocks.findIndex((m) => m.id === upsert.id)
          if (at === -1) {
            return {
              success: false,
              output: null,
              error: `No mock with id "${upsert.id}" on this case — omit the id to add a new mock.`,
            }
          }
          mocks[at] = next
        } else {
          mocks.push(next)
        }
      }

      const updated = await updateEvalCase({
        organizationId: agentDeps.organizationId,
        id: caseId,
        patch: { config: { ...config, connectorMocks: mocks } },
      })
      if (updated.isErr()) {
        return {
          success: false,
          output: null,
          error: `Failed to update case mocks: ${updated.error.message}`,
        }
      }

      return {
        success: true,
        output: {
          caseId,
          mocks: mocks.map((m) => ({ id: m.id, toolName: m.toolName, usage: m.usage })),
          warnings,
        },
      }
    },
  }
}
