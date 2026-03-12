// packages/lib/src/email/inbound/__tests__/object-keys.test.ts

import { describe, expect, it } from 'vitest'
import {
  buildInboundAttachmentKey,
  buildInboundHtmlBodyKey,
  deriveAttachmentId,
} from '../object-keys'

describe('buildInboundHtmlBodyKey', () => {
  it('returns a deterministic key for the same inputs', () => {
    const key1 = buildInboundHtmlBodyKey({
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-123',
    })
    const key2 = buildInboundHtmlBodyKey({
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-123',
    })

    expect(key1).toBe(key2)
  })

  it('includes organizationId and contentScopeId in the key', () => {
    const key = buildInboundHtmlBodyKey({
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-123',
    })

    expect(key).toBe('email/inbound/org_abc/ses-msg-123/body.html')
  })

  it('produces different keys for different organizations', () => {
    const key1 = buildInboundHtmlBodyKey({
      organizationId: 'org_1',
      contentScopeId: 'ses-msg-123',
    })
    const key2 = buildInboundHtmlBodyKey({
      organizationId: 'org_2',
      contentScopeId: 'ses-msg-123',
    })

    expect(key1).not.toBe(key2)
  })

  it('produces different keys for different contentScopeIds', () => {
    const key1 = buildInboundHtmlBodyKey({
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-1',
    })
    const key2 = buildInboundHtmlBodyKey({
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-2',
    })

    expect(key1).not.toBe(key2)
  })
})

describe('buildInboundAttachmentKey', () => {
  it('returns a deterministic key for the same inputs', () => {
    const params = {
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-123',
      attachmentId: 'aabbccdd112233445566aabb',
      filename: 'image.png',
    }

    expect(buildInboundAttachmentKey(params)).toBe(buildInboundAttachmentKey(params))
  })

  it('includes the attachment ID and sanitized filename', () => {
    const key = buildInboundAttachmentKey({
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-123',
      attachmentId: 'aabbccdd112233445566aabb',
      filename: 'image.png',
    })

    expect(key).toBe(
      'email/inbound/org_abc/ses-msg-123/attachments/aabbccdd112233445566aabb-image.png'
    )
  })

  it('sanitizes filenames with special characters', () => {
    const key = buildInboundAttachmentKey({
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-123',
      attachmentId: 'aabbccdd112233445566aabb',
      filename: 'my file (2).png',
    })

    expect(key).toContain('aabbccdd112233445566aabb-my_file__2_.png')
    expect(key).not.toContain(' ')
    expect(key).not.toContain('(')
    expect(key).not.toContain(')')
  })

  it('preserves safe filename characters', () => {
    const key = buildInboundAttachmentKey({
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-123',
      attachmentId: 'aabbccdd112233445566aabb',
      filename: 'my-file_v2.0.png',
    })

    expect(key).toContain('aabbccdd112233445566aabb-my-file_v2.0.png')
  })

  it('sanitizes unicode and emoji in filenames', () => {
    const key = buildInboundAttachmentKey({
      organizationId: 'org_abc',
      contentScopeId: 'ses-msg-123',
      attachmentId: 'aabbccdd112233445566aabb',
      filename: 'résumé_🎉.pdf',
    })

    expect(key).not.toMatch(/[^a-zA-Z0-9._\-/]/)
  })
})

describe('deriveAttachmentId', () => {
  it('returns a deterministic ID for the same inputs', () => {
    const id1 = deriveAttachmentId('ses-msg-123', 0, 'image.png')
    const id2 = deriveAttachmentId('ses-msg-123', 0, 'image.png')

    expect(id1).toBe(id2)
  })

  it('returns a 24-character hex string', () => {
    const id = deriveAttachmentId('ses-msg-123', 0, 'image.png')

    expect(id).toHaveLength(24)
    expect(id).toMatch(/^[0-9a-f]{24}$/)
  })

  it('produces different IDs for different contentScopeIds', () => {
    const id1 = deriveAttachmentId('ses-msg-1', 0, 'image.png')
    const id2 = deriveAttachmentId('ses-msg-2', 0, 'image.png')

    expect(id1).not.toBe(id2)
  })

  it('produces different IDs for different attachment orders', () => {
    const id1 = deriveAttachmentId('ses-msg-123', 0, 'image.png')
    const id2 = deriveAttachmentId('ses-msg-123', 1, 'image.png')

    expect(id1).not.toBe(id2)
  })

  it('produces different IDs for different filenames', () => {
    const id1 = deriveAttachmentId('ses-msg-123', 0, 'image.png')
    const id2 = deriveAttachmentId('ses-msg-123', 0, 'photo.jpg')

    expect(id1).not.toBe(id2)
  })

  it('does not depend on a database-generated message ID', () => {
    // The same contentScopeId (provider-stable identity) produces the same ID
    // regardless of what message row was created in the DB
    const id = deriveAttachmentId('ses-msg-123', 0, 'image.png')

    // Call again as if this were a retry with the same provider identity
    const retryId = deriveAttachmentId('ses-msg-123', 0, 'image.png')

    expect(id).toBe(retryId)
  })
})
