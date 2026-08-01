// packages/lib/src/ingest/__tests__/threading-headers.test.ts

import { describe, expect, it } from 'vitest'
import { parentMessageIdCandidates, pickThreadingHeaders } from '../threading-headers'

describe('pickThreadingHeaders', () => {
  it('picks In-Reply-To/References from Graph-style `name` entries', () => {
    expect(
      pickThreadingHeaders([
        { name: 'In-Reply-To', value: '<m1@example.com>' },
        { name: 'References', value: '<m0@example.com> <m1@example.com>' },
      ])
    ).toEqual({
      inReplyTo: '<m1@example.com>',
      references: '<m0@example.com> <m1@example.com>',
    })
  })

  it('picks from postal-mime-style `key` entries', () => {
    expect(
      pickThreadingHeaders([
        { key: 'in-reply-to', value: '<m1@example.com>' },
        { key: 'references', value: '<m0@example.com>' },
      ])
    ).toEqual({ inReplyTo: '<m1@example.com>', references: '<m0@example.com>' })
  })

  it('matches header names case-insensitively and trims them', () => {
    expect(
      pickThreadingHeaders([
        { name: '  IN-REPLY-TO  ', value: '<m1@example.com>' },
        { name: 'ReFeReNcEs', value: '<m0@example.com>' },
      ])
    ).toEqual({ inReplyTo: '<m1@example.com>', references: '<m0@example.com>' })
  })

  it('ignores headers outside the threading allowlist', () => {
    expect(
      pickThreadingHeaders([
        { name: 'Return-Path', value: 'bounce@example.com' },
        { name: 'Message-ID', value: '<m2@example.com>' },
      ])
    ).toEqual({})
  })

  it('keeps the first occurrence of a duplicated header name', () => {
    expect(
      pickThreadingHeaders([
        { name: 'In-Reply-To', value: '<first@example.com>' },
        { name: 'in-reply-to', value: '<second@example.com>' },
        { name: 'References', value: '<ref-first@example.com>' },
        { name: 'REFERENCES', value: '<ref-second@example.com>' },
      ])
    ).toEqual({ inReplyTo: '<first@example.com>', references: '<ref-first@example.com>' })
  })

  it('returns {} for an undefined or empty entry list', () => {
    expect(pickThreadingHeaders(undefined)).toEqual({})
    expect(pickThreadingHeaders([])).toEqual({})
  })

  it('does not throw on entries with a null or missing value', () => {
    expect(() =>
      pickThreadingHeaders([
        { name: 'In-Reply-To', value: null },
        { name: 'References' },
        { name: null, value: null },
        {},
      ])
    ).not.toThrow()

    expect(
      pickThreadingHeaders([{ name: 'In-Reply-To', value: null }, { name: 'References' }])
    ).toEqual({ inReplyTo: '', references: '' })
  })
})

describe('parentMessageIdCandidates', () => {
  it('returns In-Reply-To first, then References newest→oldest', () => {
    expect(
      parentMessageIdCandidates({
        inReplyTo: '<m3@example.com>',
        references: '<m0@example.com> <m1@example.com> <m2@example.com>',
      })
    ).toEqual(['<m3@example.com>', '<m2@example.com>', '<m1@example.com>', '<m0@example.com>'])
  })

  it('dedupes an id present in both In-Reply-To and References, keeping first-seen order', () => {
    expect(
      parentMessageIdCandidates({
        inReplyTo: '<m2@example.com>',
        references: '<m0@example.com> <m1@example.com> <m2@example.com>',
      })
    ).toEqual(['<m2@example.com>', '<m1@example.com>', '<m0@example.com>'])
  })

  it('normalises bare and bracketed ids to the same candidate', () => {
    expect(parentMessageIdCandidates({ inReplyTo: 'foo@bar' })).toEqual(['<foo@bar>'])
    expect(parentMessageIdCandidates({ inReplyTo: '<foo@bar>' })).toEqual(['<foo@bar>'])
    expect(parentMessageIdCandidates({ inReplyTo: 'foo@bar', references: '<foo@bar>' })).toEqual([
      '<foo@bar>',
    ])
  })

  it('normalises to the bracketed form Message.internetMessageId is stored in', () => {
    for (const candidate of parentMessageIdCandidates({
      inReplyTo: 'a@x',
      references: 'b@x <c@x>',
    })) {
      expect(candidate.startsWith('<')).toBe(true)
      expect(candidate.endsWith('>')).toBe(true)
    }
  })

  it('splits an In-Reply-To carrying more than one id', () => {
    expect(parentMessageIdCandidates({ inReplyTo: '<a@x> <b@x>' })).toEqual(['<a@x>', '<b@x>'])
  })

  it('tolerates ids with no separator and stray commas', () => {
    expect(parentMessageIdCandidates({ references: '<a@x>,<b@x>' })).toEqual(['<b@x>', '<a@x>'])
  })

  it('caps the walk at 10 candidates', () => {
    const references = Array.from({ length: 24 }, (_, i) => `<m${i}@example.com>`).join(' ')
    const candidates = parentMessageIdCandidates({ inReplyTo: '<latest@example.com>', references })

    expect(candidates).toHaveLength(10)
    expect(candidates[0]).toBe('<latest@example.com>')
    // References walked newest→oldest: m23 down to m15, filling the remaining 9 slots.
    expect(candidates[1]).toBe('<m23@example.com>')
    expect(candidates[9]).toBe('<m15@example.com>')
  })

  it('returns [] for empty, absent, or whitespace-only headers', () => {
    expect(parentMessageIdCandidates({})).toEqual([])
    expect(parentMessageIdCandidates({ inReplyTo: '', references: '' })).toEqual([])
    expect(parentMessageIdCandidates({ inReplyTo: '   ', references: ' \t \n ' })).toEqual([])
    expect(parentMessageIdCandidates({ inReplyTo: '<>', references: '<> <>' })).toEqual([])
  })

  it('returns [] for headers picked off entries with null values', () => {
    const headers = pickThreadingHeaders([
      { name: 'In-Reply-To', value: null },
      { name: 'References', value: null },
    ])
    expect(parentMessageIdCandidates(headers)).toEqual([])
  })
})
