// packages/lib/src/geo/__tests__/private-ip.test.ts

import { describe, expect, it } from 'vitest'
import { isPrivateIp } from '../private-ip'

describe('isPrivateIp', () => {
  it.each([
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['172.16.0.1'],
    ['172.31.255.254'],
    ['192.168.1.1'],
    ['127.0.0.1'],
    ['169.254.169.254'],
    ['0.0.0.0'],
  ])('treats %s as private (IPv4)', (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each([
    ['::1'],
    ['::'],
    ['fe80::1'],
    ['fc00::1'],
    ['fd12:3456:789a::1'],
  ])('treats %s as private (IPv6)', (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.32.0.1'],
    ['11.0.0.1'],
    ['192.169.1.1'],
    ['2606:4700:4700::1111'],
  ])('treats %s as public', (ip) => {
    expect(isPrivateIp(ip)).toBe(false)
  })

  it.each([
    ['  '],
    [''],
    ['not-an-ip'],
    ['256.0.0.1'],
    ['10.0.0'],
  ])('treats invalid input %s as private (fail closed)', (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })
})
