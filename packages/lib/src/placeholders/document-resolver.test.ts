// packages/lib/src/placeholders/document-resolver.test.ts

import { FieldType } from '@auxx/database/enums'
import { describe, expect, it, vi } from 'vitest'
import type { TiptapDoc } from '../tiptap'

/** Deterministic resolver dependencies so document behavior is tested without a database. */
const resolver = vi.hoisted(() => ({
  resolveFieldTokens: vi.fn(),
  formatFieldValueForText: vi.fn(),
}))

vi.mock('../cache', () => ({
  getOrgCache: () => ({ get: vi.fn() }),
  getUserCache: () => ({ get: vi.fn() }),
}))
vi.mock('./resolver', () => resolver)

import { resolvePlaceholdersInDocument } from './document-resolver'

describe('resolvePlaceholdersInDocument', () => {
  it('batches one field read while applying each structural occurrence independently', async () => {
    resolver.resolveFieldTokens.mockResolvedValue(
      new Map([
        [
          'visit:startTime',
          {
            value: { type: 'date', value: '2026-07-14T16:30:00.000Z' },
            fieldType: FieldType.TIME,
            fieldOptions: { timeFormat: '12h' },
          },
        ],
      ])
    )
    resolver.formatFieldValueForText.mockReturnValueOnce('9:30 AM').mockReturnValueOnce('09:30')

    const document: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'placeholder', attrs: { id: 'visit:startTime' } },
            { type: 'text', text: ' / ' },
            {
              type: 'placeholder',
              attrs: {
                id: 'visit:startTime',
                format: { v: 1, t: 'TIME', o: { timeFormat: '24h' } },
              },
              marks: [{ type: 'bold' }],
            },
          ],
        },
      ],
    }

    const resolved = await resolvePlaceholdersInDocument(document, {
      db: {} as never,
      organizationId: 'org_123',
      timezone: 'America/Los_Angeles',
      recordIdsByRoot: new Map([['visit', 'visit:visit_123' as never]]),
    })

    expect(resolver.resolveFieldTokens).toHaveBeenCalledTimes(1)
    expect(resolver.resolveFieldTokens.mock.calls[0]?.[0]).toEqual([
      {
        id: 'visit:startTime',
        parsed: expect.objectContaining({ kind: 'field' }),
      },
    ])
    expect(resolver.formatFieldValueForText).toHaveBeenLastCalledWith(
      expect.anything(),
      FieldType.TIME,
      expect.objectContaining({
        timeFormat: '24h',
        timeZone: 'America/Los_Angeles',
      })
    )
    expect(resolved.content?.[0]?.content).toEqual([
      { type: 'text', text: '9:30 AM' },
      { type: 'text', text: ' / ' },
      { type: 'text', text: '09:30', marks: [{ type: 'bold' }] },
    ])
    expect(document.content?.[0]?.content?.[0]?.type).toBe('placeholder')
  })

  it('uses structural fallbacks when a field is empty', async () => {
    resolver.resolveFieldTokens.mockResolvedValue(new Map([['visit:assignee', null]]))

    const resolved = await resolvePlaceholdersInDocument(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'placeholder',
                attrs: {
                  id: 'visit:assignee',
                  fallback: { v: 1, t: 'TEXT', d: 'our team' },
                },
              },
            ],
          },
        ],
      },
      { db: {} as never, organizationId: 'org_123', recordIdsByRoot: new Map() }
    )

    expect(resolved.content?.[0]?.content?.[0]).toEqual({
      type: 'text',
      text: 'our team',
    })
  })
})
