// apps/extension/src/content/gmail.tsx

import { parseGmail } from '../lib/parsers/gmail'
import { buildAuxxButton, openPanel, setupContentScript } from './_shared'

/**
 * Gmail content script. Injects an "Add to Auxx" button next to the Reply
 * action when an open thread is showing.
 */

function ensureButton(): void {
  // Look for the standard reply toolbar that wraps the Reply button.
  const replyBtn = document.querySelector(
    '[role="main"] [role="button"][aria-label="Reply" i]'
  ) as HTMLElement | null
  if (!replyBtn) return

  const toolbar = replyBtn.parentElement
  if (!toolbar) return

  if (toolbar.querySelector('#auxx-add-button-gmail')) return

  const btn = buildAuxxButton({ host: 'gmail', onClick: openPanel })
  toolbar.appendChild(btn)
}

setupContentScript({
  host: 'gmail',
  parsers: { parseGmail },
  ensureButton,
})
