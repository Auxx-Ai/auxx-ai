// packages/utils/src/net/__tests__/private-address.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { isBlockedAddress, isOutboundAddressAllowed } from '../private-address'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isBlockedAddress', () => {
  it.each([
    // [first, last] of every blocked v4 range
    ['0.0.0.0', '0.255.255.255'],
    ['10.0.0.0', '10.255.255.255'],
    ['100.64.0.0', '100.127.255.255'],
    ['127.0.0.0', '127.255.255.255'],
    ['169.254.0.0', '169.254.255.255'],
    ['172.16.0.0', '172.31.255.255'],
    ['192.0.0.0', '192.0.0.255'],
    ['192.0.2.0', '192.0.2.255'],
    ['192.168.0.0', '192.168.255.255'],
    ['198.18.0.0', '198.19.255.255'],
    ['198.51.100.0', '198.51.100.255'],
    ['203.0.113.0', '203.0.113.255'],
    ['224.0.0.0', '239.255.255.255'],
    ['240.0.0.0', '255.255.255.255'],
  ])('blocks %s through %s', (first, last) => {
    expect(isBlockedAddress(first)).toBe(true)
    expect(isBlockedAddress(last)).toBe(true)
  })

  it.each([
    '9.255.255.255',
    '11.0.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '126.255.255.255',
    '128.0.0.0',
    '169.253.255.255',
    '172.15.255.255',
    '172.32.0.0',
    '192.0.1.0',
    '192.167.255.255',
    '192.169.0.0',
    '198.17.255.255',
    '198.20.0.0',
    '203.0.114.0',
    '223.255.255.255',
    '8.8.8.8',
  ])('lets public %s through', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })

  it.each([
    '::',
    '::1',
    'fe80::1',
    'febf:ffff::1',
    'fc00::1',
    'fd12:3456:789a::1',
    'ff02::1',
    '[::1]',
    'fe80::1%en0',
  ])('blocks v6 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    'fec0::1',
  ])('lets public v6 %s through', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })

  it.each([
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::10.0.0.1',
    '::127.0.0.1',
    '0:0:0:0:0:ffff:c0a8:0101',
  ])('unwraps embedded v4 in %s and blocks it', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([
    '::ffff:8.8.8.8',
    '::ffff:808:808',
    '64:ff9b::808:808',
  ])('unwraps embedded public v4 in %s and lets it through', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })

  it.each([
    '',
    '  ',
    'localhost',
    'not-an-ip',
    '256.0.0.1',
    '10.0.0',
  ])('fails closed on %j', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })
})

describe('isOutboundAddressAllowed', () => {
  it('allows loopback outside production only', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(isOutboundAddressAllowed('127.0.0.1')).toBe(true)
    expect(isOutboundAddressAllowed('::1')).toBe(true)
    expect(isOutboundAddressAllowed('10.0.0.1')).toBe(false)

    vi.stubEnv('NODE_ENV', 'production')
    expect(isOutboundAddressAllowed('127.0.0.1')).toBe(false)
    expect(isOutboundAddressAllowed('::1')).toBe(false)
    expect(isOutboundAddressAllowed('8.8.8.8')).toBe(true)
  })

  it('lets a listed CIDR through and nothing else', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('OUTBOUND_ALLOWED_CIDRS', '10.0.5.0/24, fd12::/16, garbage, 10.9.9.9/99')
    expect(isOutboundAddressAllowed('10.0.5.7')).toBe(true)
    expect(isOutboundAddressAllowed('::ffff:10.0.5.7')).toBe(true)
    expect(isOutboundAddressAllowed('fd12:1::1')).toBe(true)
    expect(isOutboundAddressAllowed('10.0.6.1')).toBe(false)
    expect(isOutboundAddressAllowed('10.9.9.9')).toBe(false)
    expect(isOutboundAddressAllowed('fd13::1')).toBe(false)
    expect(isOutboundAddressAllowed('169.254.169.254')).toBe(false)
  })

  it('treats a bare address as a single-host range', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('OUTBOUND_ALLOWED_CIDRS', '192.168.1.10')
    expect(isOutboundAddressAllowed('192.168.1.10')).toBe(true)
    expect(isOutboundAddressAllowed('192.168.1.11')).toBe(false)
  })
})
