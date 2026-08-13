// packages/lib/src/providers/google/messages/__tests__/create-message.test.ts
//
// loop-guard plan §6 supplement — Gmail now stamps `X-AuxxAi-Message-Id` on
// outbound (additive to the wire `Message-ID`, which Gmail already sets from
// our own value), so a cross-channel echo through an intermediate that
// rewrites `Message-ID` still resolves at the org-scoped suppress-only check
// in `store-message.ts`.

import { describe, expect, it } from 'vitest'
import { createEmailMessage } from '../create-message'

describe('createEmailMessage — X-AuxxAi-Message-Id stamping', () => {
  it('stamps X-AuxxAi-Message-Id when internalMessageId is provided', async () => {
    const message = await createEmailMessage({
      from: 'agent@example.com',
      to: 'customer@example.com',
      subject: 'Re: Order',
      text: 'Hello',
      internalMessageId: 'msg_abc123',
    })

    expect(message).toContain('X-AuxxAi-Message-Id: msg_abc123')
  })

  it('omits the header when internalMessageId is not provided', async () => {
    const message = await createEmailMessage({
      from: 'agent@example.com',
      to: 'customer@example.com',
      subject: 'Re: Order',
      text: 'Hello',
    })

    expect(message).not.toContain('X-AuxxAi-Message-Id')
  })
})
