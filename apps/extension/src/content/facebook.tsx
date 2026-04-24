// apps/extension/src/content/facebook.tsx

/**
 * Facebook content script. Mounts the "Add to Auxx" button as the first
 * action in the profile action row (contains Message / Add Friend / Follow).
 * Facebook uses 8px rounded squares rather than pills so we pass a per-host
 * style override to createAuxxButton. The parser itself self-detects person
 * vs company; this script treats every profile uniformly.
 */

import { AUXX_BUTTON_ID, createAuxxButton } from '../lib/button-injection'
import { queryXpath } from '../lib/dom'
import { parseFacebook } from '../lib/parsers/facebook'
import { openPanel, setupContentScript } from './_shared'

const FB_ACTION_ROW_XPATH =
  '//div[@role="main"]/div[1]/div[2]//*[@role="button"]/ancestor::div[count(child::*) >= 2][1]'

const FACEBOOK_BUTTON_STYLE = `
  #${CSS.escape(AUXX_BUTTON_ID)} {
    gap: 8px !important;
    padding-inline: 12px !important;
    height: 36px !important;
    border-radius: 8px !important;
    margin-right: 4px !important;
    margin-top: 8px !important;
  }
  #${CSS.escape(AUXX_BUTTON_ID)} span {
    font-size: 14px !important;
    line-height: 24px !important;
    font-weight: 500 !important;
  }
  #${CSS.escape(AUXX_BUTTON_ID)} svg {
    width: 20px !important;
    height: 20px !important;
  }
`

function ensureProfileButton(): void {
  const actionRow = queryXpath(FB_ACTION_ROW_XPATH)
  if (!actionRow) return
  if (document.getElementById(AUXX_BUTTON_ID)) return
  const btn = createAuxxButton({
    contactType: 'person',
    extraStyleCss: FACEBOOK_BUTTON_STYLE,
    onClick: openPanel,
  })
  actionRow.prepend(btn)
}

setupContentScript({
  host: 'facebook',
  parsers: { parseFacebook },
  ensureButton: ensureProfileButton,
})
