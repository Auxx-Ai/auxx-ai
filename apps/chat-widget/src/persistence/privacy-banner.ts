// apps/chat-widget/src/persistence/privacy-banner.ts
//
// Per-channel dismissal flag for the conversation-composer privacy banner.
// Once a visitor `×`s the notice on a given widget, the dismissal persists in
// localStorage so it does not re-appear on every page load. Scoped by
// channelId so different widgets on the same domain track independently.

const STORAGE_PREFIX = 'auxx-chat-privacy-dismissed:'

function storageKey(channelId: string): string {
  return `${STORAGE_PREFIX}${channelId}`
}

export function isPrivacyBannerDismissed(channelId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(channelId)) === '1'
  } catch {
    return false
  }
}

export function dismissPrivacyBanner(channelId: string): void {
  try {
    window.localStorage.setItem(storageKey(channelId), '1')
  } catch {
    /* ignore */
  }
}
