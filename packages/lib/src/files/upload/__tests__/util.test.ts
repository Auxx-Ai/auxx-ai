// packages/lib/src/files/upload/__tests__/util.test.ts

/**
 * The pure filename and MIME helpers `buildUploadConfig` is built out of.
 *
 * Salvaged from `unified-processor-system.test.ts`, which PR 4d deleted along
 * with the processors: the two thirds of that file that poked at
 * `ProcessorRegistry.getProcessorCount()` and asserted that an object literal
 * typed as `UploadInitConfig` had the properties it was written with went with
 * it. What is below is the third that tested something.
 *
 * `vi.mock` count in this file: **zero**.
 */

import { describe, expect, it } from 'vitest'
import {
  clamp,
  deriveStorageKey,
  getDefaultKeyPrefix,
  normalizeEntityType,
  normalizeMimeType,
  sanitizeFileName,
} from '../util'

describe('clamp', () => {
  it.each([
    [5, 5],
    [-5, 0],
    [15, 10],
  ])('clamps %i to %i within [0, 10]', (input, expected) => {
    expect(clamp(input, 0, 10)).toBe(expected)
  })
})

describe('sanitizeFileName', () => {
  it.each([
    ['test file.pdf', 'test_file.pdf'],
    ['file@#$.txt', 'file___.txt'],
    ['normal-file.doc', 'normal-file.doc'],
  ])('rewrites %s to %s', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected)
  })
})

describe('normalizeEntityType', () => {
  it.each([
    ['USER_PROFILE', 'user-profile'],
    ['WORKFLOW_RUN', 'workflow-run'],
    ['visit_qc_item', 'visit-qc-item'],
  ])('folds %s into the key segment %s', (input, expected) => {
    expect(normalizeEntityType(input)).toBe(expected)
  })
})

describe('deriveStorageKey', () => {
  it('puts the organization first, so an org can be deleted by prefix', () => {
    const key = deriveStorageKey('org123', 'test.pdf', {
      entityType: 'FILE',
      entityId: 'temp',
      nowMs: 1_700_000_000_000,
    })
    expect(key).toBe('org123/file/temp/1700000000000_test.pdf')
  })

  it('reads the wall clock only when no instant is supplied', () => {
    const key = deriveStorageKey('org123', 'test.pdf', { entityType: 'FILE', entityId: 'temp' })
    expect(key).toMatch(/^org123\/file\/temp\/\d+_test\.pdf$/)
  })

  it('carries a key seed between the timestamp and the name', () => {
    const key = deriveStorageKey('org123', 'test.pdf', {
      entityType: 'FILE',
      entityId: 'temp',
      keySeed: 'abc',
      nowMs: 1,
    })
    expect(key).toBe('org123/file/temp/1_abc_test.pdf')
  })
})

describe('normalizeMimeType', () => {
  it.each([
    ['APPLICATION/PDF', 'application/pdf'],
    ['text/plain; charset=utf-8', 'text/plain'],
    ['Image/JPEG', 'image/jpeg'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeMimeType(input)).toBe(expected)
  })
})

describe('getDefaultKeyPrefix', () => {
  it('is the org id with a trailing slash', () => {
    expect(getDefaultKeyPrefix('org123')).toBe('org123/')
  })

  it('is empty for an empty org, so the policy prefix rule cannot pass vacuously', () => {
    expect(getDefaultKeyPrefix('  ')).toBe('')
  })
})
