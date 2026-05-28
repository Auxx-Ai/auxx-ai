// packages/lib/src/geo/private-ip.ts

/**
 * Quick check for IPs that have no useful geo answer — RFC1918 private
 * ranges, loopback, link-local, and the IPv6 equivalents. Used to
 * short-circuit `lookupIp` so we don't hit MaxMind / ipapi with garbage
 * (and so local-dev `127.0.0.1` requests don't log noisy `AddressNotFound`
 * warnings).
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const octet = Number(part)
    if (octet < 0 || octet > 255) return null
    n = n * 256 + octet
  }
  return n
}

const PRIVATE_V4_RANGES: Array<[number, number]> = [
  [ipv4ToInt('10.0.0.0')!, ipv4ToInt('10.255.255.255')!],
  [ipv4ToInt('172.16.0.0')!, ipv4ToInt('172.31.255.255')!],
  [ipv4ToInt('192.168.0.0')!, ipv4ToInt('192.168.255.255')!],
  [ipv4ToInt('127.0.0.0')!, ipv4ToInt('127.255.255.255')!],
  [ipv4ToInt('169.254.0.0')!, ipv4ToInt('169.254.255.255')!],
  [ipv4ToInt('0.0.0.0')!, ipv4ToInt('0.255.255.255')!],
]

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1') return true
  if (lower === '::') return true
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  return false
}

export function isPrivateIp(ip: string): boolean {
  if (!ip) return true
  const trimmed = ip.trim()
  if (!trimmed) return true

  if (trimmed.includes(':')) {
    return isPrivateV6(trimmed)
  }

  const n = ipv4ToInt(trimmed)
  if (n === null) return true
  for (const [lo, hi] of PRIVATE_V4_RANGES) {
    if (n >= lo && n <= hi) return true
  }
  return false
}
