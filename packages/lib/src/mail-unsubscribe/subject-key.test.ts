// packages/lib/src/mail-unsubscribe/subject-key.test.ts
// The refusal half of `buildSubjectKeyPredicate`: an unparseable subject key
// must THROW, never compile into a predicate.
//
// ⚠️ Why this file exists. `parseMailSubjectKey` used to narrow with a ternary
// whose else-branch meant "not a list, therefore a domain". The keyspace is
// owned by `mail-suggestions/client.ts` and will grow prefixes this module has
// no meaning for — `topic:` for mined tag suggestions (08 §4.2) — and under that
// else a `topic:refund request` key became
// `{ kind: 'domain', senderDomain: 'refund request' }`, which compiles into a
// perfectly valid `Message` predicate that matches nothing. Matching nothing is
// the one answer this module must never give: the sweep reads "no mail arrived
// since" as "the sender honored the unsubscribe".
//
// Only the rejection paths are asserted. The accepting paths build drizzle
// fragments off `schema.Message`, and the shared `src/test/setup.ts` proxy does
// not make columns assertable — they are covered by `unsubscribe-queries.test.ts`
// and `sweep.test.ts` against the real query builder.

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../errors'
import { buildSubjectKeyPredicate } from './subject-key'

describe('buildSubjectKeyPredicate — refusals', () => {
  it('throws on a keyspace prefix that is not a bulk-mail group', () => {
    for (const key of ['topic:refund request', 'thread:abc', 'contact:a@example.com']) {
      expect(() => buildSubjectKeyPredicate(key)).toThrow(BadRequestError)
    }
  })

  it('throws on an unknown prefix, a bare prefix and a key with no prefix at all', () => {
    for (const key of ['sender:example.com', 'list:', 'domain:', '', 'example.com']) {
      expect(() => buildSubjectKeyPredicate(key)).toThrow(BadRequestError)
    }
  })
})
