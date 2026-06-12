// apps/web/src/components/editor/inline-picker/core/__tests__/strip-open-chips.test.ts

import { describe, expect, it } from 'vitest'
import { stripOpenChips } from '../strip-open-chips'

const ZWSP = '​'

function doc(content: object[]) {
  return { type: 'doc', content } as Parameters<typeof stripOpenChips>[0]
}

describe('stripOpenChips', () => {
  it('returns the same reference when no chip is present', () => {
    const json = doc([
      { type: 'block', attrs: { blockType: 'text' }, content: [{ type: 'text', text: 'hello' }] },
    ])
    expect(stripOpenChips(json)).toBe(json)
  })

  it('replaces an @ chip with its literal query text (ZWSP stripped)', () => {
    const json = doc([
      {
        type: 'block',
        attrs: { blockType: 'text' },
        content: [
          { type: 'text', text: 'ask ' },
          {
            type: 'referencePicker',
            attrs: { trigger: '@', tab: 'people' },
            content: [{ type: 'text', text: `${ZWSP}mark` }],
          },
        ],
      },
    ])
    const stripped = stripOpenChips(json)
    expect(stripped.content?.[0]?.content).toEqual([
      { type: 'text', text: 'ask ' },
      { type: 'text', text: '@mark' },
    ])
  })

  it('replaces a / chip with its literal query text', () => {
    const json = doc([
      {
        type: 'block',
        attrs: { blockType: 'text' },
        content: [
          {
            type: 'referencePicker',
            attrs: { trigger: '/', tab: null },
            content: [{ type: 'text', text: `${ZWSP}head` }],
          },
        ],
      },
    ])
    const stripped = stripOpenChips(json)
    expect(stripped.content?.[0]?.content).toEqual([{ type: 'text', text: '/head' }])
  })

  it('emits the bare trigger char for an empty chip', () => {
    const json = doc([
      {
        type: 'block',
        attrs: { blockType: 'text' },
        content: [
          {
            type: 'referencePicker',
            attrs: { trigger: '/', tab: null },
            content: [{ type: 'text', text: ZWSP }],
          },
        ],
      },
    ])
    const stripped = stripOpenChips(json)
    expect(stripped.content?.[0]?.content).toEqual([{ type: 'text', text: '/' }])
  })

  it('defaults a missing trigger attr to @ (legacy chips)', () => {
    const json = doc([
      {
        type: 'block',
        attrs: { blockType: 'text' },
        content: [
          {
            type: 'referencePicker',
            attrs: { tab: 'people' },
            content: [{ type: 'text', text: `${ZWSP}bob` }],
          },
        ],
      },
    ])
    const stripped = stripOpenChips(json)
    expect(stripped.content?.[0]?.content).toEqual([{ type: 'text', text: '@bob' }])
  })

  it('strips chips nested in deeper structures (condition arms)', () => {
    const json = doc([
      {
        type: 'conditionBlock',
        content: [
          {
            type: 'conditionCase',
            content: [
              {
                type: 'block',
                attrs: { blockType: 'text' },
                content: [
                  {
                    type: 'referencePicker',
                    attrs: { trigger: '/', tab: 'Code' },
                    content: [{ type: 'text', text: `${ZWSP}fetch` }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
    const stripped = stripOpenChips(json)
    const block = stripped.content?.[0]?.content?.[0]?.content?.[0]
    expect(block?.content).toEqual([{ type: 'text', text: '/fetch' }])
  })

  it('does not mutate the input document', () => {
    const json = doc([
      {
        type: 'block',
        attrs: { blockType: 'text' },
        content: [
          {
            type: 'referencePicker',
            attrs: { trigger: '@', tab: 'people' },
            content: [{ type: 'text', text: `${ZWSP}x` }],
          },
        ],
      },
    ])
    const before = JSON.stringify(json)
    stripOpenChips(json)
    expect(JSON.stringify(json)).toBe(before)
  })
})
