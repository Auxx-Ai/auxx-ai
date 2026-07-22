// packages/lib/src/record-rules/resolve-action-tokens.test.ts
// Unit tests for the rule-action placeholder resolver (plans/signals/07-action-placeholders.md).
// Mirrors document-resolver.test.ts's mocking: the shared field lookup
// (`placeholders/resolver`) and the cache are mocked; the REAL
// `resolvePlaceholdersInDocument` runs on top so pre-pass + fallback/format layering is
// exercised end-to-end without a database.

import { FieldType } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TiptapDoc, TiptapNode } from '../tiptap/types'
import type { RuleTokenContext } from './resolve-action-tokens'

const shared = vi.hoisted(() => ({
  resolveFieldTokens: vi.fn(),
  formatFieldValueForText: vi.fn(),
}))

vi.mock('../cache', () => ({
  getOrgCache: () => ({ get: vi.fn(async () => ({})) }),
  getUserCache: () => ({ get: vi.fn(async () => null) }),
}))
vi.mock('../placeholders/resolver', () => shared)

import { resolveActionDocToText, resolveActionValue } from './resolve-action-tokens'

/** Single-paragraph doc from inline nodes. */
function doc(...content: TiptapNode[]): TiptapDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}

function placeholder(id: string, attrs: Record<string, unknown> = {}): TiptapNode {
  return { type: 'placeholder', attrs: { id, ...attrs } }
}

function text(t: string): TiptapNode {
  return { type: 'text', text: t }
}

function ctx(overrides: Partial<RuleTokenContext> = {}): RuleTokenContext {
  return {
    recordName: 'Jane Doe',
    placeholderCtx: {
      db: {} as never,
      organizationId: 'org_1',
      senderUserId: 'user_sys',
      recordIdsByRoot: new Map([['def_contact', 'def_contact:contact_1' as never]]),
    },
    ...overrides,
  }
}

const signal = {
  signalId: 'sig_1',
  kind: 'email:opened',
  subtype: 'sequence_step',
  occurredAt: '2026-07-15T10:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  shared.resolveFieldTokens.mockResolvedValue(new Map())
})

describe('resolveActionDocToText', () => {
  it('plain strings pass through verbatim — no interpolation (defensive guard)', async () => {
    await expect(resolveActionDocToText('Follow up with {{record}} now', ctx())).resolves.toBe(
      'Follow up with {{record}} now'
    )
    await expect(resolveActionDocToText('No tokens here', ctx())).resolves.toBe('No tokens here')
  })

  it('resolves record:name in a mixed doc', async () => {
    shared.resolveFieldTokens.mockResolvedValue(new Map())
    const result = await resolveActionDocToText(
      doc(text('Follow up with '), placeholder('record:name'), text(' about opens')),
      ctx()
    )
    expect(result).toBe('Follow up with Jane Doe about opens')
  })

  it('resolves field tokens through the shared resolver, honoring format options', async () => {
    shared.resolveFieldTokens.mockResolvedValue(
      new Map([
        [
          'def_contact:email',
          { value: { type: 'text', value: 'jane@acme.test' }, fieldType: FieldType.TEXT },
        ],
      ])
    )
    shared.formatFieldValueForText.mockReturnValue('jane@acme.test')
    const result = await resolveActionDocToText(
      doc(text('Email '), placeholder('def_contact:email'), text(' bounced')),
      ctx()
    )
    expect(result).toBe('Email jane@acme.test bounced')
    expect(shared.resolveFieldTokens.mock.calls[0]?.[0]).toEqual([
      { id: 'def_contact:email', parsed: expect.objectContaining({ kind: 'field' }) },
    ])
  })

  it('uses the token FALLBACK when the field value is empty', async () => {
    shared.resolveFieldTokens.mockResolvedValue(new Map([['def_contact:email', null]]))
    const result = await resolveActionDocToText(
      doc(
        text('Email '),
        placeholder('def_contact:email', { fallback: { v: 1, t: 'TEXT', d: 'unknown address' } })
      ),
      ctx()
    )
    expect(result).toBe('Email unknown address')
  })

  it('degrades unparseable ids via their fallback (or empty) instead of throwing', async () => {
    shared.resolveFieldTokens.mockResolvedValue(new Map())
    const result = await resolveActionDocToText(
      doc(
        text('A'),
        placeholder('date:bogus', { fallback: { v: 1, t: 'TEXT', d: 'someday' } }),
        text('B'),
        placeholder('org:bogus')
      ),
      ctx()
    )
    expect(result).toBe('AsomedayB')
  })

  it('degrades to plain text when the shared resolver throws (bad root)', async () => {
    shared.resolveFieldTokens.mockRejectedValue(new Error('no record for root'))
    const result = await resolveActionDocToText(
      doc(text('Hi '), placeholder('record:name'), text(', field: '), placeholder('def_x:missing')),
      ctx()
    )
    // record:name was pre-passed; the failing field token flattens to ''.
    expect(result).toBe('Hi Jane Doe, field:')
  })

  it('resolves signal tokens from ctx.signal (kind label, subtype, formatted date)', async () => {
    const result = await resolveActionDocToText(
      doc(
        placeholder('signal:kind'),
        text(' / '),
        placeholder('signal:subtype'),
        text(' / '),
        placeholder('signal:occurredAt')
      ),
      ctx({ signal })
    )
    expect(result).toBe('Email opened / sequence_step / Jul 15, 2026')
  })

  it('falls back to the raw kind for unknown signal kinds', async () => {
    const result = await resolveActionDocToText(
      doc(placeholder('signal:kind')),
      ctx({ signal: { ...signal, kind: 'custom:thing' } })
    )
    expect(result).toBe('custom:thing')
  })

  it('signal tokens resolve to fallback/empty without ctx.signal', async () => {
    const result = await resolveActionDocToText(
      doc(
        text('['),
        placeholder('signal:kind', { fallback: { v: 1, t: 'TEXT', d: 'a signal' } }),
        placeholder('signal:occurredAt'),
        text(']')
      ),
      ctx()
    )
    expect(result).toBe('[a signal]')
  })
})

describe('resolveActionValue (set-field)', () => {
  it('passes legacy non-doc values through verbatim', async () => {
    await expect(resolveActionValue('vip', ctx())).resolves.toBe('vip')
    await expect(resolveActionValue(42, ctx())).resolves.toBe(42)
    await expect(resolveActionValue(true, ctx())).resolves.toBe(true)
    expect(shared.resolveFieldTokens).not.toHaveBeenCalled()
  })

  it('a solo field token resolves to the RAW typed value (number, boolean)', async () => {
    shared.resolveFieldTokens.mockResolvedValue(
      new Map([
        [
          'def_contact:score',
          { value: { type: 'number', value: 42 }, fieldType: FieldType.NUMBER },
        ],
      ])
    )
    await expect(resolveActionValue(doc(placeholder('def_contact:score')), ctx())).resolves.toBe(42)

    shared.resolveFieldTokens.mockResolvedValue(
      new Map([
        [
          'def_contact:vip',
          { value: { type: 'boolean', value: true }, fieldType: FieldType.CHECKBOX },
        ],
      ])
    )
    await expect(resolveActionValue(doc(placeholder('def_contact:vip')), ctx())).resolves.toBe(true)
  })

  it('a solo field token ignores surrounding whitespace-only text', async () => {
    shared.resolveFieldTokens.mockResolvedValue(
      new Map([
        ['def_contact:score', { value: { type: 'number', value: 7 }, fieldType: FieldType.NUMBER }],
      ])
    )
    await expect(
      resolveActionValue(doc(text('  '), placeholder('def_contact:score'), text(' ')), ctx())
    ).resolves.toBe(7)
  })

  it('a solo field token with an empty value uses the fallback text', async () => {
    shared.resolveFieldTokens.mockResolvedValue(new Map([['def_contact:score', null]]))
    await expect(
      resolveActionValue(
        doc(placeholder('def_contact:score', { fallback: { v: 1, t: 'NUMBER', d: 0 } })),
        ctx()
      )
    ).resolves.toBe('0')
  })

  it('solo rule tokens resolve raw: record:name and signal:occurredAt (ISO)', async () => {
    await expect(resolveActionValue(doc(placeholder('record:name')), ctx())).resolves.toBe(
      'Jane Doe'
    )
    await expect(
      resolveActionValue(doc(placeholder('signal:occurredAt')), ctx({ signal }))
    ).resolves.toBe('2026-07-15T10:00:00.000Z')
  })

  it('mixed docs flatten to a string', async () => {
    shared.resolveFieldTokens.mockResolvedValue(new Map())
    await expect(
      resolveActionValue(doc(text('VIP: '), placeholder('record:name')), ctx())
    ).resolves.toBe('VIP: Jane Doe')
  })

  it('coerces token-free flattened docs to primitives (number, boolean, else string)', async () => {
    await expect(resolveActionValue(doc(text('42')), ctx())).resolves.toBe(42)
    await expect(resolveActionValue(doc(text('  3.5 ')), ctx())).resolves.toBe(3.5)
    await expect(resolveActionValue(doc(text('true')), ctx())).resolves.toBe(true)
    await expect(resolveActionValue(doc(text('false')), ctx())).resolves.toBe(false)
    await expect(resolveActionValue(doc(text('not a number')), ctx())).resolves.toBe('not a number')
  })
})
