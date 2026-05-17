// packages/lib/src/ai/kopilot/prompts/sections/__tests__/integration-catalog.test.ts

import { describe, expect, it } from 'vitest'
import type { IntegrationCatalogEntry } from '../../../../../cache/integration-catalog'
import { makeCtx } from '../__test-helpers'
import { integrationCatalog } from '../integration-catalog'

const sampleIntegration = {
  integrationId: 'i1',
  displayName: 'Gmail',
  platform: 'gmail',
  channel: 'email',
  recipientModel: 'email',
  newOutbound: true,
  threadReply: true,
  subject: true,
  ccBcc: false,
  drafts: true,
  attachments: false,
} as IntegrationCatalogEntry

describe('integrationCatalog', () => {
  it('interactive fallback tells the user', () => {
    const out = integrationCatalog.render(makeCtx({ runMode: 'interactive' }))
    expect(out).toContain('Tell the user to connect one')
  })

  it('autonomous fallback says to note in summary', () => {
    const out = integrationCatalog.render(makeCtx({ runMode: 'autonomous' }))
    expect(out).toContain('note the missing integration in your summary')
  })

  it('renders capability bits', () => {
    const out = integrationCatalog.render(
      makeCtx({ runMode: 'interactive', integrations: [sampleIntegration] })
    )
    expect(out).toContain('newOutbound, threadReply, subject, drafts')
    expect(out).not.toContain('cc/bcc')
  })
})
