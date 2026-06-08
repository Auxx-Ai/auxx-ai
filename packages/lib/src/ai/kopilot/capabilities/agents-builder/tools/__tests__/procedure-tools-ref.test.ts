// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/procedure-tools-ref.test.ts

import { describe, expect, it } from 'vitest'
import type { AgentDeps } from '../../../../../agent-framework/types'
import type { GetToolDeps } from '../../../types'
import { createCreateProcedureTool } from '../procedure-create'
import { createReadProcedureTool } from '../procedure-read'
import { createSetProcedureBodyTool } from '../procedure-set-body'
import { createUpdateProcedureCriteriaTool } from '../procedure-update-criteria'

// A session with no `agent` ref — the builder tools must refuse before touching
// the DB or the feature/admin guard.
const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: { references: [] },
    organizationId: 'org-1',
    userId: 'u-1',
    sessionId: 's-1',
  }) as never

const agentDeps: AgentDeps = { organizationId: 'org-1', userId: 'u-1', sessionId: 's-1' }

const tools = [
  ['create_procedure', createCreateProcedureTool(getDeps), { name: 'X' }],
  [
    'set_procedure_body',
    createSetProcedureBodyTool(getDeps),
    { procedureId: 'p', expectedDraftContentHash: 'h', body: { steps: [] } },
  ],
  ['read_procedure', createReadProcedureTool(getDeps), { procedureId: 'p' }],
  [
    'update_procedure_criteria',
    createUpdateProcedureCriteriaTool(getDeps),
    { procedureId: 'p', name: 'Y' },
  ],
] as const

describe('procedure tools — agent-ref resolution', () => {
  for (const [name, tool, args] of tools) {
    it(`${name} refuses when no agent is in session context`, async () => {
      const result = await tool.execute(args as never, agentDeps)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/No agent in session context/)
    })

    it(`${name} is a builder-surface tool`, () => {
      expect(tool.surfaces).toEqual(['builder'])
    })
  }
})
