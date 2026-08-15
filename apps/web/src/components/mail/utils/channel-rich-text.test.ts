// apps/web/src/components/mail/utils/channel-rich-text.test.ts

import { describe, expect, it } from 'vitest'
import { supportsRichText } from './channel-rich-text'

describe('supportsRichText', () => {
  it('is true for every email provider', () => {
    for (const provider of ['google', 'outlook', 'email', 'imap', 'mailgun']) {
      expect(supportsRichText(provider)).toBe(true)
    }
  })

  it('is false for plain-text messaging providers', () => {
    for (const provider of ['sms', 'openphone', 'whatsapp', 'facebook', 'instagram', 'chat']) {
      expect(supportsRichText(provider)).toBe(false)
    }
  })

  it('falls back to rich text for an unknown or absent provider', () => {
    expect(supportsRichText(null)).toBe(true)
    expect(supportsRichText(undefined)).toBe(true)
    expect(supportsRichText('')).toBe(true)
    expect(supportsRichText('some-future-provider')).toBe(true)
  })
})
