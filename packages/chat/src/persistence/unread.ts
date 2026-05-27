// packages/chat/src/persistence/unread.ts
//
// Per-thread "last read at" timestamps stored in localStorage. The widget uses
// these to compute unread counts off the per-visitor channel without needing a
// server round-trip — a thread is unread iff its `lastMessageAt` is newer than
// the visitor's `lastReadAt` for that thread.

const STORAGE_PREFIX = 'auxx-chat-read:'

interface ReadMap {
  [threadId: string]: string // ISO timestamp
}

function storageKey(channelId: string): string {
  return `${STORAGE_PREFIX}${channelId}`
}

function readMap(channelId: string): ReadMap {
  try {
    const raw = window.localStorage.getItem(storageKey(channelId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ReadMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(channelId: string, map: ReadMap): void {
  try {
    window.localStorage.setItem(storageKey(channelId), JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export function getLastReadAt(channelId: string, threadId: string): string | null {
  return readMap(channelId)[threadId] ?? null
}

export function markThreadRead(channelId: string, threadId: string, at: Date = new Date()): void {
  const map = readMap(channelId)
  map[threadId] = at.toISOString()
  writeMap(channelId, map)
}

export function getAllReadMap(channelId: string): ReadMap {
  return readMap(channelId)
}
