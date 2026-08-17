// apps/web/src/components/mail/email-editor/derive-initial.test.ts
//
// Chip identity. `RecipientState.id` used to be whatever id the chip's source
// happened to carry — here, `Participant.id` from a draft's participants or a
// reply's `from`. The parent removes chips by that id and the badge list keys on
// it, so a source that can hand back the same id twice produced two chips that
// could not be told apart. These pin: ids are minted per chip, and reply-all's
// "don't Cc the sender again" dedupe keys on the identifier (the only field that
// still means what it used to).

import { ParticipantRole } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { deriveInitialState } from './derive-initial'
import type { DraftMessageType, MessageType } from './types'

const participant = (id: string, identifier: string, name = 'Ada') => ({
  id,
  identifier,
  identifierType: 'EMAIL',
  name,
})

describe('deriveInitialState — chip ids', () => {
  it('mints a chip id per draft recipient instead of reusing Participant.id', () => {
    const draft = {
      id: 'd1',
      participants: [
        { role: ParticipantRole.TO, participant: participant('p1', 'a@x.com') },
        { role: ParticipantRole.CC, participant: participant('p2', 'b@x.com') },
      ],
    } as unknown as DraftMessageType

    const state = deriveInitialState({ mode: 'draft', draft })

    expect(state.to).toHaveLength(1)
    expect(state.cc).toHaveLength(1)
    expect(state.to[0]?.identifier).toBe('a@x.com')
    expect(state.to[0]?.id).not.toBe('p1')
    expect(state.cc[0]?.id).not.toBe('p2')
    expect(state.to[0]?.id).not.toBe(state.cc[0]?.id)
  })

  it('mints a chip id for the reply sender instead of reusing the message from id', () => {
    const sourceMessage = {
      id: 'm1',
      from: participant('p1', 'sender@x.com'),
      participants: [],
    } as unknown as MessageType

    const state = deriveInitialState({ mode: 'reply', sourceMessage })

    expect(state.to[0]?.identifier).toBe('sender@x.com')
    expect(state.to[0]?.id).not.toBe('p1')
    expect(state.to[0]?.id).toBeTruthy()
  })

  it('reply-all does not Cc the sender again — the dedupe keys on identifier', () => {
    // The regression this guards: the old dedupe compared a chip id against
    // `Participant.id`. Once chip ids are minted, that comparison matches
    // nothing, and the sender lands in both TO and CC.
    const sender = participant('p1', 'sender@x.com', 'Sender')
    const sourceMessage = {
      id: 'm1',
      from: sender,
      participants: [
        { role: ParticipantRole.TO, participant: sender },
        { role: ParticipantRole.CC, participant: participant('p2', 'other@x.com', 'Other') },
      ],
    } as unknown as MessageType

    const state = deriveInitialState({ mode: 'replyAll', sourceMessage })

    expect(state.to.map((r) => r.identifier)).toEqual(['sender@x.com'])
    expect(state.cc.map((r) => r.identifier)).toEqual(['other@x.com'])
  })

  it('reply-all still dedupes when the sender appears under a different Participant row', () => {
    // Same address, different `Participant.id` — an id-keyed dedupe never caught
    // this case at all, so it is strictly new coverage.
    const sourceMessage = {
      id: 'm1',
      from: participant('p1', 'sender@x.com'),
      participants: [{ role: ParticipantRole.TO, participant: participant('p9', 'sender@x.com') }],
    } as unknown as MessageType

    const state = deriveInitialState({ mode: 'replyAll', sourceMessage })

    expect(state.cc).toHaveLength(0)
  })

  it('gives every chip a distinct id across TO, CC and BCC', () => {
    const draft = {
      id: 'd1',
      participants: [
        { role: ParticipantRole.TO, participant: participant('p1', 'a@x.com') },
        { role: ParticipantRole.TO, participant: participant('p2', 'b@x.com') },
        { role: ParticipantRole.CC, participant: participant('p3', 'c@x.com') },
        { role: ParticipantRole.BCC, participant: participant('p4', 'd@x.com') },
      ],
    } as unknown as DraftMessageType

    const state = deriveInitialState({ mode: 'draft', draft })
    const ids = [...state.to, ...state.cc, ...state.bcc].map((r) => r.id)

    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })
})
