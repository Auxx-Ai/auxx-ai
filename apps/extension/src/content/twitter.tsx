// apps/extension/src/content/twitter.tsx

/**
 * Twitter / X content script. Two mount surfaces:
 *
 *   1. Profile page — cloned pill next to the native `userActions` menu.
 *      We `cloneNode(true)` the real button so we inherit Twitter's font,
 *      spacing, radius and dark-mode colors for free. If Twitter renames
 *      `data-testid="userActions"` this mount breaks — same fragility folk
 *      accepted.
 *
 *   2. Search / list modal — per-card checkboxes on each
 *      `[data-testid="UserCell"]` plus a sticky bulk-add header on the
 *      `/search` and `/i/lists/*` routes AND inside the Followers /
 *      Following / Likes modal (pinned via `position: sticky`).
 */

import { queryXpath } from '../lib/dom'
import { twitterExternalId } from '../lib/external-id'
import { lookupRecordId } from '../lib/lookup'
import { parseTwitterProfile, parseTwitterSearch } from '../lib/parsers/twitter'
import { createSearchMultiselect, type SearchCard } from '../lib/search-multiselect'
import { openPanel, setupContentScript } from './_shared'

// ─── Profile button (clone the native `userActions` pill) ───────

const AUXX_TWITTER_BUTTON_ID = 'auxx-twitter-profile-button'

const USER_ACTIONS_XPATH = '//button[@data-testid="userActions"]'

function auxxLogoSvg(dimensions = 20): string {
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

function cloneNativeActionButton(source: Element): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  clone.id = AUXX_TWITTER_BUTTON_ID
  // Strip Twitter's React hooks + a11y wiring — we manage state ourselves.
  clone.removeAttribute('data-testid')
  clone.removeAttribute('aria-label')
  clone.removeAttribute('aria-haspopup')
  clone.removeAttribute('aria-expanded')
  clone.removeAttribute('role')

  // Replace inner <svg> with our logo, preserve the wrapper so the native
  // padding / positioning classes keep working.
  const svg = clone.querySelector('svg')
  if (svg) {
    const wrap = document.createElement('span')
    wrap.style.cssText = 'display: inline-flex; align-items: center;'
    wrap.innerHTML = auxxLogoSvg(20)
    svg.replaceWith(wrap.firstElementChild ?? wrap)
  }

  // Replace or inject a <span> for the label. Twitter's kebab menu has no
  // text, but we want one so the button reads "Add to Auxx" and can flip
  // to "Open in Auxx" once the lookup resolves.
  const existingSpan = clone.querySelector('span')
  if (existingSpan) {
    existingSpan.textContent = 'Add to Auxx'
  } else {
    const span = document.createElement('span')
    span.textContent = 'Add to Auxx'
    span.style.cssText = 'margin-left: 6px; font-size: 14px; font-weight: 600;'
    clone.appendChild(span)
  }

  clone.style.marginLeft = '8px'
  clone.style.paddingInline = '12px'
  clone.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    openPanel()
  })
  return clone
}

function ensureProfileButton(): void {
  const userActions = queryXpath(USER_ACTIONS_XPATH)
  if (!userActions) return
  if (document.getElementById(AUXX_TWITTER_BUTTON_ID)) return
  const parent = userActions.parentElement
  if (!parent) return
  const username = usernameFromPath(location.pathname)
  const cloned = cloneNativeActionButton(userActions)
  cloned.setAttribute('data-username', username ?? '')
  parent.appendChild(cloned)
  void checkAndFlipProfileButton(cloned, username)
}

/**
 * First path segment on x.com is either a reserved route or a username.
 * Callers higher up filter the reserved set, but we re-guard here for
 * defense-in-depth.
 */
function usernameFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return null
  const first = parts[0]
  if (!first) return null
  if (first.startsWith('i') && first.length === 1) return null
  // Common non-username routes — keep this list tight; the iframe's
  // `detectTarget` has the authoritative check.
  const reserved = new Set([
    'home',
    'explore',
    'notifications',
    'messages',
    'search',
    'compose',
    'settings',
    'login',
    'signup',
    'logout',
  ])
  if (reserved.has(first)) return null
  return first
}

async function checkAndFlipProfileButton(btn: HTMLElement, username: string | null): Promise<void> {
  if (!username) return
  const externalId = twitterExternalId(username)
  const recordId = await lookupRecordId('contact', [
    { systemAttribute: 'external_id', value: externalId },
  ])
  if (!recordId) return
  if (!document.contains(btn) || btn.getAttribute('data-username') !== username) return
  const span = btn.querySelector('span')
  if (span) span.textContent = 'Open in Auxx'
}

// ─── Search / list multi-select ─────────────────────────────────

const SEARCH_PRIMARY_CELL = '[data-testid="primaryColumn"] [data-testid="UserCell"]'
const SEARCH_MODAL_CELL = '[aria-modal="true"] [data-testid="UserCell"]'

function cardFromCell(cell: Element): SearchCard | null {
  const link = cell.querySelector<HTMLAnchorElement>('a[role=link]')
  if (!link) return null
  let username: string | null = null
  try {
    username = new URL(link.href).pathname.replace(/^\//, '').split('/')[0] ?? null
  } catch {
    return null
  }
  if (!username) return null
  return { externalId: twitterExternalId(username), element: cell }
}

function getPrimaryCards(): SearchCard[] {
  return Array.from(document.querySelectorAll(SEARCH_PRIMARY_CELL))
    .map(cardFromCell)
    .filter((x): x is SearchCard => x !== null)
}

function getModalCards(): SearchCard[] {
  return Array.from(document.querySelectorAll(SEARCH_MODAL_CELL))
    .map(cardFromCell)
    .filter((x): x is SearchCard => x !== null)
}

const primarySearchMultiselect = createSearchMultiselect({
  hostId: 'twitter-primary',
  getCards: getPrimaryCards,
  getHeaderContainer: () =>
    document.querySelector('[data-testid="primaryColumn"] section')?.parentElement ??
    document.querySelector('[data-testid="primaryColumn"]'),
  header: {
    style:
      'display: flex; flex-direction: row; align-items: center; padding: 12px 16px; gap: 12px; border-bottom: 1px solid rgb(239, 243, 244);',
  },
  cardCheckboxWrapperStyle: 'margin: 12px 0 12px 16px; flex-shrink: 0;',
  onBulkAdd: () => openPanel(),
})

const modalSearchMultiselect = createSearchMultiselect({
  hostId: 'twitter-modal',
  getCards: getModalCards,
  // Prepend to the first modal cell's parent — that's the scroll container
  // holding all cells inside the Followers / Following / Likes modal. The
  // header uses `position: sticky` so it stays pinned as the list scrolls.
  getHeaderContainer: () => {
    const firstCell = document.querySelector(SEARCH_MODAL_CELL)
    return firstCell?.parentElement ?? null
  },
  header: {
    style:
      'position: sticky; top: 0; z-index: 10; display: flex; flex-direction: row; align-items: center; padding: 12px 16px; gap: 12px; background: var(--background, rgba(255,255,255,0.95)); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(128,128,128,0.2);',
  },
  cardCheckboxWrapperStyle: 'margin: 12px 0 12px 16px; flex-shrink: 0;',
  onBulkAdd: () => openPanel(),
})

function mountSearchMultiselect(): void {
  const hasPrimary =
    location.pathname.startsWith('/search') || location.pathname.startsWith('/i/lists/')
  if (hasPrimary) primarySearchMultiselect.mount()
  if (document.querySelector(SEARCH_MODAL_CELL)) modalSearchMultiselect.mount()
}

// ─── Sweep ─────────────────────────────────────────────────────

function sweepAllMountPoints(): void {
  ensureProfileButton()
  mountSearchMultiselect()
}

setupContentScript({
  host: 'twitter',
  parsers: {
    parseTwitterProfile,
    parseTwitterSearch,
  },
  ensureButton: sweepAllMountPoints,
})
