// apps/chat-widget/src/main.tsx
//
// Entry point for the embedded chat widget. Reads `data-channel-id` off its
// own <script> tag, mounts the Preact app inside a body-level container, and
// injects the inlined stylesheet so the bundle is fully self-contained.

import { render } from 'preact'
import styles from './styles.css?inline'
import { Widget } from './widget'

const ROOT_ID = 'auxx-chat-widget-root'
const STYLE_ID = 'auxx-chat-widget-styles'

function findScriptTag(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null
  if (current && current.dataset.channelId) return current
  const all = document.querySelectorAll<HTMLScriptElement>('script[data-channel-id]')
  return all[all.length - 1] ?? null
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = styles
  document.head.appendChild(tag)
}

function mount(channelId: string): void {
  injectStyles()
  let root = document.getElementById(ROOT_ID)
  if (!root) {
    root = document.createElement('div')
    root.id = ROOT_ID
    document.body.appendChild(root)
  }
  render(<Widget channelId={channelId} />, root)
}

function boot(): void {
  const tag = findScriptTag()
  const channelId = tag?.dataset.channelId
  if (!channelId) {
    console.error('[auxx-chat-widget] missing data-channel-id on script tag')
    return
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(channelId), { once: true })
  } else {
    mount(channelId)
  }
}

boot()
