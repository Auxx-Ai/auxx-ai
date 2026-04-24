// apps/extension/src/lib/button-injection.ts

/**
 * Shared-id button injection. One DOM id (`auxx-linkedin-button`) across all
 * instances in a page — we dedup across SPA re-renders via a `data-href`
 * attribute comparison.
 *
 * Two visual states:
 *   - default: filled dark pill, "Add to Auxx"
 *   - `.in-auxx`: outlined pill, "Open in Auxx"
 *
 * Host sites (LinkedIn / Facebook / WhatsApp / Google Meet) use CSS-in-JS
 * with unstable class names, so the button ships its own keyed `<style>`
 * block with `!important` on everything.
 */

import { normalizeUrl } from './url-normalize'

/** Shared id across all instances (profile/company/DM). */
export const AUXX_BUTTON_ID = 'auxx-linkedin-button'

/**
 * Auxx logo mark — arch + three rounded squares from
 * `apps/homepage/src/app/icon.tsx`, drawn on the button in `currentColor`
 * so it inverts with the button state (white on filled-black default,
 * black on outlined-white in-auxx). We drop the blue circle backdrop from
 * the full brand mark so the glyph blends with either button background.
 */
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

export type ContactType = 'person' | 'company'

export type CreateAuxxButtonOptions = {
  /** DOM id for the button. Default: `AUXX_BUTTON_ID`. */
  id?: string
  /** Used later for the "already in Auxx" check (plan follow-up). */
  contactType: ContactType
  /**
   * Extra CSS appended *after* the base style block. Per-host overrides
   * (font-size, padding, etc.) go here.
   */
  extraStyleCss?: string
  onIsInAuxx?: () => void
  onClick?: () => void
}

/**
 * Create the button. Does NOT mount it — caller appends into the right
 * container. Idempotent when combined with `ensureAuxxButton` below, which
 * takes care of URL-change dedup.
 */
export function createAuxxButton(opts: CreateAuxxButtonOptions): HTMLButtonElement {
  const {
    id = AUXX_BUTTON_ID,
    extraStyleCss = '',
    onClick = openPanel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for plan-follow-up
    contactType: _contactType,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onIsInAuxx: _onIsInAuxx,
  } = opts

  // Style block — base + per-host override. Keyed to `#${id}` so multiple
  // pages of instances don't collide.
  const styleId = `${id}-style`
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `${baseStyle(id)}\n${extraStyleCss}`
    document.head.appendChild(style)
  }

  const btn = document.createElement('button')
  btn.id = id
  btn.type = 'button'
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  btn.innerHTML = `${auxxLogoSvg(20)}<span>Add to Auxx</span>`

  // TODO(plan 19): when we have a typed `record.lookup` endpoint, kick off
  //   the async "is this already in Auxx?" check here and call
  //   `markInAuxx({ button: btn })` + `onIsInAuxx?.()` on hit.

  return btn
}

/**
 * Ensure-and-refresh helper: if the existing button already matches `url`
 * (normalized), leave it; otherwise remove + remount.
 *
 * Returns `true` if the button needs (re)mounting, `false` if the existing
 * one is still valid.
 */
export function shouldRemountForUrl(url: string): boolean {
  const existing = document.getElementById(AUXX_BUTTON_ID)
  if (!existing) return true
  const existingHref = existing.getAttribute('data-href')
  if (!existingHref) return true
  return normalizeUrl(existingHref) !== normalizeUrl(url)
}

/** Mark the button as "already in Auxx" (outlined state + "Open in Auxx" label). */
export function markInAuxx(button: HTMLElement): void {
  const span = button.querySelector('span')
  if (span) span.textContent = 'Open in Auxx'
  button.classList.add('in-auxx')
}

/**
 * Reset the button to the default "Add to Auxx" state — used after the user
 * deletes the saved record or when we fail to verify "in Auxx" status.
 */
export function clearInAuxx(button: HTMLElement): void {
  const span = button.querySelector('span')
  if (span) span.textContent = 'Add to Auxx'
  button.classList.remove('in-auxx')
}

/** Fire the extension's panel open — default click handler. */
function openPanel(): void {
  chrome.runtime.sendMessage({ type: 'invoke', operation: 'showFrame', args: [] })
}

// ─── Base CSS ──────────────────────────────────────────────────

/**
 * Shell that all per-host variants share. Per-host overrides (font-size,
 * padding, border-radius, icon sizing) land in `extraStyleCss`.
 *
 * Two-state colour model — default black bg/white text; `.in-auxx` white
 * bg/black border.
 */
function baseStyle(id: string): string {
  const key = `#${CSS.escape(id)}`
  return `
    ${key} {
      background-color: #68b2fc !important;
      color: white !important;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      border-width: 1px;
      border-style: solid;
      border-color: transparent;
      cursor: pointer;
    }
    ${key}.in-auxx {
      background-color: white !important;
      border-color: #202020 !important;
    }
    ${key}:hover {
      opacity: 0.8;
      box-shadow: 0 2px 7px rgba(0,0,0,0.09), 0 1px 2px rgba(0,0,0,0.05);
    }
    ${key}.in-auxx:hover { opacity: 1; }
    ${key} svg { color: white !important; }
    ${key} span { color: white !important; }
    ${key}.in-auxx svg { color: black !important; }
    ${key}.in-auxx span { color: black !important; }
  `
}
