// apps/extension/src/content/sales-navigator.tsx

import { salesNavExternalId } from '../lib/external-id'
import { lookupRecordId } from '../lib/lookup'
import { parseSalesNavigator } from '../lib/parsers/sales-navigator'
import { buildAuxxButton, openPanel, setupContentScript } from './_shared'

/**
 * Sales Navigator profile content script. Injects "Add to Auxx" near the
 * profile action bar (next to "Save to list").
 */

function ensureButton(): void {
  if (!location.pathname.startsWith('/sales/lead/')) return

  const saveBtn = document.querySelector(
    'button[data-anonymize="save-to-list"], button[aria-label*="Save to list" i]'
  ) as HTMLElement | null
  if (!saveBtn) return

  const actionBar = saveBtn.parentElement
  if (!actionBar) return

  if (actionBar.querySelector('#auxx-add-button-sales-navigator')) return

  const btn = buildAuxxButton({ host: 'sales-navigator', onClick: openPanel })
  actionBar.appendChild(btn)

  void checkAndFlipButton(btn)
}

async function checkAndFlipButton(btn: HTMLElement): Promise<void> {
  const match = location.pathname.match(/^\/sales\/lead\/([^,/]+)/)
  if (!match?.[1]) return
  const externalId = salesNavExternalId(match[1])
  const recordId = await lookupRecordId('contact', [
    { systemAttribute: 'external_id', value: externalId },
  ])
  if (!recordId) return
  if (!document.contains(btn)) return
  // `buildAuxxButton` creates a text-only button (no child <span>), so flip
  // the text node directly.
  btn.textContent = 'Open in Auxx'
}

setupContentScript({
  host: 'sales-navigator',
  parsers: { parseSalesNavigator },
  ensureButton,
})
