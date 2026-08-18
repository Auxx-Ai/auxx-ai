// packages/lib/src/providers/social/__tests__/thread-key.test.ts

import { describe, expect, it } from 'vitest'
import { isSocialDmThreadKey, parseSocialDmThreadKey, socialThreadKey } from '../thread-key'

describe('parseSocialDmThreadKey', () => {
  it('round-trips a key minted by socialThreadKey', () => {
    const key = socialThreadKey('869289333164075', '27893553143563440')
    expect(key).toBe('dm:869289333164075:27893553143563440')
    expect(parseSocialDmThreadKey(key)).toEqual({
      pageId: '869289333164075',
      counterpartId: '27893553143563440',
    })
  })

  it('rejects the comment namespace', () => {
    // Comments share the column. Reading one as a DM would address a reply to a
    // comment id as if it were a PSID.
    expect(parseSocialDmThreadKey('comment:1234567890')).toBeNull()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['a provider-issued conversation id', 't_1234567890'],
    ['an email thread id', '<CAF=abc@mail.gmail.com>'],
    ['a bare prefix', 'dm:'],
    ['a missing counterpart', 'dm:869289333164075'],
    ['an empty counterpart', 'dm:869289333164075:'],
    ['an empty page id', 'dm::27893553143563440'],
    ['an extra segment', 'dm:869289333164075:27893553143563440:extra'],
  ])('returns null for %s', (_label, key) => {
    expect(parseSocialDmThreadKey(key)).toBeNull()
  })

  it('agrees with isSocialDmThreadKey on what is a DM key', () => {
    // A key the predicate accepts but the parser rejects would send a reply with
    // no recipient; the reverse would address one the thread never named.
    for (const key of ['dm:1:2', 'dm:', 'comment:1', 't_1', '']) {
      if (parseSocialDmThreadKey(key)) expect(isSocialDmThreadKey(key)).toBe(true)
    }
  })
})
