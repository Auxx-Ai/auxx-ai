// packages/lib/src/ai/kopilot/capabilities/__tests__/native-example-outputs.test.ts

import { describe, expect, it } from 'vitest'
import { createGetEvalRunTool } from '../agents-builder/tools/get-eval-run'
import { createGetSuiteDiffTool } from '../agents-builder/tools/get-suite-diff'
import { createListEvalCasesTool } from '../agents-builder/tools/list-eval-cases'
import { createRunEvalSuiteTool } from '../agents-builder/tools/run-eval-suite'
import { createSearchEntitiesTool } from '../entities/tools/search-entities'
import { createFindThreadsTool } from '../mail/tools/find-threads'
import { createGetThreadDetailTool } from '../mail/tools/get-thread-detail'
import type { GetToolDeps } from '../types'

// Factories never call getDeps at construction time — only inside `execute`.
const getDeps = (() => ({})) as unknown as GetToolDeps

// Guards against schema drift: a populated native `exampleOutput` must keep
// satisfying its own `outputSchema`. See plans/evals/tool-example-outputs.md §7.
describe('native exampleOutput conforms to outputSchema', () => {
  const tools = [
    createFindThreadsTool(getDeps),
    createGetThreadDetailTool(getDeps),
    createSearchEntitiesTool(getDeps),
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
      expect(parsed.success).toBe(true)
      expect(() => JSON.stringify(tool.exampleOutput)).not.toThrow()
    })
  }
})
