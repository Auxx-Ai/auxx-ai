// apps/web/src/components/global/__tests__/integration-status-indicator.test.ts

import { describe, expect, it } from 'vitest'
import { getIntegrationStatus } from '../integration-status-utils'

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
