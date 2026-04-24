// apps/extension/src/content/instagram.tsx

/**
 * Instagram content script — profile-only. Clone the native Follow /
 * Following / Message pill so the Auxx button inherits Instagram's shape,
 * spacing, CSS variable theming, and dark mode for free. Folk's approach.
 *
 * No search multi-select: Instagram's followers/following modal is heavily
 * rate-limited and virtualized, and `/explore/search/...` is a popover, not
 * a full route. v1 ships profile capture only.
 */

import { instagramExternalId } from '../lib/external-id'
import { lookupRecordId } from '../lib/lookup'
import { parseInstagramProfile } from '../lib/parsers/instagram'
import { openPanel, setupContentScript } from './_shared'

const AUXX_INSTAGRAM_BUTTON_ID = 'auxx-instagram-profile-button'
const AUXX_INSTAGRAM_STYLE_ID = 'auxx-instagram-profile-style'

function auxxLogoSvg(dimensions = 16): string {
  return `
    <svg viewBox="0 0 68 68" width="${dimensions}" height="${dimensions}" aria-hidden="true">
      <g fill="currentColor">
        <path d="M7.74,39.14c-.69,0-1.39-.24-1.95-.72-1.37-1.17-1.29-3.34-.02-4.62L31.78,7.59c1.19-1.2,3.13-1.2,4.32,0l26.06,26.25c1.05,1.05,1.31,2.73.47,3.96-1.11,1.61-3.31,1.75-4.62.44l-24.04-24.22s-.04-.02-.06,0l-24.04,24.22c-.59.59-1.36.89-2.13.89Z"/>
        <rect x="18.88" y="31.89" width="13.68" height="13.79" rx="2.46" ry="2.46"/>
        <rect x="33.93" y="31.89" width="13.68" height="13.79" rx="2.39" ry="2.39"/>
        <rect x="33.93" y="47.06" width="13.68" height="13.79" rx="2.5" ry="2.5"/>
      </g>
    </svg>
  `
}

function buildStyleBlock(): HTMLStyleElement {
  const style = document.createElement('style')
  style.id = AUXX_INSTAGRAM_STYLE_ID
  style.textContent = `
    #${AUXX_INSTAGRAM_BUTTON_ID} {
      background-color: rgb(var(--ig-secondary-button-background));
      color: rgb(var(--ig-primary-text));
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
    }
    #${AUXX_INSTAGRAM_BUTTON_ID}:hover {
      background-color: rgb(var(--ig-secondary-button-hover));
    }
    #${AUXX_INSTAGRAM_BUTTON_ID} svg { margin-left: -4px; }
  `
  return style
}

/**
 * Clone the native Follow button's parent wrapper, then overwrite the inner
 * button's content + id + click handler. We only touch the cloned subtree,
 * so Instagram's live React tree is untouched.
 */
function buildClonedButton(
  sourceWrapper: Element
): { wrapper: HTMLElement; button: HTMLElement } | null {
  const wrapper = sourceWrapper.cloneNode(true) as HTMLElement
  const button = wrapper.querySelector('button')
  if (!button) return null

  button.id = AUXX_INSTAGRAM_BUTTON_ID
  button.removeAttribute('aria-label')
  button.removeAttribute('aria-disabled')
  button.removeAttribute('type')
  button.setAttribute('type', 'button')
  button.innerHTML = `${auxxLogoSvg(16)}<span>Add to Auxx</span>`
  button.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    openPanel()
  })
  return { wrapper, button }
}

function usernameFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/([^/?#]+)/)
  return match?.[1] ?? null
}

async function checkAndFlipButton(button: HTMLElement, username: string): Promise<void> {
  const externalId = instagramExternalId(username)
  const recordId = await lookupRecordId('contact', [
    { systemAttribute: 'external_id', value: externalId },
  ])
  if (!recordId) return
  if (!document.contains(button) || button.getAttribute('data-username') !== username) return
  const span = button.querySelector('span')
  if (span) span.textContent = 'Open in Auxx'
}

function ensureProfileButton(): void {
  // Guard: the profile header h2/h1 must match the first URL path segment.
  const h2 = document.querySelector('[role="main"] header h2, main header h2')?.textContent?.trim()
  const h1 = document.querySelector('[role="main"] header h1, main header h1')?.textContent?.trim()
  const slug = usernameFromPath(location.pathname)
  if (!slug) return
  const headerUsername = h2 || h1
  if (!headerUsername || headerUsername.toLowerCase() !== slug.toLowerCase()) return

  if (document.getElementById(AUXX_INSTAGRAM_BUTTON_ID)) return

  // Find the Follow / Following / Message button — any <button> whose text
  // matches "follow". Covers all follow-state variants.
  const followBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    /follow/i.test(b.textContent ?? '')
  )
  if (!followBtn?.parentElement) return

  const cloned = buildClonedButton(followBtn.parentElement)
  if (!cloned) return
  cloned.button.setAttribute('data-username', slug)

  if (!document.getElementById(AUXX_INSTAGRAM_STYLE_ID)) {
    document.head.appendChild(buildStyleBlock())
  }
  followBtn.parentElement.insertAdjacentElement('afterend', cloned.wrapper)

  void checkAndFlipButton(cloned.button, slug)
}

setupContentScript({
  host: 'instagram',
  parsers: { parseInstagramProfile },
  ensureButton: ensureProfileButton,
})
