// packages/lib/src/ai/kopilot/prompts/sections/__tests__/tool-block.test.ts

import { describe, expect, it } from 'vitest'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { makeCtx } from '../__test-helpers'
import { toolBlock } from '../tool-block'

const toolWithNotes = {
  name: 'search_entities',
  usageNotes: 'Returns up to 25 matches.',
} as AgentToolDefinition
const toolWithoutNotes = { name: 'noop' } as AgentToolDefinition

describe('toolBlock', () => {
  it('returns null with no tools', () => {
    expect(toolBlock.render(makeCtx({ runMode: 'interactive' }))).toBeNull()
  })

  it('skips tools without usageNotes', () => {
    expect(
      toolBlock.render(makeCtx({ runMode: 'interactive', tools: [toolWithoutNotes] }))
    ).toBeNull()
  })

  it('renders each tool with usageNotes', () => {
    const out = toolBlock.render(makeCtx({ runMode: 'interactive', tools: [toolWithNotes] }))
    expect(out).toContain('### `search_entities`')
    expect(out).toContain('Returns up to 25 matches.')
  })
})
