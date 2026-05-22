// apps/chat-widget/src/main.tsx
//
// Entry point for the embedded chat widget. Reads `data-channel-id` off its
// own <script> tag and mounts the Preact app inside a closed Shadow DOM via
// `mountWidget` so host-page CSS cannot leak in.

import { installIdentifyQueue } from './identify'
import { mountWidget } from './shadow-root'
import { Widget } from './widget'

function findScriptTag(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null
  if (current && current.dataset.channelId) return current
  const all = document.querySelectorAll<HTMLScriptElement>('script[data-channel-id]')
  return all[all.length - 1] ?? null
}

function mount(channelId: string, cacheBust: string | null): void {
  installIdentifyQueue(channelId)
  mountWidget(<Widget channelId={channelId} cacheBust={cacheBust} />)
}

function boot(): void {
  const tag = findScriptTag()
  const channelId = tag?.dataset.channelId
  if (!channelId) {
    console.error('[auxx-chat-widget] missing data-channel-id on script tag')
    return
  }
  const cacheBust = tag?.dataset.v ?? null
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(channelId, cacheBust), { once: true })
  } else {
    mount(channelId, cacheBust)
  }
}

boot()
