// packages/lib/src/files/file-type-constants.test.ts

import { describe, expect, it } from 'vitest'
import { CATEGORY_MIME_PATTERNS, getMimePatternsForCategories } from './file-type-constants'
import { enforceUploadPolicy } from './storage/presign'
import type { UploadPolicy } from './types/entities'

/**
 * These patterns feed two consumers with different pattern languages: a browser
 * `accept` attribute, and `enforceUploadPolicy`'s allow-list. Both understand
 * only `*​/*`, `type/*`, or an exact MIME. A `document` entry once carried
 * `'application/vnd.openxmlformats-officedocument.*'`, which fell through
 * `enforceUploadPolicy`'s two wildcard branches into exact string equality and
 * therefore matched nothing - every Office upload to a `document` field was
 * refused at the upload door, and the browser silently ignored it too.
 */
describe('CATEGORY_MIME_PATTERNS', () => {
  it('uses only wildcard forms both consumers understand', () => {
    const offenders: string[] = []
    for (const [category, patterns] of Object.entries(CATEGORY_MIME_PATTERNS)) {
      for (const pattern of patterns) {
        if (!pattern.includes('*')) continue
        if (pattern === '*/*' || pattern.endsWith('/*')) continue
        offenders.push(`${category}: ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

function policyFor(categories: Parameters<typeof getMimePatternsForCategories>[0]): UploadPolicy {
  return {
    keyPrefix: '',
    maxTtl: 600,
    contentLengthRange: [0, 25 * 1024 * 1024],
    allowedMimeTypes: getMimePatternsForCategories(categories),
  } as UploadPolicy
}

function accepts(policy: UploadPolicy, mimeType: string): boolean {
  try {
    enforceUploadPolicy(policy, {
      storageKey: 'anything',
      ttlSec: 60,
      expectedSize: 1024,
      mimeType,
    } as Parameters<typeof enforceUploadPolicy>[1])
    return true
  } catch {
    return false
  }
}

describe("the 'document' category, through the real policy matcher", () => {
  const policy = policyFor(['document'])

  // The regression: a vendor quote arrives as a spreadsheet often enough that
  // plans/money/tasks/38 §0 puts xlsx on the critical path.
  it.each([
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['legacy xls', 'application/vnd.ms-excel'],
    ['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
    ['pdf', 'application/pdf'],
    ['csv', 'text/csv'],
  ])('admits %s', (_label, mimeType) => {
    expect(accepts(policy, mimeType)).toBe(true)
  })

  it('still refuses what the category never covered', () => {
    expect(accepts(policy, 'image/png')).toBe(false)
    expect(accepts(policy, 'video/mp4')).toBe(false)
  })
})
