// apps/extension/src/content/sales-navigator.tsx

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
}

setupContentScript({
  host: 'sales-navigator',
  parsers: { parseSalesNavigator },
  ensureButton,
})
