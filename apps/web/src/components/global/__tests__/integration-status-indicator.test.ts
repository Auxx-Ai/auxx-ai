// apps/web/src/components/global/__tests__/integration-status-indicator.test.ts

import { describe, expect, it } from 'vitest'
import { formatSyncStage, getIntegrationStatus } from '../integration-status-utils'

describe('getIntegrationStatus', () => {
  // disabled wins over everything
  it('returns disabled when not enabled, even if auth error', () => {
    expect(
      getIntegrationStatus({
        enabled: false,
        requiresReauth: true,
        lastAuthError: 'token expired',
      })
    ).toBe('disabled')
  })

  it('returns disabled when not enabled, even if syncing', () => {
    expect(
      getIntegrationStatus({
        enabled: false,
        syncStatus: 'SYNCING',
      })
    ).toBe('disabled')
  })

  it('returns disabled when not enabled, even if sync failed', () => {
    expect(
      getIntegrationStatus({
        enabled: false,
        syncStatus: 'FAILED',
      })
    ).toBe('disabled')
  })

  // auth_error wins over sync states
  it('returns auth_error when requiresReauth, even if syncStatus is FAILED', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
        requiresReauth: true,
        syncStatus: 'FAILED',
      })
    ).toBe('auth_error')
  })

  it('returns auth_error when lastAuthError present, even if syncStatus is SYNCING', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
        lastAuthError: 'invalid_grant',
        syncStatus: 'SYNCING',
      })
    ).toBe('auth_error')
  })

  it('returns auth_error when requiresReauth is true', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
        requiresReauth: true,
      })
    ).toBe('auth_error')
  })

  it('returns auth_error when lastAuthError is set', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
        lastAuthError: 'token expired',
      })
    ).toBe('auth_error')
  })

  // sync states
  it('returns syncing when syncStatus is SYNCING', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
        syncStatus: 'SYNCING',
      })
    ).toBe('syncing')
  })

  it('returns sync_error when syncStatus is FAILED', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
        syncStatus: 'FAILED',
      })
    ).toBe('sync_error')
  })

  // default — authenticated
  it('returns authenticated when syncStatus is ACTIVE', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
        syncStatus: 'ACTIVE',
      })
    ).toBe('authenticated')
  })

  it('returns authenticated when syncStatus is NOT_SYNCED', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
        syncStatus: 'NOT_SYNCED',
      })
    ).toBe('authenticated')
  })

  it('returns authenticated when syncStatus is null', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
        syncStatus: null,
      })
    ).toBe('authenticated')
  })

  it('returns authenticated when syncStatus is undefined', () => {
    expect(
      getIntegrationStatus({
        enabled: true,
      })
    ).toBe('authenticated')
  })
})

describe('formatSyncStage', () => {
  it('returns label for MESSAGE_LIST_FETCH_PENDING', () => {
    expect(formatSyncStage('MESSAGE_LIST_FETCH_PENDING')).toBe('Preparing to fetch messages')
  })

  it('returns label for MESSAGE_LIST_FETCH', () => {
    expect(formatSyncStage('MESSAGE_LIST_FETCH')).toBe('Fetching message list')
  })

  it('returns label for MESSAGES_IMPORT_PENDING', () => {
    expect(formatSyncStage('MESSAGES_IMPORT_PENDING')).toBe('Preparing to import messages')
  })

  it('returns label for MESSAGES_IMPORT', () => {
    expect(formatSyncStage('MESSAGES_IMPORT')).toBe('Importing messages')
  })

  it('returns label for FAILED', () => {
    expect(formatSyncStage('FAILED')).toBe('Sync failed')
  })

  it('returns label for IDLE', () => {
    expect(formatSyncStage('IDLE')).toBe('In progress')
  })

  it('appends remaining count for MESSAGES_IMPORT_PENDING', () => {
    expect(formatSyncStage('MESSAGES_IMPORT_PENDING', 58)).toBe(
      'Preparing to import messages (58 remaining)'
    )
  })

  it('appends remaining count for MESSAGES_IMPORT', () => {
    expect(formatSyncStage('MESSAGES_IMPORT', 1234)).toBe('Importing messages (1,234 remaining)')
  })

  it('omits remaining count when zero', () => {
    expect(formatSyncStage('MESSAGES_IMPORT', 0)).toBe('Importing messages')
  })

  it('ignores remaining count for non-import stages', () => {
    expect(formatSyncStage('MESSAGE_LIST_FETCH', 58)).toBe('Fetching message list')
  })
})
