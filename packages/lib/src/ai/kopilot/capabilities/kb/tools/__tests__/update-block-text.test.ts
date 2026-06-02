// packages/lib/src/ai/kopilot/capabilities/kb/tools/__tests__/update-block-text.test.ts

import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { GetToolDeps } from '../../../types'
import { createUpdateBlockTextTool } from '../update-block-text'

// Stub deps — the multi-block guard returns before runBlockCrudOp touches the
// db, so a never-typed stub is enough for these cases.
const FAKE_DEPS: GetToolDeps = () =>
  ({
    db: {} as never,
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
  }) as ReturnType<GetToolDeps>

const FAKE_CTX = {} as ToolContext

describe('update_block_text multi-block guard', () => {
  const tool = createUpdateBlockTextTool(FAKE_DEPS)

  it('rejects markdown that parses to multiple blocks instead of dropping content', async () => {
    const result = await tool.execute(
      { blockId: 'b1', markdown: 'First paragraph.\n\nSecond paragraph.' },
      FAKE_CTX
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/single block/i)
    expect(result.error).toMatch(/replace_block|insert_blocks/)
  })

  it('rejects structural/container markdown (e.g. a table)', async () => {
    const result = await tool.execute(
      { blockId: 'b1', markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |' },
      FAKE_CTX
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/single block/i)
  })
})
