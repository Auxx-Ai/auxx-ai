// packages/lib/src/messages/__tests__/message-composer.thread-participants.test.ts
//
// The outbound `ThreadParticipant` rollup.
//
// The gap this closes: `ThreadManagerService.updateThreadParticipantCount` was
// called `updateThreadParticipants`, so the send path LOOKED like it maintained
// the rollup. It never did — it only wrote `Thread.participantCount`. An
// outbound-first thread therefore had zero rollup rows until someone replied and
// ingest wrote them, which made it invisible to contact-derived mail sharing
// (`mail-query/visibility-scope.ts` joins `ThreadParticipant.entityInstanceId`).
//
// Assertions are on the ROWS handed to the insert, not on a call count: "we
// called the rollup function" is exactly the kind of check that passed for the
// count-only method while the table stayed empty.

import { ParticipantRole } from '@auxx/database/enums'
import { describe, expect, it, vi } from 'vitest'
import { upsertOutboundThreadParticipants } from '../message-composer.service'
import type { ProcessedParticipant, ProcessedParticipants } from '../types/message-sending.types'

const AT = new Date('2026-08-15T05:15:53.000Z')

function participant(
  identifier: string,
  role: (typeof ParticipantRole)[keyof typeof ParticipantRole],
  extra: Partial<ProcessedParticipant> = {}
): ProcessedParticipant {
  return {
    id: `p_${identifier}`,
    identifier,
    identifierType: 'EMAIL',
    name: null,
    role,
    ...extra,
  } as ProcessedParticipant
}

/** Captures the rows handed to `insert().values()`; `onConflictDoUpdate` resolves. */
function makeTx() {
  const captured: { rows: unknown[][] } = { rows: [] }
  const tx = {
    insert: () => ({
      values: (rows: unknown[]) => {
        captured.rows.push(rows)
        return { onConflictDoUpdate: vi.fn(async () => undefined) }
      },
    }),
  }
  return { tx, captured }
}

const emails = (rows: unknown[]) => (rows as { email: string }[]).map((r) => r.email)

describe('upsertOutboundThreadParticipants', () => {
  it('writes a row for FROM, TO and CC', async () => {
    const { tx, captured } = makeTx()
    const participants: ProcessedParticipants = {
      from: participant('agent@auxx.ai', ParticipantRole.FROM),
      to: [participant('customer@example.com', ParticipantRole.TO)],
      cc: [participant('cc@example.com', ParticipantRole.CC)],
      all: [],
    }

    await upsertOutboundThreadParticipants(tx as never, 'th_1', participants, AT)

    expect(captured.rows).toHaveLength(1)
    expect(emails(captured.rows[0]!)).toEqual([
      'agent@auxx.ai',
      'customer@example.com',
      'cc@example.com',
    ])
  })

  it('EXCLUDES bcc — a rollup row is an access-granting fact', async () => {
    // A ThreadParticipant row is what lets a contact grant reach this thread.
    // Including a blind-copied recipient would hand that recipient's grantees the
    // whole conversation, inverting what BCC means.
    const { tx, captured } = makeTx()
    const participants: ProcessedParticipants = {
      from: participant('agent@auxx.ai', ParticipantRole.FROM),
      to: [participant('customer@example.com', ParticipantRole.TO)],
      bcc: [participant('secret@example.com', ParticipantRole.BCC)],
      all: [],
    }

    await upsertOutboundThreadParticipants(tx as never, 'th_1', participants, AT)

    expect(emails(captured.rows[0]!)).not.toContain('secret@example.com')
    expect(emails(captured.rows[0]!)).toEqual(['agent@auxx.ai', 'customer@example.com'])
  })

  it('carries entityInstanceId and isInternal onto the row', async () => {
    // entityInstanceId is the column contact-derived sharing joins on — a row
    // without it grants nobody anything, so this is the load-bearing field.
    const { tx, captured } = makeTx()
    const participants: ProcessedParticipants = {
      from: participant('agent@auxx.ai', ParticipantRole.FROM, { isInternal: true }),
      to: [
        participant('customer@example.com', ParticipantRole.TO, {
          entityInstanceId: 'ei_contact_1',
          name: 'Customer',
        }),
      ],
      all: [],
    }

    await upsertOutboundThreadParticipants(tx as never, 'th_1', participants, AT)

    expect(captured.rows[0]).toEqual([
      expect.objectContaining({
        threadId: 'th_1',
        email: 'agent@auxx.ai',
        isInternal: true,
        entityInstanceId: null,
        firstMessageAt: AT,
        lastMessageAt: AT,
        messageCount: 1,
      }),
      expect.objectContaining({
        email: 'customer@example.com',
        entityInstanceId: 'ei_contact_1',
        name: 'Customer',
        isInternal: false,
      }),
    ])
  })

  it('keys phone rows on the E.164 identifier, not an email', async () => {
    // The column is named `email` but holds the routing identifier, and must match
    // the key ingest writes or the unique index won't collapse the two sides.
    const { tx, captured } = makeTx()
    const participants: ProcessedParticipants = {
      from: participant('+18889155797', ParticipantRole.FROM, { identifierType: 'PHONE' }),
      to: [participant('+15102055536', ParticipantRole.TO, { identifierType: 'PHONE' })],
      all: [],
    }

    await upsertOutboundThreadParticipants(tx as never, 'th_1', participants, AT)

    expect(emails(captured.rows[0]!)).toEqual(['+18889155797', '+15102055536'])
  })

  it('skips participants with no identifier and inserts nothing when none remain', async () => {
    const { tx, captured } = makeTx()
    const participants = {
      from: participant('', ParticipantRole.FROM),
      to: [],
      all: [],
    } as unknown as ProcessedParticipants

    await upsertOutboundThreadParticipants(tx as never, 'th_1', participants, AT)

    expect(captured.rows).toHaveLength(0)
  })
})
