// packages/lib/src/permissions/visibility/thread-lens-search-agreement.int.test.ts
//
// The guide's must-agree rule, tested directly rather than inferred from sharing a
// builder: **a list predicate and the per-thread lens must give the same answer for
// the same thread** (`docs/channels-mail-architecture-guide.md`).
//
// The list path under test is the participant arm of `searchRecipients`, which
// narrows with a `buildMailVisibilityPredicate` inside an `EXISTS` over
// `MessageParticipant → Message → Thread` (`participants/search/search-recipients.ts`,
// `lensExists`). Its definition of visible, from
// `plans/email-editor/recipient-search-lens-scope.md` §1, is **existential at the
// lowest rung**: a participant is visible iff at least one thread they appear on is
// visible at `metadata` or above. So for a participant on exactly ONE thread —
// which is how every fixture below is built, deliberately — the claim reduces to a
// clean biconditional:
//
//     the search admits the participant  ⟺  getThreadLens(thread) ≥ metadata
//
// **Integration and not a rendered-SQL test, for a reason this plan learned the
// hard way.** The shipped `EXISTS` originally filtered `Thread."deletedAt"`, a
// column that does not exist; Postgres rejected it on the first real run and every
// rendered-SQL test passed (lens-scope §2). A test that renders the predicate and
// greps it can only ever assert that the two sides *look* alike. This one runs both
// against the same rows.
//
// The contact arm is switched off throughout (`contactVisibility: null`) — it is
// gated on record scope, not the mail lens, and the two authorization models must
// not be merged. That also keeps the org cache out of the harness.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildMailVisibilityPredicate } from '../../mail-query/visibility-scope'
import { searchRecipients } from '../../participants/search/search-recipients'
import {
  bucketInstanceGrantRows,
  type InstanceGrantRow,
} from '../../resource-access/instance-grants'
import { Level } from '../capabilities/registry'
import { composeUserInstanceGrants } from './compute-user-instance-grants'
import type { MailViewer, UserInstanceGrants } from './context'
import type { Lens } from './lens'
import { getThreadLens } from './thread-lens'

const db = () => getTestDb() as never as Database

/** One participant per thread, so the existential quantifier collapses to one thread. */
const PEOPLE = {
  shared: { name: 'Ada Lovelace', email: 'ada@acme.test', query: 'lovelace' },
  assigned: { name: 'Katherine Johnson', email: 'katherine@acme.test', query: 'johnson' },
  personal: { name: 'Grace Hopper', email: 'grace@acme.test', query: 'hopper' },
  merged: { name: 'Alan Turing', email: 'alan@acme.test', query: 'turing' },
} as const

type Person = keyof typeof PEOPLE

interface Fixture {
  orgId: string
  /** The viewer under test. Real `User` row — `Thread.assigneeId` carries a FK. */
  me: string
  bob: string
  integrationId: string
  sharedInbox: string
  otherInbox: string
  bobsInbox: string
  ticketDefId: string
  ticketInstanceId: string
  contactInstanceId: string
  threads: Record<Person, string>
}

let f: Fixture

beforeEach(async () => {
  const org = await createTestOrganization()
  const me = await createTestUser({ name: 'Me' })
  const bob = await createTestUser({ name: 'Bob' })

  const [integration] = await db()
    .insert(schema.Integration)
    .values({ organizationId: org.id, provider: 'google', updatedAt: new Date() })
    .returning()

  const def = async (entityType: string, slug: string) => {
    const [row] = await db()
      .insert(schema.EntityDefinition)
      .values({
        organizationId: org.id,
        entityType,
        apiSlug: slug,
        singular: slug,
        plural: `${slug}s`,
        updatedAt: new Date(),
      })
      .returning()
    return row?.id as string
  }

  const instance = async (defId: string, displayName: string) => {
    const [row] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId: org.id,
        entityDefinitionId: defId,
        displayName,
        updatedAt: new Date(),
      })
      .returning()
    return row?.id as string
  }

  const inboxDefId = await def('inbox', 'inbox')
  const ticketDefId = await def('ticket', 'ticket')
  const contactDefId = await def('contact', 'contact')

  const sharedInbox = await instance(inboxDefId, 'Support')
  const otherInbox = await instance(inboxDefId, 'Billing')
  const bobsInbox = await instance(inboxDefId, "Bob's mailbox")
  const ticketInstanceId = await instance(ticketDefId, 'TICKET-1')
  const contactInstanceId = await instance(contactDefId, 'Ada Lovelace')

  /** A thread, its one message, its one participant, and the link between them. */
  const seedThread = async (
    person: Person,
    thread: Partial<typeof schema.Thread.$inferInsert>
  ): Promise<string> => {
    const who = PEOPLE[person]
    const [threadRow] = await db()
      .insert(schema.Thread)
      .values({
        organizationId: org.id,
        integrationId: integration?.id as string,
        subject: `Thread for ${who.name}`,
        ...thread,
      })
      .returning()
    const threadId = threadRow?.id as string

    const [participant] = await db()
      .insert(schema.Participant)
      .values({
        organizationId: org.id,
        identifier: who.email,
        identifierType: 'EMAIL',
        name: who.name,
        displayName: who.name,
        lastSentMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    const [message] = await db()
      .insert(schema.Message)
      .values({
        organizationId: org.id,
        integrationId: integration?.id as string,
        threadId,
        messageType: 'EMAIL',
        fromId: participant?.id as string,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    await db()
      .insert(schema.MessageParticipant)
      .values({
        messageId: message?.id as string,
        participantId: participant?.id as string,
        role: 'FROM',
      })

    return threadId
  }

  const sharedThreadId = await seedThread('shared', {
    inboxId: sharedInbox,
    primaryEntityInstanceId: ticketInstanceId,
    primaryEntityDefinitionId: ticketDefId,
  })

  // The contact-derived lane reads `ThreadParticipant.entityInstanceId` — the same
  // table `buildMailVisibilityPredicate`'s contact branch and `getThreadLensBatch`'s
  // second query both read, which is what makes that case a real agreement test
  // rather than two independent lookups.
  await db().insert(schema.ThreadParticipant).values({
    threadId: sharedThreadId,
    email: PEOPLE.shared.email,
    entityInstanceId: contactInstanceId,
    firstMessageAt: new Date(),
    lastMessageAt: new Date(),
  })

  const threads: Record<Person, string> = {
    shared: sharedThreadId,
    // In an inbox the assignee holds no row on — the dispatch/controller shape.
    assigned: await seedThread('assigned', { inboxId: otherInbox, assigneeId: me.id }),
    personal: await seedThread('personal', { inboxId: bobsInbox }),
    merged: await seedThread('merged', {
      inboxId: sharedInbox,
      mergedIntoThreadId: sharedThreadId,
    }),
  }

  f = {
    orgId: org.id,
    me: me.id,
    bob: bob.id,
    integrationId: integration?.id as string,
    sharedInbox,
    otherInbox,
    bobsInbox,
    ticketDefId,
    ticketInstanceId,
    contactInstanceId,
    threads,
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Viewer construction — through the real composition, not hand-written blobs.
// ─────────────────────────────────────────────────────────────────────────────

const grantRow = (over: Partial<InstanceGrantRow>): InstanceGrantRow => ({
  entityDefinitionId: 'inbox',
  entityInstanceId: f.sharedInbox,
  granteeType: 'user',
  granteeId: f.me,
  rung: 'read',
  ...over,
})

function viewer(opts: {
  inboxesLevel?: Level
  grants?: InstanceGrantRow[]
  defEntityTypes?: Record<string, string | null>
  role?: 'USER' | 'ADMIN' | 'OWNER'
}): UserInstanceGrants {
  return composeUserInstanceGrants({
    userId: f.me,
    role: opts.role ?? 'USER',
    inboxesAreaLevel: opts.inboxesLevel ?? Level.None,
    inboxes: [
      { id: f.sharedInbox },
      { id: f.otherInbox },
      { id: f.bobsInbox, isPersonal: true, ownerUserId: f.bob },
    ],
    instanceGrants: bucketInstanceGrantRows(opts.grants ?? []),
    defEntityTypes: opts.defEntityTypes,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// The two sides of the biconditional.
// ─────────────────────────────────────────────────────────────────────────────

/** Does the search's lens `EXISTS` admit this person for this viewer? */
async function searchAdmits(person: Person, v: MailViewer, query?: string): Promise<boolean> {
  const result = await searchRecipients(db(), {
    organizationId: f.orgId,
    query: query ?? PEOPLE[person].query,
    model: 'email',
    threadVisibility: buildMailVisibilityPredicate(v),
    // The contact arm is gated on RECORD scope, not the mail lens. Off, so this
    // measures the participant arm alone.
    contactVisibility: null,
  })
  if (result.isErr()) throw result.error
  return result.value.candidates.some((c) => c.identifier === PEOPLE[person].email)
}

/**
 * Assert the rule, and pin the lens value while doing it.
 *
 * 🔴 The expected lens is not decoration. This repo's test discipline is
 * denial-shaped and structurally blind to OVER-denial
 * (`mail-floor-from-rows.test.ts`), and a biconditional between two sides that are
 * both wrongly `none` passes vacuously. Naming the rung makes every `false` row
 * below prove that it is false for the RIGHT reason.
 */
async function expectAgreement(person: Person, v: MailViewer, expected: Lens): Promise<void> {
  const lens = await getThreadLens(db(), f.orgId, v, f.threads[person])
  expect(lens, 'getThreadLens').toBe(expected)
  expect(await searchAdmits(person, v), 'search admits').toBe(lens !== 'none')
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the recipient search lens agrees with getThreadLens — shared inbox', () => {
  it('a mail admin: read, admitted', async () => {
    await expectAgreement('shared', viewer({ inboxesLevel: Level.Full, role: 'ADMIN' }), 'read')
  })

  it('a member holding that inbox at read: read, admitted', async () => {
    await expectAgreement('shared', viewer({ grants: [grantRow({})] }), 'read')
  })

  it('a member holding a DIFFERENT inbox only: none, excluded', async () => {
    await expectAgreement(
      'shared',
      viewer({ grants: [grantRow({ entityInstanceId: f.otherInbox })] }),
      'none'
    )
  })

  it('a member with no inbox access at all: none, excluded', async () => {
    await expectAgreement('shared', viewer({}), 'none')
  })

  /**
   * The `metadata` boundary, from below. lens-scope §1 chose `metadata` rather than
   * `identity` deliberately, so this is the rung the whole rule turns on: one step
   * above `none` must ADMIT.
   */
  it('a member holding that inbox at exactly metadata: metadata, admitted', async () => {
    await expectAgreement(
      'shared',
      viewer({ grants: [grantRow({ rung: 'metadata' })] }),
      'metadata'
    )
  })

  it('a per-thread grant at metadata with no inbox access: metadata, admitted', async () => {
    await expectAgreement(
      'shared',
      viewer({
        grants: [
          grantRow({
            entityDefinitionId: 'thread',
            entityInstanceId: f.threads.shared,
            rung: 'metadata',
          }),
        ],
      }),
      'metadata'
    )
  })

  it('a contact grant at metadata with no inbox access: metadata, admitted', async () => {
    await expectAgreement(
      'shared',
      viewer({
        grants: [
          grantRow({
            entityDefinitionId: 'contact',
            entityInstanceId: f.contactInstanceId,
            rung: 'metadata',
          }),
        ],
      }),
      'metadata'
    )
  })

  it('a ticket grant on the thread primary entity: read, admitted', async () => {
    await expectAgreement(
      'shared',
      viewer({
        grants: [
          grantRow({ entityDefinitionId: f.ticketDefId, entityInstanceId: f.ticketInstanceId }),
        ],
        defEntityTypes: { [f.ticketDefId]: 'ticket' },
      }),
      'read'
    )
  })

  /**
   * The cascade cap, on BOTH sides. Same grant, same instance — only the def's
   * `entityType` differs, and a custom def carries `null`. It must derive nothing
   * onto the thread in the evaluator AND contribute no id to the SQL predicate; the
   * two halves living in different functions
   * (`primaryEntityThreadRung` / `primaryEntityThreadIdsAtOrAbove`) is exactly why
   * this is worth asserting through both surfaces.
   */
  it('the same grant on a def with no declared cap: none, excluded', async () => {
    await expectAgreement(
      'shared',
      viewer({
        grants: [
          grantRow({ entityDefinitionId: f.ticketDefId, entityInstanceId: f.ticketInstanceId }),
        ],
        defEntityTypes: { [f.ticketDefId]: null },
      }),
      'none'
    )
  })
})

describe('… headless principals', () => {
  it('SYSTEM: read, admitted — and pays no EXISTS to get there', async () => {
    const system: MailViewer = { kind: 'system' }
    expect(buildMailVisibilityPredicate(system)).toBeUndefined()
    await expectAgreement('shared', system, 'read')
  })

  it('automation with no personal inboxes: read, admitted', async () => {
    const automation: MailViewer = { kind: 'automation', personalInboxIds: {} }
    expect(buildMailVisibilityPredicate(automation)).toBeUndefined()
    await expectAgreement('shared', automation, 'read')
  })

  it("automation on a personal mailbox's thread: none, excluded", async () => {
    await expectAgreement(
      'personal',
      { kind: 'automation', personalInboxIds: { [f.bobsInbox]: true } },
      'none'
    )
  })
})

describe('… assignment reaches a viewer who holds no inbox row', () => {
  it('the assignee: read, admitted', async () => {
    await expectAgreement('assigned', viewer({}), 'read')
  })

  it('a non-assignee with no access to that inbox: none, excluded', async () => {
    await expectAgreement('shared', viewer({}), 'none')
  })
})

describe("… others' personal mailbox", () => {
  /**
   * The `metadata` boundary again, reached the other way — through the mail-admin
   * personal floor rather than through a row. Both sides must land on `metadata`,
   * and `metadata` must admit.
   */
  it('a mail admin sees Bob’s thread at metadata, and is admitted', async () => {
    await expectAgreement(
      'personal',
      viewer({ inboxesLevel: Level.Full, role: 'ADMIN' }),
      'metadata'
    )
  })

  it('a member at inboxes: Read is not a mail admin: none, excluded', async () => {
    await expectAgreement('personal', viewer({ inboxesLevel: Level.Read }), 'none')
  })

  it('the area level is the gate, not rank', async () => {
    // An ADMIN-ranked member on a profile at inboxes: None gets nothing, on both
    // sides. Rank is not an authority in the mail path (plan 40 §4.2).
    await expectAgreement('personal', viewer({ inboxesLevel: Level.None, role: 'ADMIN' }), 'none')
    // …and the shared inbox is gone for them too, so this is the profile talking
    // and not an artefact of the personal-mailbox branch.
    await expectAgreement('shared', viewer({ inboxesLevel: Level.None, role: 'ADMIN' }), 'none')
  })
})

describe('… the quantifier is EXISTENTIAL, not universal', () => {
  /**
   * Every fixture above puts one participant on one thread, which is what turns
   * lens-scope §1's existential rule into a biconditional this file can assert. This
   * case is the reason that restriction is needed rather than incidental: with a
   * participant on TWO threads, the search admits them if EITHER is visible, so
   * `getThreadLens` on one thread is no longer the whole answer.
   *
   * Universal quantification was rejected deliberately (§1): it would hide the
   * org's most-corresponded-with people from everyone, and make visibility SHRINK as
   * correspondence grows.
   */
  it('a second, visible thread admits a participant whose first thread is invisible', async () => {
    const [participant] = await db()
      .select({ id: schema.Participant.id })
      .from(schema.Participant)
      .where(eq(schema.Participant.identifier, PEOPLE.shared.email))

    const [second] = await db()
      .insert(schema.Thread)
      .values({
        organizationId: f.orgId,
        integrationId: f.integrationId,
        subject: 'Second thread, other inbox',
        inboxId: f.otherInbox,
      })
      .returning()

    const [message] = await db()
      .insert(schema.Message)
      .values({
        organizationId: f.orgId,
        integrationId: f.integrationId,
        threadId: second?.id as string,
        messageType: 'EMAIL',
        fromId: participant?.id as string,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    await db()
      .insert(schema.MessageParticipant)
      .values({
        messageId: message?.id as string,
        participantId: participant?.id as string,
        role: 'FROM',
      })

    // Holds `otherInbox` only. The thread `expectAgreement` would check is invisible…
    const v = viewer({ grants: [grantRow({ entityInstanceId: f.otherInbox })] })
    expect(await getThreadLens(db(), f.orgId, v, f.threads.shared)).toBe('none')
    expect(await getThreadLens(db(), f.orgId, v, second?.id as string)).toBe('read')
    // …and the participant is admitted anyway, off the second thread.
    expect(await searchAdmits('shared', v)).toBe(true)
  })
})

describe('… the empty-query path carries the same lens', () => {
  /**
   * lens-scope §4: the most-recently-mailed list is the widest possible enumeration
   * of an org's correspondents, so scoping the typed path and not the focus path
   * would leave the hole open at its widest. Different SQL (`recentlyMailedArm`, a
   * straight index scan) applying the same `lensExists`, so it needs its own case.
   */
  it('excludes a participant the lens denies, and keeps one it admits', async () => {
    const withAccess = viewer({ grants: [grantRow({})] })
    const withoutAccess = viewer({ grants: [grantRow({ entityInstanceId: f.otherInbox })] })

    expect(await searchAdmits('shared', withAccess, '')).toBe(true)
    expect(await searchAdmits('shared', withoutAccess, '')).toBe(false)
    // Unscoped stays unscoped on this path too.
    expect(await searchAdmits('shared', { kind: 'system' }, '')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The ONE place the two sides deliberately disagree.
// ─────────────────────────────────────────────────────────────────────────────

describe('🔴 merged threads — the documented, one-directional divergence', () => {
  /**
   * `lensExists` adds `Thread."mergedIntoThreadId" IS NULL` (lens-scope §2, rule 2):
   * a merged-away thread must not keep a participant visible in a recipient picker.
   * `getThreadLens` carries no such filter — it answers "may this viewer see this
   * row", and a merged thread is still a row you can be redirected from.
   *
   * So the biconditional does NOT hold for merged threads, and that is intended
   * rather than a bug. It is asserted here so the exception is a written, tested
   * fact instead of something a future reader discovers by finding
   * `expectAgreement` mysteriously failing.
   *
   * The direction matters: the search is STRICTER. A divergence the other way —
   * search admitting what the lens denies — would be a leak.
   */
  it('getThreadLens still says read, but the search excludes the participant', async () => {
    const v = viewer({ grants: [grantRow({})] })

    expect(await getThreadLens(db(), f.orgId, v, f.threads.merged)).toBe('read')
    expect(await searchAdmits('merged', v)).toBe(false)
  })

  it('… and the surviving thread’s own participant is still admitted', async () => {
    // Negative control for the above: proves the exclusion came from the merge
    // filter and not from a broken fixture or a lens that denies everything.
    const v = viewer({ grants: [grantRow({})] })
    expect(await searchAdmits('shared', v)).toBe(true)
  })

  /**
   * ⚠️ **The merge filter lives INSIDE the `EXISTS`, so an unscoped viewer skips
   * it.** `lensExists` returns `undefined` when `threadVisibility` is `undefined`
   * (the deliberate "no always-true EXISTS" contract, lens-scope §4), and the
   * `mergedIntoThreadId IS NULL` predicate goes with it. A SYSTEM viewer therefore
   * still sees a participant whose only thread was merged away.
   *
   * Surfaced by mutation-testing this file (dropping the lens made 8 cases fail,
   * this one among them). Recorded rather than fixed: SYSTEM is unscoped by
   * definition and this is a recipient-suggestion quality wrinkle on a headless
   * principal, not a visibility leak. But it means "merged threads never keep a
   * participant visible" is true for user viewers only, and a reader would
   * reasonably assume otherwise.
   */
  it('a SYSTEM viewer is NOT subject to the merge filter (it lives in the EXISTS)', async () => {
    expect(await searchAdmits('merged', { kind: 'system' })).toBe(true)
  })

  it('un-merging the thread restores agreement', async () => {
    await db()
      .update(schema.Thread)
      .set({ mergedIntoThreadId: null })
      .where(eq(schema.Thread.id, f.threads.merged))

    await expectAgreement('merged', viewer({ grants: [grantRow({})] }), 'read')
  })
})
