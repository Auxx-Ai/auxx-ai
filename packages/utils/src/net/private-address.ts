// packages/utils/src/net/private-address.ts

import { BlockList, isIP } from 'node:net'

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

const BLOCKED_V6: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10],
  ['fc00::', 7],
  ['ff00::', 8],
]

const blocked = new BlockList()
for (const [net, prefix] of BLOCKED_V4) blocked.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of BLOCKED_V6) blocked.addSubnet(net, prefix, 'ipv6')

const loopback = new BlockList()
loopback.addSubnet('127.0.0.0', 8, 'ipv4')
loopback.addAddress('::1', 'ipv6')

/** Expands a v6 address to its eight hextets, or null if it does not parse. */
function hextets(ip: string): number[] | null {
  let canonical: string
  try {
    // The WHATWG serializer compresses and rewrites any dotted tail to hex.
    canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1)
  } catch {
    return null
  }
  const [head = '', tail] = canonical.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0')
  const groups = [...left, ...fill, ...right].map((g) => Number.parseInt(g, 16))
  return groups.length === 8 ? groups : null
}

/** The IPv4 address embedded in an IPv4-mapped, IPv4-compatible or NAT64 v6 address. */
function embeddedV4(ip: string): string | null {
  const h = hextets(ip)
  if (!h) return null
  const high = h.slice(0, 6)
  const isMapped = high.slice(0, 5).every((g) => g === 0) && h[5] === 0xffff
  const isCompat = high.every((g) => g === 0)
  const isNat64 = h[0] === 0x64 && h[1] === 0xff9b && high.slice(2).every((g) => g === 0)
  if (!isMapped && !isCompat && !isNat64) return null
  const a = h[6] as number
  const b = h[7] as number
  return `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`
}

/** Splits `ip` into the address the lists should see and its family, or null if not an IP. */
function classify(raw: string): { ip: string; family: 'ipv4' | 'ipv6' } | null {
  const ip =
    raw
      .trim()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? ''
  const version = isIP(ip)
  if (version === 4) return { ip, family: 'ipv4' }
  if (version !== 6) return null
  // `::` and `::1` are IPv4-compatible in form but are their own entries.
  if (ip === '::' || ip === '::1') return { ip, family: 'ipv6' }
  const v4 = embeddedV4(ip)
  return v4 ? { ip: v4, family: 'ipv4' } : { ip, family: 'ipv6' }
}

/** True for any private, loopback, link-local, reserved or non-IP input (fail closed). */
export function isBlockedAddress(ip: string): boolean {
  const c = classify(ip)
  return !c || blocked.check(c.ip, c.family)
}

let allowlistSource: string | undefined
let allowlist: BlockList | null = null

function readAllowlist(): BlockList | null {
  // Env-only config (see the credentials config registry), read directly so tier-1 packages can use this.
  const source = process.env.OUTBOUND_ALLOWED_CIDRS ?? ''
  if (source === allowlistSource) return allowlist
  allowlistSource = source
  allowlist = null
  for (const entry of source.split(',').map((s) => s.trim())) {
    const [net = '', prefix] = entry.split('/')
    const version = isIP(net)
    if (!version) continue
    const max = version === 4 ? 32 : 128
    const bits = prefix === undefined ? max : Number(prefix)
    if (!Number.isInteger(bits) || bits < 0 || bits > max) continue
    allowlist ??= new BlockList()
    allowlist.addSubnet(net, bits, version === 4 ? 'ipv4' : 'ipv6')
  }
  return allowlist
}

/**
 * Whether a server-side request may connect to `ip`: public, inside `OUTBOUND_ALLOWED_CIDRS`,
 * or loopback outside production (local MCP mocks and e2e servers).
 */
export function isOutboundAddressAllowed(ip: string): boolean {
  const c = classify(ip)
  if (!c) return false
  if (!blocked.check(c.ip, c.family)) return true
  if (readAllowlist()?.check(c.ip, c.family)) return true
  return process.env.NODE_ENV !== 'production' && loopback.check(c.ip, c.family)
}
