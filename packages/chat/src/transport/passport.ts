// packages/chat/src/transport/passport.ts

import { getApiBase } from '~/shared/runtime-config'

const STORAGE_PREFIX = 'auxx_passport_chat_'
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

interface StoredPassport {
  passport: string
  visitorParticipantId: string
  visitorId: string
  expiresAt: string
}

function storageKey(channelId: string): string {
  return `${STORAGE_PREFIX}${channelId}`
}

function readStored(channelId: string): StoredPassport | null {
  try {
    const raw = window.localStorage.getItem(storageKey(channelId))
    if (!raw) return null
    return JSON.parse(raw) as StoredPassport
  } catch {
    return null
  }
}

function writeStored(channelId: string, value: StoredPassport): void {
  try {
    window.localStorage.setItem(storageKey(channelId), JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

function clearStored(channelId: string): void {
  try {
    window.localStorage.removeItem(storageKey(channelId))
  } catch {
    /* ignore */
  }
}

function isValid(stored: StoredPassport): boolean {
  const expiresAt = new Date(stored.expiresAt).getTime()
  if (Number.isNaN(expiresAt)) return false
  return expiresAt - Date.now() > EXPIRY_BUFFER_MS
}

function expiresInToIso(expiresIn: string): string {
  const match = /^(\d+)([smhd])$/.exec(expiresIn.trim())
  if (!match) return new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const amount = Number(match[1])
  const unit = match[2]
  const ms =
    unit === 's'
      ? amount * 1000
      : unit === 'm'
        ? amount * 60_000
        : unit === 'h'
          ? amount * 3_600_000
          : /* 'd' */ amount * 86_400_000
  return new Date(Date.now() + ms).toISOString()
}

async function mintPassport(channelId: string, visitorId: string | null): Promise<StoredPassport> {
  const res = await fetch(`${getApiBase()}/api/chat/passport`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId, visitorId: visitorId ?? undefined }),
  })
  const json = (await res.json()) as
    | {
        success: true
        data: {
          passport: string
          visitorId: string
          visitorParticipantId: string
          expiresIn: string
        }
      }
    | { success: false; error: { code: string; message: string } }
  if (!res.ok || !json.success) {
    throw new Error(
      'success' in json && !json.success
        ? json.error.message
        : `Passport request failed (${res.status})`
    )
  }
  return {
    passport: json.data.passport,
    visitorId: json.data.visitorId,
    visitorParticipantId: json.data.visitorParticipantId,
    expiresAt: expiresInToIso(json.data.expiresIn),
  }
}

let inflight: Promise<StoredPassport> | null = null

/**
 * Get a usable passport for this channel. Reads localStorage, validates expiry
 * with a 5-minute buffer, and mints/refreshes via the api when needed. Multiple
 * concurrent callers share a single in-flight mint.
 */
export async function getChatPassport(
  channelId: string,
  opts: { force?: boolean } = {}
): Promise<StoredPassport> {
  if (!opts.force) {
    const stored = readStored(channelId)
    if (stored && isValid(stored)) return stored
  } else {
    clearStored(channelId)
  }

  if (inflight) return inflight
  inflight = (async () => {
    try {
      const existing = readStored(channelId)
      const fresh = await mintPassport(channelId, existing?.visitorId ?? null)
      writeStored(channelId, fresh)
      return fresh
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/**
 * Replace the stored passport with one issued by the backend out-of-band
 * (e.g. `/api/chat/initialize` or `/api/chat/visitor-info` returned a refreshed
 * token after an identify claim was merged in).
 */
export function updateStoredPassport(
  channelId: string,
  args: { token: string; expiresIn: string }
): void {
  const existing = readStored(channelId)
  if (!existing) return
  writeStored(channelId, {
    ...existing,
    passport: args.token,
    expiresAt: expiresInToIso(args.expiresIn),
  })
}
