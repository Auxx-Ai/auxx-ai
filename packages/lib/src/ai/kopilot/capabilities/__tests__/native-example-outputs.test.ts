// packages/lib/src/ai/kopilot/capabilities/__tests__/native-example-outputs.test.ts

import { describe, expect, it } from 'vitest'
import { createListGroupsTool } from '../actors/tools/list-groups'
import { createListMembersTool } from '../actors/tools/list-members'
import { createGetEvalRunTool } from '../agents-builder/tools/get-eval-run'
import { createGetSuiteDiffTool } from '../agents-builder/tools/get-suite-diff'
import { createListEvalCasesTool } from '../agents-builder/tools/list-eval-cases'
import { createRunEvalSuiteTool } from '../agents-builder/tools/run-eval-suite'
import { createListTranscriptsForEntityTool } from '../entities/tools/list-transcripts-for-entity'
import { createQueryRecordsTool } from '../entities/tools/query-records'
import { createSearchEntitiesTool } from '../entities/tools/search-entities'
import { createUpdateEntityTool } from '../entities/tools/update-entity'
import { createSearchDocsTool } from '../knowledge/tools/search-docs'
import { createSearchKnowledgeTool } from '../knowledge/tools/search-knowledge'
import { createFindThreadsTool } from '../mail/tools/find-threads'
import { createGetThreadDetailTool } from '../mail/tools/get-thread-detail'
import { createListDraftsTool } from '../mail/tools/list-drafts'
import { createListTagsTool } from '../mail/tools/list-tags'
import { createReplyToThreadTool } from '../mail/tools/reply-to-thread'
import { createStartNewConversationTool } from '../mail/tools/start-new-conversation'
import { createUpdateThreadTool } from '../mail/tools/update-thread'
import { createCreateTaskTool } from '../tasks/tools/create-task'
import { createListTasksTool } from '../tasks/tools/list-tasks'
import type { GetToolDeps } from '../types'

// Factories never call getDeps at construction time — only inside `execute`.
const getDeps = (() => ({})) as unknown as GetToolDeps

// Guards against schema drift: a populated native `exampleOutput` must keep
// satisfying its own `outputSchema`. See plans/evals/tool-example-outputs.md §7.
describe('native exampleOutput conforms to outputSchema', () => {
  const tools = [
    // mail
    createFindThreadsTool(getDeps),
    createGetThreadDetailTool(getDeps),
    createListDraftsTool(getDeps),
    createListTagsTool(getDeps),
    createReplyToThreadTool(getDeps),
    createStartNewConversationTool(getDeps),
    createUpdateThreadTool(getDeps),
    // entities
    createSearchEntitiesTool(getDeps),
    createUpdateEntityTool(getDeps),
    createQueryRecordsTool(getDeps),
    createListTranscriptsForEntityTool(getDeps),
    // knowledge
    createSearchDocsTool(getDeps),
    createSearchKnowledgeTool(getDeps),
    // actors
    createListGroupsTool(getDeps),
    createListMembersTool(getDeps),
    // tasks
    createCreateTaskTool(getDeps),
    createListTasksTool(getDeps),
    // agents-builder
    createListEvalCasesTool(getDeps),
    createGetEvalRunTool(getDeps),
    createGetSuiteDiffTool(getDeps),
    createRunEvalSuiteTool(getDeps),
  ]

  for (const tool of tools) {
    it(`${tool.name} has a schema-valid, JSON-serializable example`, () => {
      expect(tool.exampleOutput).toBeDefined()
      expect(tool.outputSchema).toBeDefined()
      const parsed = tool.outputSchema!.safeParse(tool.exampleOutput)
      if (!parsed.success) {
        throw new Error(`${tool.name}: ${JSON.stringify(parsed.error.issues, null, 2)}`)
      }
      expect(parsed.success).toBe(true)
      expect(() => JSON.stringify(tool.exampleOutput)).not.toThrow()
    })
  }
})
