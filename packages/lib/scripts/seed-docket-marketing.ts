// packages/lib/scripts/seed-docket-marketing.ts
// Seeds a believable Docket / Robert Miller email history into the Acme Corp
// org so a marketing-video demo can ask Kopilot:
//   1) "do we have any open deals?"   -> Docket shows up with stage/value/close-date
//   2) "help me close the Docket deal" -> latest email gives Kopilot a clear hook
//
// Run from repo root:
//   npx dotenv -- npx tsx packages/lib/scripts/seed-docket-marketing.ts
//
// Flags:
//   --scenario=feature-confirm|pricing|procurement   (default: feature-confirm)
//   --reset                                          drop previously seeded rows first
//   --org-handle=acme-org                            target organization handle

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(here, '../../../.env') })

const { database, schema } = await import('@auxx/database')
const { and, eq, inArray, sql } = await import('drizzle-orm')

const {
  Organization,
  Integration,
  EntityDefinition,
  EntityInstance,
  CustomField,
  FieldValue,
  Participant,
  Thread,
  Message,
  MessageParticipant,
  ThreadParticipant,
  ThreadEntityLink,
} = schema

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type ScenarioKey = 'feature-confirm' | 'pricing' | 'procurement'

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  })
)

const SCENARIO = (args.scenario ?? 'feature-confirm') as ScenarioKey
const RESET = args.reset === 'true'
const ORG_HANDLE = args['org-handle'] ?? 'acme-org'

if (!['feature-confirm', 'pricing', 'procurement'].includes(SCENARIO)) {
  console.error(`Unknown --scenario=${SCENARIO}`)
  process.exit(1)
}

// Stable IDs — re-running with --reset cleans these up before re-inserting.
const ID = {
  participant: 'mkt_dock_p_robert_docket_01',
  threads: ['mkt_dock_t_thread_01', 'mkt_dock_t_thread_02'],
  messages: ['mkt_dock_m_01_inbound_01', 'mkt_dock_m_01_outbound_01', 'mkt_dock_m_02_inbound_01'],
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface ScenarioContent {
  /** Bumped Docket-deal stage so Kopilot reports a hot deal. */
  stage: 'proposal' | 'negotiation'
  probability: number
  /** Two threads: an earlier "warming up" exchange and a fresh "hook" email. */
  thread1: { subject: string; inbound: string; outboundReply: string }
  thread2: { subject: string; inboundHook: string }
}

const SCENARIOS: Record<ScenarioKey, ScenarioContent> = {
  'feature-confirm': {
    stage: 'negotiation',
    probability: 80,
    thread1: {
      subject: 'Following up on the Docket evaluation',
      inbound:
        "Hey Markus,\n\nThanks again for the demo last week — the team at Docket walked away really impressed. We've narrowed it down to you and one other vendor.\n\nA few of us are doing a final pass on the requirements doc. Anything stands out from your side that we should double-check before we make a call?\n\nBest,\nRobert",
      outboundReply:
        "Hi Robert,\n\nThat's great to hear — thanks for the update. From our side, the only items I'd flag for a final check are SSO setup and your data residency requirement (US-only, right?). Both are covered, but happy to walk your IT lead through them on a quick call.\n\nLet me know if it'd help to grab 20 min this week.\n\nBest,\nMarkus",
    },
    thread2: {
      subject: 'One last question before we sign',
      inboundHook:
        "Hi Markus,\n\nWe're 95% there. The only blocker on our side is SSO — our IT team needs to confirm Auxx supports SAML 2.0 SSO with Okta as the IdP, and that we can enforce it for all users (no email/password fallback).\n\nIf you can confirm both, we'd like to get the contract signed by Friday. Otherwise we'll have to push to next quarter.\n\nThanks,\nRobert Miller\nDocket",
    },
  },
  pricing: {
    stage: 'negotiation',
    probability: 65,
    thread1: {
      subject: 'Following up on the Docket evaluation',
      inbound:
        "Hey Markus,\n\nReally enjoyed the demo. The team is sold on the product — it's the clearest fit we've seen so far. I'm pulling together the internal business case now.\n\nQuick one: can you send over a clean quote in writing so I can attach it to the case?\n\nBest,\nRobert",
      outboundReply:
        'Hi Robert,\n\nGreat to hear. Sent the quote separately — TL;DR: $84,000/year for 50 seats on the Growth plan, billed annually.\n\nLet me know if you want me to break out specific line items for procurement.\n\nBest,\nMarkus',
    },
    thread2: {
      subject: 'Re: Following up on the Docket evaluation',
      inboundHook:
        'Hi Markus,\n\nGood news and bad news. The team loves it and wants to move forward. The bad news is the $84K figure is over our 2026 software budget — we have $65K allocated.\n\nIs there flexibility if we sign a 2-year deal up front? Happy to prepay the first year if it helps.\n\nThanks,\nRobert Miller\nDocket',
    },
  },
  procurement: {
    stage: 'negotiation',
    probability: 70,
    thread1: {
      subject: 'Docket — moving to contract',
      inbound:
        "Hey Markus,\n\nGood news — we got internal sign-off to move forward with Auxx. I'm looping in our legal team to start the paperwork. Can you send across your standard MSA so we can get a head start on review?\n\nBest,\nRobert",
      outboundReply:
        "Hi Robert,\n\nFantastic news. Sent our latest MSA + DPA over separately. Our legal team is usually quick on red-lines, so just point them at me when you're ready.\n\nBest,\nMarkus",
    },
    thread2: {
      subject: 'Re: Docket — moving to contract',
      inboundHook:
        "Hi Markus,\n\nLegal has cleared the MSA but they're blocking on two items before we can sign:\n\n1. Latest signed DPA (our security team flagged a clause in §7 they want updated to reference SCCs)\n2. Current SOC 2 Type II report (the one in the data room is from Jan 2024)\n\nIf you can send updated copies of both this week we should be able to sign by end of next week.\n\nThanks,\nRobert Miller\nDocket",
    },
  },
}

const SC = SCENARIOS[SCENARIO]

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

console.log(`\n→ Seeding Docket marketing scenario: ${SCENARIO}`)

const [org] = await database.select().from(Organization).where(eq(Organization.handle, ORG_HANDLE))
if (!org) throw new Error(`Organization with handle "${ORG_HANDLE}" not found`)

const orgEntityDefs = await database
  .select()
  .from(EntityDefinition)
  .where(eq(EntityDefinition.organizationId, org.id))

const dealDef = orgEntityDefs.find((d) => d.apiSlug === 'deals')
const companyDef = orgEntityDefs.find((d) => d.apiSlug === 'companies')
const contactDef = orgEntityDefs.find((d) => d.apiSlug === 'contacts')
const inboxDef = orgEntityDefs.find((d) => d.apiSlug === 'inboxes')
if (!dealDef || !companyDef || !contactDef || !inboxDef) {
  throw new Error('Expected deal/company/contact/inbox entity definitions to exist')
}

const [docketCompany] = await database
  .select()
  .from(EntityInstance)
  .where(
    and(
      eq(EntityInstance.organizationId, org.id),
      eq(EntityInstance.entityDefinitionId, companyDef.id),
      eq(EntityInstance.displayName, 'Docket')
    )
  )
const [robertContact] = await database
  .select()
  .from(EntityInstance)
  .where(
    and(
      eq(EntityInstance.organizationId, org.id),
      eq(EntityInstance.entityDefinitionId, contactDef.id),
      eq(EntityInstance.displayName, 'Robert Miller')
    )
  )
const [docketDeal] = await database
  .select()
  .from(EntityInstance)
  .where(
    and(
      eq(EntityInstance.organizationId, org.id),
      eq(EntityInstance.entityDefinitionId, dealDef.id),
      eq(EntityInstance.displayName, 'Docket')
    )
  )
if (!docketCompany || !robertContact || !docketDeal) {
  throw new Error('Expected Docket company, Docket deal, and Robert Miller contact to exist')
}

const [inbox] = await database
  .select()
  .from(EntityInstance)
  .where(
    and(
      eq(EntityInstance.organizationId, org.id),
      eq(EntityInstance.entityDefinitionId, inboxDef.id)
    )
  )
  .limit(1)
if (!inbox) throw new Error('No Inbox entity instance found for org')

const [integration] = await database
  .select()
  .from(Integration)
  .where(
    and(eq(Integration.organizationId, org.id), eq(Integration.email, 'acme-org@mail.auxx.ai'))
  )
  .limit(1)
if (!integration) throw new Error('Expected acme-org@mail.auxx.ai integration to exist')

const [agentParticipant] = await database
  .select()
  .from(Participant)
  .where(
    and(eq(Participant.organizationId, org.id), eq(Participant.identifier, 'm4rkuskk@gmail.com'))
  )
  .limit(1)
if (!agentParticipant) throw new Error('Expected agent participant m4rkuskk@gmail.com to exist')

const dealFields = await database
  .select()
  .from(CustomField)
  .where(eq(CustomField.entityDefinitionId, dealDef.id))
const fieldBySystemAttr = new Map(dealFields.map((f) => [f.systemAttribute ?? '', f]))
const stageField = fieldBySystemAttr.get('stage')
const valueField = fieldBySystemAttr.get('value')
const probabilityField = fieldBySystemAttr.get('probability')
const expectedCloseField = fieldBySystemAttr.get('expectedCloseDate')
if (!stageField || !valueField || !probabilityField || !expectedCloseField) {
  throw new Error('Missing one of the deal fields: stage / value / probability / expectedCloseDate')
}

console.log(`  org: ${org.name} (${org.id})`)
console.log(`  deal: ${docketDeal.displayName} (${docketDeal.id})`)
console.log(`  contact: ${robertContact.displayName} (${robertContact.id})`)
console.log(`  integration: ${integration.email} (${integration.id})`)

// ---------------------------------------------------------------------------
// Run everything in a transaction
// ---------------------------------------------------------------------------

await database.transaction(async (tx) => {
  // -------- Optional reset (cleans previous seed runs) -----------------------
  if (RESET) {
    console.log('  --reset: deleting previously seeded rows')
    await tx.delete(MessageParticipant).where(inArray(MessageParticipant.messageId, ID.messages))
    await tx.delete(Message).where(inArray(Message.id, ID.messages))
    await tx.delete(ThreadParticipant).where(inArray(ThreadParticipant.threadId, ID.threads))
    await tx.delete(ThreadEntityLink).where(inArray(ThreadEntityLink.threadId, ID.threads))
    // Null out Thread.latestMessageId before deleting messages, then thread itself
    await tx.update(Thread).set({ latestMessageId: null }).where(inArray(Thread.id, ID.threads))
    await tx.delete(Thread).where(inArray(Thread.id, ID.threads))
    await tx.delete(Participant).where(eq(Participant.id, ID.participant))
  }

  // -------- 1. Robert Miller participant on his Docket email -----------------
  await tx
    .insert(Participant)
    .values({
      id: ID.participant,
      identifier: 'robert.miller@docket.ai',
      identifierType: 'EMAIL',
      name: 'Robert Miller',
      entityInstanceId: robertContact.id,
      organizationId: org.id,
      isInternal: false,
      isSpammer: false,
      hasReceivedMessage: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: Participant.id })

  // -------- 2. Bump the Docket deal so it looks like an active opportunity ---
  const expectedClose = new Date()
  expectedClose.setDate(expectedClose.getDate() + 14) // ~2 weeks out

  // Stage
  await tx
    .update(FieldValue)
    .set({ optionId: SC.stage, updatedAt: new Date() })
    .where(and(eq(FieldValue.entityId, docketDeal.id), eq(FieldValue.fieldId, stageField.id)))

  // Probability
  const [existingProbability] = await tx
    .select()
    .from(FieldValue)
    .where(and(eq(FieldValue.entityId, docketDeal.id), eq(FieldValue.fieldId, probabilityField.id)))
    .limit(1)
  if (existingProbability) {
    await tx
      .update(FieldValue)
      .set({ valueNumber: SC.probability, updatedAt: new Date() })
      .where(eq(FieldValue.id, existingProbability.id))
  } else {
    await tx.insert(FieldValue).values({
      id: 'mkt_dock_fv_probability_01',
      organizationId: org.id,
      fieldId: probabilityField.id,
      entityId: docketDeal.id,
      entityDefinitionId: dealDef.id,
      valueNumber: SC.probability,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // Expected Close Date
  const [existingClose] = await tx
    .select()
    .from(FieldValue)
    .where(
      and(eq(FieldValue.entityId, docketDeal.id), eq(FieldValue.fieldId, expectedCloseField.id))
    )
    .limit(1)
  if (existingClose) {
    await tx
      .update(FieldValue)
      .set({ valueDate: expectedClose, updatedAt: new Date() })
      .where(eq(FieldValue.id, existingClose.id))
  } else {
    await tx.insert(FieldValue).values({
      id: 'mkt_dock_fv_expected_close_01',
      organizationId: org.id,
      fieldId: expectedCloseField.id,
      entityId: docketDeal.id,
      entityDefinitionId: dealDef.id,
      valueDate: expectedClose,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // -------- 3. Threads, messages, role rows ----------------------------------
  const now = new Date()
  const t1Start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000) // 6 days ago
  const t1Reply = new Date(t1Start.getTime() + 2 * 60 * 60 * 1000) // +2h
  const t2Start = new Date(now.getTime() - 2 * 60 * 60 * 1000) // 2h ago

  const [thread1Id, thread2Id] = ID.threads
  const [t1InMsgId, t1OutMsgId, t2InMsgId] = ID.messages

  await tx.insert(Thread).values([
    {
      id: thread1Id,
      subject: SC.thread1.subject,
      organizationId: org.id,
      integrationId: integration.id,
      status: 'OPEN',
      messageCount: 2,
      participantCount: 2,
      firstMessageAt: t1Start,
      lastMessageAt: t1Reply,
      latestMessageId: null,
      inboxId: inbox.id,
      createdAt: t1Start,
    },
    {
      id: thread2Id,
      subject: SC.thread2.subject,
      organizationId: org.id,
      integrationId: integration.id,
      status: 'OPEN',
      messageCount: 1,
      participantCount: 1,
      firstMessageAt: t2Start,
      lastMessageAt: t2Start,
      latestMessageId: null,
      inboxId: inbox.id,
      createdAt: t2Start,
    },
  ])

  await tx.insert(Message).values([
    {
      id: t1InMsgId,
      threadId: thread1Id,
      integrationId: integration.id,
      organizationId: org.id,
      fromId: ID.participant,
      isInbound: true,
      isFirstInThread: true,
      isReply: false,
      subject: SC.thread1.subject,
      snippet: SC.thread1.inbound.slice(0, 120),
      textPlain: SC.thread1.inbound,
      sendStatus: 'SENT',
      createdAt: t1Start,
      updatedAt: t1Start,
      sentAt: t1Start,
      receivedAt: t1Start,
    },
    {
      id: t1OutMsgId,
      threadId: thread1Id,
      integrationId: integration.id,
      organizationId: org.id,
      fromId: agentParticipant.id,
      isInbound: false,
      isFirstInThread: false,
      isReply: true,
      subject: `Re: ${SC.thread1.subject}`,
      snippet: SC.thread1.outboundReply.slice(0, 120),
      textPlain: SC.thread1.outboundReply,
      sendStatus: 'SENT',
      createdAt: t1Reply,
      updatedAt: t1Reply,
      sentAt: t1Reply,
      receivedAt: null,
    },
    {
      id: t2InMsgId,
      threadId: thread2Id,
      integrationId: integration.id,
      organizationId: org.id,
      fromId: ID.participant,
      isInbound: true,
      isFirstInThread: true,
      isReply: false,
      subject: SC.thread2.subject,
      snippet: SC.thread2.inboundHook.slice(0, 120),
      textPlain: SC.thread2.inboundHook,
      sendStatus: 'SENT',
      createdAt: t2Start,
      updatedAt: t2Start,
      sentAt: t2Start,
      receivedAt: t2Start,
    },
  ])

  await tx.update(Thread).set({ latestMessageId: t1OutMsgId }).where(eq(Thread.id, thread1Id))
  await tx.update(Thread).set({ latestMessageId: t2InMsgId }).where(eq(Thread.id, thread2Id))

  await tx.insert(MessageParticipant).values([
    // Thread 1 inbound
    {
      id: 'mkt_dock_mp_t1_in_from',
      role: 'FROM',
      messageId: t1InMsgId,
      participantId: ID.participant,
      entityInstanceId: robertContact.id,
      createdAt: t1Start,
    },
    {
      id: 'mkt_dock_mp_t1_in_to',
      role: 'TO',
      messageId: t1InMsgId,
      participantId: agentParticipant.id,
      entityInstanceId: null,
      createdAt: t1Start,
    },
    // Thread 1 outbound
    {
      id: 'mkt_dock_mp_t1_out_from',
      role: 'FROM',
      messageId: t1OutMsgId,
      participantId: agentParticipant.id,
      entityInstanceId: null,
      createdAt: t1Reply,
    },
    {
      id: 'mkt_dock_mp_t1_out_to',
      role: 'TO',
      messageId: t1OutMsgId,
      participantId: ID.participant,
      entityInstanceId: robertContact.id,
      createdAt: t1Reply,
    },
    // Thread 2 inbound (the hook)
    {
      id: 'mkt_dock_mp_t2_in_from',
      role: 'FROM',
      messageId: t2InMsgId,
      participantId: ID.participant,
      entityInstanceId: robertContact.id,
      createdAt: t2Start,
    },
    {
      id: 'mkt_dock_mp_t2_in_to',
      role: 'TO',
      messageId: t2InMsgId,
      participantId: agentParticipant.id,
      entityInstanceId: null,
      createdAt: t2Start,
    },
  ])

  await tx.insert(ThreadParticipant).values([
    {
      id: 'mkt_dock_tp_t1_robert',
      threadId: thread1Id,
      email: 'robert.miller@docket.ai',
      name: 'Robert Miller',
      isInternal: false,
      messageCount: 1,
      firstMessageAt: t1Start,
      lastMessageAt: t1Start,
    },
    {
      id: 'mkt_dock_tp_t1_agent',
      threadId: thread1Id,
      email: 'm4rkuskk@gmail.com',
      name: 'Markus',
      isInternal: true,
      messageCount: 1,
      firstMessageAt: t1Reply,
      lastMessageAt: t1Reply,
    },
    {
      id: 'mkt_dock_tp_t2_robert',
      threadId: thread2Id,
      email: 'robert.miller@docket.ai',
      name: 'Robert Miller',
      isInternal: false,
      messageCount: 1,
      firstMessageAt: t2Start,
      lastMessageAt: t2Start,
    },
  ])

  // -------- 4. Link both threads to Docket deal, company, and Robert ---------
  // The deal link is what makes get_entity_history find these threads when
  // Kopilot is asked "help me close the Docket deal".
  await tx.insert(ThreadEntityLink).values([
    {
      id: 'mkt_dock_tel_t1_deal',
      organizationId: org.id,
      threadId: thread1Id,
      entityInstanceId: docketDeal.id,
      entityDefinitionId: dealDef.id,
      createdAt: t1Start,
    },
    {
      id: 'mkt_dock_tel_t1_company',
      organizationId: org.id,
      threadId: thread1Id,
      entityInstanceId: docketCompany.id,
      entityDefinitionId: companyDef.id,
      createdAt: t1Start,
    },
    {
      id: 'mkt_dock_tel_t1_contact',
      organizationId: org.id,
      threadId: thread1Id,
      entityInstanceId: robertContact.id,
      entityDefinitionId: contactDef.id,
      createdAt: t1Start,
    },
    {
      id: 'mkt_dock_tel_t2_deal',
      organizationId: org.id,
      threadId: thread2Id,
      entityInstanceId: docketDeal.id,
      entityDefinitionId: dealDef.id,
      createdAt: t2Start,
    },
    {
      id: 'mkt_dock_tel_t2_company',
      organizationId: org.id,
      threadId: thread2Id,
      entityInstanceId: docketCompany.id,
      entityDefinitionId: companyDef.id,
      createdAt: t2Start,
    },
    {
      id: 'mkt_dock_tel_t2_contact',
      organizationId: org.id,
      threadId: thread2Id,
      entityInstanceId: robertContact.id,
      entityDefinitionId: contactDef.id,
      createdAt: t2Start,
    },
  ])

  // -------- 5. Bump lastActivityAt on deal/company/contact -------------------
  await tx
    .update(EntityInstance)
    .set({ lastActivityAt: t2Start, updatedAt: new Date() })
    .where(inArray(EntityInstance.id, [docketDeal.id, docketCompany.id, robertContact.id]))
})

console.log('✓ Done.\n')
console.log(`  Scenario: ${SCENARIO}`)
console.log(`  Threads created: ${ID.threads.length}`)
console.log(`  Latest hook subject: "${SC.thread2.subject}"`)
console.log(
  '\n  Try in Kopilot:\n    1. "do we have any open deals?"\n    2. "help me close the Docket deal"\n'
)

await (database as unknown as { $client: { end: () => Promise<void> } }).$client.end()
process.exit(0)
