// apps/web/src/lib/play-notification-sound.ts

/** Public paths for the bundled notification sounds (served from `public/`). */
export const NEW_MESSAGE_SOUND = '/sounds/new-message.mp3'
export const NEW_NOTIFICATION_SOUND = '/sounds/new-notification.mp3'

/** One reused `HTMLAudioElement` per source so rapid plays don't spawn nodes. */
const cache = new Map<string, HTMLAudioElement>()

/**
 * Play a short notification sound. The audio element is created lazily
 * (client-only) and reused. Autoplay rejections — when the tab hasn't had a
 * user gesture yet — are swallowed so callers never need to handle them.
 */
export function playNotificationSound(src: string, volume = 1): void {
  try {
    let el = cache.get(src)
    if (!el) {
      el = new Audio(src)
      el.volume = volume
      cache.set(src, el)
    }
    el.currentTime = 0
    void el.play().catch(() => {})
  } catch {
    /* ignore — audio unsupported or blocked */
  }
}
