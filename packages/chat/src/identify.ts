// packages/chat/src/identify.ts
//
// Embed surface for `window.AuxxChat.identify(...)`. Embedders push commands
// onto a queue before the widget bundle loads:
//
//     window.AuxxChat = window.AuxxChat || []
//     window.AuxxChat.push(['identify', { name, email, externalId }])
//
// On boot we drain the queue and replace it with a real handler. The latest
// payload is persisted to sessionStorage so the next `initialize` call carries
// it; once a session exists, subsequent identify calls dispatch through a
// listener so the widget can refresh visitor-info via the API.

export interface IdentifyPayload {
  name?: string
  email?: string
  externalId?: string
}

type IdentifyCommand = ['identify', IdentifyPayload]
type AuxxChatCommand = IdentifyCommand
type AuxxChatHandle =
  | AuxxChatCommand[]
  | { push: (command: AuxxChatCommand) => void; identify: (payload: IdentifyPayload) => void }

declare global {
  interface Window {
    AuxxChat?: AuxxChatHandle
  }
}

const STORAGE_PREFIX = 'auxx-chat-identify:'
const listeners = new Set<(payload: IdentifyPayload) => void>()

function storageKey(channelId: string): string {
  return `${STORAGE_PREFIX}${channelId}`
}

/** Read the most recent identify payload persisted for this channel. */
export function getStoredIdentify(channelId: string): IdentifyPayload | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(channelId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as IdentifyPayload
    return normalize(parsed)
  } catch {
    return null
  }
}

/** Subscribe to future identify() calls. Returns an unsubscribe. */
export function onIdentify(listener: (payload: IdentifyPayload) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Install the runtime handler on `window.AuxxChat`. Drains any commands
 * queued before the bundle loaded, then replaces the array with an object
 * that forwards future pushes through the same dispatch path.
 */
export function installIdentifyQueue(channelId: string): void {
  const existing = window.AuxxChat
  const queue: AuxxChatCommand[] = Array.isArray(existing) ? (existing as AuxxChatCommand[]) : []

  const dispatch = (command: AuxxChatCommand): void => {
    if (!Array.isArray(command) || command[0] !== 'identify') return
    const payload = normalize(command[1])
    if (!payload) return
    try {
      window.sessionStorage.setItem(storageKey(channelId), JSON.stringify(payload))
    } catch {
      /* ignore quota errors */
    }
    listeners.forEach((l) => l(payload))
  }

  window.AuxxChat = {
    push: dispatch,
    identify: (payload: IdentifyPayload) => dispatch(['identify', payload]),
  }

  for (const cmd of queue) dispatch(cmd)
}

function normalize(payload: IdentifyPayload | null | undefined): IdentifyPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const name = trimmed(payload.name)
  const email = trimmed(payload.email)
  const externalId = trimmed(payload.externalId)
  if (!name && !email && !externalId) return null
  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(externalId ? { externalId } : {}),
  }
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t.length ? t : undefined
}
