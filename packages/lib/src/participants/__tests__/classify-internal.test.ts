// packages/lib/src/participants/__tests__/classify-internal.test.ts
//
// channel-identity-and-is-internal plan §7 — the table test that would have
// caught the original bug. `classifyIsInternal` opened with
// `if (identifierType !== EMAIL) return false`, so every phone and chat
// participant — INCLUDING the org's own channel number — was stored
// `isInternal: false`. The EMAIL row and the PHONE row must not share a
// fixture, or the case passes vacuously.

import { IdentifierType } from '@auxx/database/enums'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../ingest/domain/classifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ingest/domain/classifier')>()
  return { ...actual, getOwnDomains: async () => new Set(['auxx.ai']) }
})

// Never reached: every case below passes `ownIdentities` explicitly. Present so
// a regression that drops the pre-fetched sets fails loudly instead of hitting
// a live cache.
vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    get: async () => {
      throw new Error('classifyIsInternal must not read the org cache when sets are supplied')
    },
  }),
}))

import { classifyIsInternal } from '../classify-internal'

const OWN = {
  [IdentifierType.EMAIL]: new Set(['support@auxx.ai']),
  [IdentifierType.PHONE]: new Set(['+18889155797']),
}

async function classify(
  identifier: string,
  identifierType: (typeof IdentifierType)[keyof typeof IdentifierType]
) {
  return classifyIsInternal({
    organizationId: 'org_1',
    identifier,
    identifierType,
    ownIdentities: OWN,
  })
}

describe('classifyIsInternal', () => {
  describe('channel identity — the rung that works on every channel', () => {
    const cases: Array<
      [string, string, (typeof IdentifierType)[keyof typeof IdentifierType], boolean]
    > = [
      ['our own mailbox', 'support@auxx.ai', IdentifierType.EMAIL, true],
      ['our own phone number', '+18889155797', IdentifierType.PHONE, true],
      ["a customer's address", 'buyer@example.com', IdentifierType.EMAIL, false],
      ["a customer's number", '+15102055536', IdentifierType.PHONE, false],
    ]

    for (const [label, identifier, type, expected] of cases) {
      it(`${label} → ${expected}`, async () => {
        expect(await classify(identifier, type)).toBe(expected)
      })
    }

    it('is the ONLY rung phone has — a customer number is never internal by proximity', async () => {
      // Same US area code as the org's own line. There is no phone analogue of
      // an own-domain check and one must not be invented.
      expect(await classify('+18889155798', IdentifierType.PHONE)).toBe(false)
    })
  })

  describe('org domains — EMAIL only, deliberately', () => {
    it('classifies a teammate on the org domain as internal', async () => {
      expect(await classify('someone-else@auxx.ai', IdentifierType.EMAIL)).toBe(true)
    })

    it('does not leak the domain rung onto other identifier types', async () => {
      // A phone identifier can never satisfy the domain rung; asserted so a
      // refactor that drops the EMAIL guard before `extractRegistrableDomain`
      // is caught rather than silently widening the classifier.
      expect(await classify('+15102055536', IdentifierType.PHONE)).toBe(false)
      expect(await classify('visitor-session-uuid', IdentifierType.CHAT_VISITOR)).toBe(false)
    })
  })

  describe('CHAT_VISITOR — an id space that only ever names the customer', () => {
    it('is always external', async () => {
      // The org's half of a chat is an EMAIL participant minted from the agent's
      // user row, so no visitor id is ever ours.
      expect(await classify('some-opaque-id', IdentifierType.CHAT_VISITOR)).toBe(false)
    })
  })

  describe('Meta ids — one id space, both sides in it', () => {
    // Unlike chat, a Meta channel DOES have an org-side identifier in the
    // customer's id space: ingest mints a page-side participant keyed on the
    // page id / IG business account id. The own-identity set is the only thing
    // that tells our numeric id from theirs.
    const META_OWN = {
      [IdentifierType.FACEBOOK_PSID]: new Set(['869289333164075']),
      [IdentifierType.INSTAGRAM_IGSID]: new Set(['17841400000000000']),
    }

    const classifyMeta = (
      identifier: string,
      identifierType: (typeof IdentifierType)[keyof typeof IdentifierType]
    ) =>
      classifyIsInternal({
        organizationId: 'org_1',
        identifier,
        identifierType,
        ownIdentities: META_OWN,
      })

    it('our own Facebook page is internal', async () => {
      expect(await classifyMeta('869289333164075', IdentifierType.FACEBOOK_PSID)).toBe(true)
    })

    it('our own Instagram business account is internal', async () => {
      expect(await classifyMeta('17841400000000000', IdentifierType.INSTAGRAM_IGSID)).toBe(true)
    })

    it("a customer's PSID on the same channel stays external", async () => {
      // The load-bearing case: over-matching here would attribute every
      // Messenger thread to nobody and break the sender column outright.
      expect(await classifyMeta('27893553143563440', IdentifierType.FACEBOOK_PSID)).toBe(false)
      expect(await classifyMeta('27893553143563440', IdentifierType.INSTAGRAM_IGSID)).toBe(false)
    })

    it('does not cross the two Meta id spaces', async () => {
      expect(await classifyMeta('17841400000000000', IdentifierType.FACEBOOK_PSID)).toBe(false)
      expect(await classifyMeta('869289333164075', IdentifierType.INSTAGRAM_IGSID)).toBe(false)
    })

    it('is external when no Meta channel is connected', async () => {
      expect(await classify('869289333164075', IdentifierType.FACEBOOK_PSID)).toBe(false)
    })
  })

  describe('phone normalization', () => {
    it('matches our own number however it was stored', async () => {
      // `normalizeIdentifier(x, PHONE)` in ingest is a digit-strip, not E.164,
      // so the stored form is not guaranteed to string-equal the channel's
      // `metadata.phoneNumber`. Both sides must fold before comparing.
      expect(await classify('18889155797', IdentifierType.PHONE)).toBe(true)
      expect(await classify('(888) 915-5797', IdentifierType.PHONE)).toBe(true)
      expect(await classify('+1 888 915 5797', IdentifierType.PHONE)).toBe(true)
    })

    it('an unparseable phone identifier is never internal', async () => {
      // Short codes and alphanumeric sender ids arrive with identifierType
      // PHONE and must not match anything.
      expect(await classify('12345', IdentifierType.PHONE)).toBe(false)
      expect(await classify('AUXX', IdentifierType.PHONE)).toBe(false)
    })

    it('is case-insensitive on email', async () => {
      expect(await classify('SUPPORT@AUXX.AI', IdentifierType.EMAIL)).toBe(true)
    })
  })

  describe('context identities — the fresher rung', () => {
    it('wins before the org-cache sets, so a first sync survives a cold cache', async () => {
      const result = await classifyIsInternal({
        organizationId: 'org_1',
        identifier: '+14155550100',
        identifierType: IdentifierType.PHONE,
        // Org cache hasn't caught up with the just-connected channel yet.
        ownIdentities: {},
        contextIdentities: { [IdentifierType.PHONE]: new Set(['+14155550100']) },
      })
      expect(result).toBe(true)
    })
  })

  it('an empty identifier is never internal', async () => {
    expect(await classify('', IdentifierType.EMAIL)).toBe(false)
  })
})
