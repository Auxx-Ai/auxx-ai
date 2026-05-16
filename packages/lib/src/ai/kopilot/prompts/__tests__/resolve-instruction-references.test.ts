// packages/lib/src/ai/kopilot/prompts/__tests__/resolve-instruction-references.test.ts

import { describe, expect, it } from 'vitest'
import type { FlatToolCatalogEntry, ToolsetCatalogEntry } from '../../../../agents'
import { docToText } from '../../../../tiptap'
import { buildInstructionReferenceResolver } from '../resolve-instruction-references'

const toolCatalog: FlatToolCatalogEntry[] = [
  {
    name: 'create_note',
    displayName: 'Add note',
    description: 'Add an internal note.',
    toolsetSlug: 'comments.write',
    toolsetLabel: 'Comments — Write',
    toolsetIconId: 'message-square',
    toolsetColor: 'teal',
    toolsetParentGroup: 'Comments',
  },
]

const toolsetCatalog: ToolsetCatalogEntry[] = [
  {
    slug: 'comments.write',
    label: 'Comments — Write',
    shortLabel: 'Write',
    group: 'native',
    parentGroup: 'Comments',
    iconId: 'message-square',
    color: 'teal',
    isDefault: false,
    tools: [{ name: 'create_note', displayName: 'Add note', description: 'Add a note.' }],
  },
  {
    slug: 'mail.compose',
    label: 'Mail — Compose',
    shortLabel: 'Compose',
    group: 'native',
    parentGroup: 'Mail',
    iconId: 'send',
    color: 'blue',
    isDefault: false,
    tools: [
      { name: 'reply_to_thread', displayName: 'Reply to thread', description: 'Reply.' },
      {
        name: 'start_new_conversation',
        displayName: 'Start new conversation',
        description: 'Start.',
      },
    ],
  },
]

describe('buildInstructionReferenceResolver', () => {
  it('resolves tool: chips to backtick-quoted tool names', () => {
    const resolve = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
    expect(resolve('tool:create_note')).toBe('`create_note`')
  })

  it('resolves single-tool toolset: chips to a single backtick-quoted name (legacy)', () => {
    const resolve = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
    expect(resolve('toolset:comments.write')).toBe('`create_note`')
  })

  it('resolves multi-tool toolset: chips to a comma-joined list (legacy)', () => {
    const resolve = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
    expect(resolve('toolset:mail.compose')).toBe('`reply_to_thread`, `start_new_conversation`')
  })

  it('falls back to the raw slug when the toolset is unknown', () => {
    const resolve = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
    expect(resolve('toolset:does-not-exist')).toBe('`does-not-exist`')
  })

  it('passes through agent: and record: ids verbatim, backtick-quoted', () => {
    const resolve = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
    expect(resolve('agent:my-agent')).toBe('`agent:my-agent`')
    expect(resolve('record:tickets:abc123')).toBe('`record:tickets:abc123`')
    expect(resolve('user:u_42')).toBe('`user:u_42`')
  })

  it('returns empty string for empty id', () => {
    const resolve = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
    expect(resolve('')).toBe('')
  })

  it('flattens a Tiptap doc with a tool chip into the resolved tool name', () => {
    const resolve = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Reply with a joke using ' },
            { type: 'reference', attrs: { id: 'tool:create_note' } },
            { type: 'text', text: '.' },
          ],
        },
      ],
    }
    const text = docToText(doc, { references: resolve })
    expect(text).toContain('`create_note`')
    expect(text).toContain('Reply with a joke using')
  })

  it("flattens a legacy toolset chip into the toolset's tool names", () => {
    const resolve = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Use ' },
            { type: 'reference', attrs: { id: 'toolset:mail.compose' } },
            { type: 'text', text: ' to message them.' },
          ],
        },
      ],
    }
    const text = docToText(doc, { references: resolve })
    expect(text).toContain('`reply_to_thread`')
    expect(text).toContain('`start_new_conversation`')
  })
})
