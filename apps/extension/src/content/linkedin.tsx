// apps/extension/src/content/linkedin.tsx

/**
 * LinkedIn content script — mounts buttons in five places:
 *
 *   1. Profile top-card action row       (contactType: 'person')
 *   2. Company profile action row        (contactType: 'company')
 *   3. DM conversation header            (contactType: 'person', opens panel for other participant)
 *   4. Search results — per-card checkboxes + bulk-add header button
 *   5. (deferred) Message compose toolbar — MessageTemplateApp
 *
 * Deferred to follow-up plans:
 *   - MessageTemplateApp (needs auxx-side message templates feature)
 *   - "Already in Auxx" async state flip (needs typed record.lookup endpoint)
 *   - Multi-select iframe sync for search (needs iframe-side selection pills)
 *   - Canonical URL resolution for dedup (currently uses raw URL)
 */

import {
  AUXX_BUTTON_ID,
  type ContactType,
  createAuxxButton,
  shouldRemountForUrl,
} from '../lib/button-injection'
import { observeDocumentBody, queryXpath, queryXpathAll } from '../lib/dom'
import { parseLinkedIn } from '../lib/parsers/linkedin'
import { parseLinkedInCompany } from '../lib/parsers/linkedin-company'
import { normalizeUrl } from '../lib/url-normalize'
import { openPanel, setupContentScript } from './_shared'

// ─── Selector constants ───────────────────────────────────────

/** Profile action row (top card): artdeco-dropdown trigger → walk up two parents. */
const PERSON_PROFILE_ACTIONS_XPATH =
  '//section[@data-member-id]//*[contains(@class, "artdeco-dropdown__trigger") and not(starts-with(@id, "cover-photo-dropdown"))]/../..' +
  '|//main//*[@data-view-name="profile-overflow-button"]/..' +
  '|//main//section//figure[@aria-hidden="true"]//ancestor::a[1]/following-sibling::*[1]' +
  '|//main//section//figure[@aria-hidden="true"]//ancestor::a[1]/following-sibling::*[1]/div'

/** True if the top card shows the "Add goals" CTA — i.e. viewing own profile. */
const OWN_PROFILE_XPATH = "//*[@id='top-card-ctas-add-goals-trigger']"

/** Exclude the cover-photo dropdown — it sits in section[data-member-id] too. */
const COVER_PHOTO_EXCLUDE_XPATH =
  "//section[@data-member-id]//*[(starts-with(@id, 'cover-photo-dropdown'))]"

const COMPANY_PROFILE_ACTIONS_XPATH = '//*[contains(@class, "org-top-card-primary-actions__inner")]'

const MESSAGE_HEADER_XPATH = '//*[contains(@class, "msg-title-bar__title-bar-title")]'

/** Search results: per-card profile entries. */
const SEARCH_PROFILE_CARDS_XPATH =
  '//*[@data-view-name="search-entity-result-universal-template"]' +
  '|//*[@data-view-name="people-search-result"]' +
  '|//*[@role="list"]//*[@role="listitem"]/div'

const SEARCH_RESULTS_SECTION_XPATH =
  '//main//*[contains(@class, "search-results-container")]' +
  '|//*[@data-view-name="people-search-result"]/../..' +
  '|//*[@data-testid="lazy-column"]'

const SEARCH_RESULTS_LOADER_XPATH = '//main//*[contains(@class, "search-results-loader")]'

// ─── Per-host CSS shell ───────────────────────────────────────

const LINKEDIN_BUTTON_STYLE = `
  #${CSS.escape(AUXX_BUTTON_ID)} {
    display: flex !important;
    align-items: center !important;
    padding: 4px 12px !important;
    height: 32px;
    border-style: solid !important;
    border-radius: 100px !important;
    flex-shrink: 0 !important;
    gap: 4px;
    min-width: auto !important;
    font-size: 14px;
    line-height: 17.5px;
    font-weight: 600;
  }
  #${CSS.escape(AUXX_BUTTON_ID)} svg {
    width: 20px;
    height: 20px;
    margin-inline-start: -6px;
  }
`

// ─── Profile-link extractor ───────────────────────────────────

function extractProfileLink(card: Element): string | null {
  const anchor = queryXpath(
    './/a[starts-with(@href, "https://www.linkedin.com/in/")]',
    card
  ) as HTMLAnchorElement | null
  if (!anchor) return null
  const match = new URL(anchor.href).pathname.match(/\/in\/([^/]+)/)
  return match?.[1] ? `https://www.linkedin.com/in/${match[1]}` : null
}

/** Skip headless / non-member URNs in search cards. */
function isHeadlessOrNonMember(card: Element): boolean {
  const urn = card.getAttribute('data-chameleon-result-urn')
  if (!urn) return false
  const isHeadless = urn === 'urn:li:member:headless'
  const isMember = urn.startsWith('urn:li:member')
  return isHeadless || !isMember
}

// ─── Mount helper ─────────────────────────────────────────────

type MountOptions = {
  container: Element
  url: string
  contactType: ContactType
  onClick?: () => void
}

function mountButton({ container, url, contactType, onClick }: MountOptions): void {
  document.getElementById(AUXX_BUTTON_ID)?.remove()

  const btn = createAuxxButton({
    contactType,
    extraStyleCss: LINKEDIN_BUTTON_STYLE,
    onClick,
  })

  if (contactType === 'company') {
    // Company action row uses this class for native action-button layout.
    btn.classList.add('org-top-card-primary-actions__action')
  }

  btn.setAttribute('data-href', url)
  container.appendChild(btn)
}

// ─── Main sweep ───────────────────────────────────────────────

function sweepAllMountPoints(): void {
  // Skip while the search page is still loading.
  if (queryXpath(SEARCH_RESULTS_LOADER_XPATH)) return

  const currentUrl = location.href

  // 1. Person profile
  const personContainer = queryXpath(PERSON_PROFILE_ACTIONS_XPATH)
  const coverPhotoExclude = queryXpath(COVER_PHOTO_EXCLUDE_XPATH)
  const isOwnProfile = !!queryXpath(OWN_PROFILE_XPATH)
  if (personContainer && !coverPhotoExclude && !isOwnProfile && shouldRemountForUrl(currentUrl)) {
    ;(personContainer as HTMLElement).style.alignItems = 'center'
    mountButton({ container: personContainer, url: currentUrl, contactType: 'person' })
  }

  // 2. Company profile
  const companyContainer = queryXpath(COMPANY_PROFILE_ACTIONS_XPATH)
  if (companyContainer && shouldRemountForUrl(currentUrl)) {
    mountButton({ container: companyContainer, url: currentUrl, contactType: 'company' })
  }

  // 3. DM conversation header — deep-link to the other participant's profile
  const dmHeader = queryXpath(MESSAGE_HEADER_XPATH)
  const dmParticipantHref = dmHeader
    ?.querySelector<HTMLAnchorElement>('a[href^="https://www.linkedin.com/in/"]')
    ?.getAttribute('href')
  if (dmHeader && dmParticipantHref && shouldRemountForUrl(dmParticipantHref)) {
    mountButton({
      container: dmHeader,
      url: dmParticipantHref,
      contactType: 'person',
      onClick: openPanel,
    })
  }

  // 4. Search results page
  if (location.pathname.startsWith('/search/results')) {
    mountSearchResults()
  }

  // TODO(plan 19): MessageTemplateApp in the compose toolbar + conversation
  //   bubbles. Needs auxx templates feature first.
}

// ─── Search results multi-select ──────────────────────────────

type SearchCard = { externalId: string; element: Element }

let selectedExternalIds: string[] = []

function getSearchProfileCards(): SearchCard[] {
  return queryXpathAll(SEARCH_PROFILE_CARDS_XPATH)
    .map((el) => {
      if (isHeadlessOrNonMember(el)) return null
      const profileUrl = extractProfileLink(el)
      if (!profileUrl) return null
      return { externalId: profileUrl, element: el }
    })
    .filter((x): x is SearchCard => x !== null)
}

const SEARCH_CHECKBOX_PREFIX = 'auxx-search-checkbox'
const SEARCH_HEADER_ID = 'auxx-search-header'
const SEARCH_HEADER_BUTTON_ID = 'auxx-search-header-button'
const SEARCH_SELECT_ALL_ID = 'auxx-search-select-all'
const SEARCH_SELECT_ALL_LABEL_ID = 'auxx-search-select-all-label'

function checkboxIdFor(externalId: string): string {
  // Collapse the URL to a dom-id-safe slug.
  return `${SEARCH_CHECKBOX_PREFIX}-${externalId.replace(/[^\w-]/g, '_')}`
}

function setSelected(ids: string[]): void {
  selectedExternalIds = ids
  syncCheckboxesAndHeaderButton()
}

function mountSearchResults(): void {
  ensureSearchStylesInjected()

  const cards = getSearchProfileCards()
  for (const { externalId, element } of cards) {
    const id = checkboxIdFor(externalId)
    if (document.getElementById(id)) continue
    ;(element as HTMLElement).style.display = 'flex'
    const lastChild = element.lastElementChild
    if (lastChild instanceof HTMLElement) lastChild.style.cssText = 'flex: 1; min-width: 0;'
    element.prepend(
      buildCardCheckbox({
        id,
        checked: selectedExternalIds.includes(externalId),
        onChange: (checked) =>
          setSelected(
            checked
              ? [...selectedExternalIds, externalId]
              : selectedExternalIds.filter((x) => x !== externalId)
          ),
      })
    )
  }

  if (cards.length === 0) return

  const headerContainer = queryXpath(SEARCH_RESULTS_SECTION_XPATH)
  if (headerContainer && !document.getElementById(SEARCH_HEADER_ID)) {
    headerContainer.prepend(
      buildSearchHeader({
        onCheckboxChange: (checked) =>
          setSelected(checked ? getSearchProfileCards().map((c) => c.externalId) : []),
        onButtonClick: () => {
          const all = getSearchProfileCards().map((c) => c.externalId)
          if (selectedExternalIds.length === 0) setSelected(all)
          openPanel()
        },
      })
    )
  }

  syncCheckboxesAndHeaderButton()
}

function buildCardCheckbox(opts: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
}): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'margin: 2.4rem 0 1.2rem 1.6rem'
  const { checkbox, label } = buildCheckboxPair({
    id: opts.id,
    onChange: opts.onChange,
  })
  checkbox.checked = opts.checked
  wrap.appendChild(checkbox)
  wrap.appendChild(label)
  return wrap
}

function buildSearchHeader(opts: {
  onCheckboxChange: (checked: boolean) => void
  onButtonClick: () => void
}): HTMLElement {
  const section = document.createElement('section')
  // Inherit LinkedIn's card styling where possible.
  const inheritClass =
    document.querySelector('.artdeco-card')?.className ||
    queryXpath(
      '//*[@data-view-name="people-search-result"]/..|//*[@data-testid="lazy-column"]/div[1]//*[@role="list"]/..'
    )?.className ||
    ''
  section.className = inheritClass
  section.id = SEARCH_HEADER_ID
  section.style.cssText =
    'display: flex; flex-direction: row; align-items: center; padding: 1.6rem; margin-bottom: 4rem; gap: 1rem;'

  const { checkbox, label } = buildCheckboxPair({
    id: SEARCH_SELECT_ALL_ID,
    labelId: SEARCH_SELECT_ALL_LABEL_ID,
    labelText: 'Select all',
    onChange: opts.onCheckboxChange,
  })
  label.style.cssText = 'margin: 0; font-size: 14px; color: rgba(0,0,0,0.75);'

  const button = buildBulkAddButton(opts.onButtonClick)
  button.style.marginLeft = 'auto'

  section.appendChild(checkbox)
  section.appendChild(label)
  section.appendChild(button)
  return section
}

function buildBulkAddButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.id = SEARCH_HEADER_BUTTON_ID
  btn.type = 'button'
  btn.innerHTML = `
    <svg viewBox="0 0 68 68" width="20" height="20" aria-hidden="true">
      <g fill="currentColor">
        <path d="M7.74,39.14c-.69,0-1.39-.24-1.95-.72-1.37-1.17-1.29-3.34-.02-4.62L31.78,7.59c1.19-1.2,3.13-1.2,4.32,0l26.06,26.25c1.05,1.05,1.31,2.73.47,3.96-1.11,1.61-3.31,1.75-4.62.44l-24.04-24.22s-.04-.02-.06,0l-24.04,24.22c-.59.59-1.36.89-2.13.89Z"/>
        <rect x="18.88" y="31.89" width="13.68" height="13.79" rx="2.46" ry="2.46"/>
        <rect x="33.93" y="31.89" width="13.68" height="13.79" rx="2.39" ry="2.39"/>
        <rect x="33.93" y="47.06" width="13.68" height="13.79" rx="2.5" ry="2.5"/>
      </g>
    </svg>
    <span>Add to Auxx</span>
  `
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  const style = document.createElement('style')
  style.textContent = `
    #${CSS.escape(SEARCH_HEADER_BUTTON_ID)} {
      background-color: #000;
      color: #fff;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      border: 1px solid transparent;
      cursor: pointer;
      padding-inline: 8px 10px;
      height: 32px;
      border-radius: 100px;
      flex-shrink: 0;
      font-size: 16px;
      line-height: 20px;
      font-weight: 600;
    }
    #${CSS.escape(SEARCH_HEADER_BUTTON_ID)} svg {
      width: 20px;
      height: 20px;
      color: white;
      flex-shrink: 0;
      margin: 0 4px 0 -2px;
    }
    #${CSS.escape(SEARCH_HEADER_BUTTON_ID)}:hover { background-color: rgba(0, 0, 0, 0.8); }
  `
  document.head.appendChild(style)
  return btn
}

function buildCheckboxPair(opts: {
  id: string
  labelId?: string
  labelText?: string
  onChange: (checked: boolean) => void
}): { checkbox: HTMLInputElement; label: HTMLLabelElement } {
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.className = 'auxx-checkbox'
  checkbox.id = opts.id
  checkbox.addEventListener('change', () => opts.onChange(checkbox.checked))

  const label = document.createElement('label')
  label.htmlFor = opts.id
  if (opts.labelId) label.id = opts.labelId
  label.style.userSelect = 'none'
  label.textContent = opts.labelText ?? ''

  return { checkbox, label }
}

function syncCheckboxesAndHeaderButton(): void {
  const cards = getSearchProfileCards()
  const visibleSelected = cards
    .map((c) => c.externalId)
    .filter((id) => selectedExternalIds.includes(id))

  // Update bulk-add button label
  const buttonSpan = document.querySelector<HTMLSpanElement>(
    `#${CSS.escape(SEARCH_HEADER_BUTTON_ID)} span`
  )
  if (buttonSpan) {
    const count = visibleSelected.length > 0 ? visibleSelected.length : cards.length
    const next = `Add ${count} ${count === 1 ? 'person' : 'people'} to Auxx`
    if (buttonSpan.textContent !== next) buttonSpan.textContent = next
  }

  // Update per-card checkboxes
  for (const { externalId } of cards) {
    const checkbox = document.getElementById(checkboxIdFor(externalId)) as HTMLInputElement | null
    if (!checkbox) continue
    const checked = selectedExternalIds.includes(externalId)
    checkbox.checked = checked
    checkbox.setAttribute('aria-checked', String(checked))
  }

  // Update header "Select all" state
  const selectAll = document.getElementById(SEARCH_SELECT_ALL_ID) as HTMLInputElement | null
  const selectAllLabel = document.getElementById(SEARCH_SELECT_ALL_LABEL_ID)
  if (!selectAll || !selectAllLabel) return
  const status =
    cards.length === visibleSelected.length
      ? 'all'
      : visibleSelected.length === 0
        ? 'none'
        : 'mixed'
  switch (status) {
    case 'none':
      selectAll.checked = false
      selectAll.indeterminate = false
      selectAll.setAttribute('aria-checked', 'false')
      if (selectAllLabel.textContent !== 'Select all') selectAllLabel.textContent = 'Select all'
      break
    case 'all':
      selectAll.checked = true
      selectAll.indeterminate = false
      selectAll.setAttribute('aria-checked', 'true')
      if (selectAllLabel.textContent !== 'Unselect all') selectAllLabel.textContent = 'Unselect all'
      break
    case 'mixed':
      selectAll.checked = false
      selectAll.indeterminate = true
      selectAll.setAttribute('aria-checked', 'mixed')
      if (selectAllLabel.textContent !== 'Select all') selectAllLabel.textContent = 'Select all'
      break
  }
}

// CSS for the hand-rolled checkbox (clip-path check mark, no SVG).
function ensureSearchStylesInjected(): void {
  const id = 'auxx-search-styles'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    .auxx-checkbox[type="checkbox"] {
      -webkit-appearance: none !important;
      appearance: none !important;
      accent-color: initial !important;
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff;
      border: 1.5px solid #000;
      outline: none;
      inline-size: 24px;
      block-size: 24px;
      display: inline-grid;
      place-items: center;
      border-radius: 0.4rem;
      cursor: pointer;
    }
    .auxx-checkbox[type="checkbox"]:hover:not(:disabled) {
      box-shadow: 0 0 0 1px rgba(0,0,0,0.8) inset;
    }
    .auxx-checkbox[type="checkbox"]::before {
      content: "";
      width: 100%;
      height: 100%;
      background: #000;
      transform: scale(0);
      clip-path: polygon(41.67% 68.33%, 25% 51.67%, 30.83% 45.83%, 41.67% 56.67%, 69.17% 29.17%, 75% 35%);
    }
    .auxx-checkbox[type="checkbox"]:checked::before { transform: scale(1); }
    .auxx-checkbox[type="checkbox"]:indeterminate::before {
      clip-path: polygon(25% 45%, 25% 55%, 75% 55%, 75% 45%);
      transform: scale(1);
    }
  `
  document.head.appendChild(style)
}

// ─── Bootstrap ────────────────────────────────────────────────

function ensureButton(): void {
  // We mount in every frame — the shared AUXX_BUTTON_ID + shouldRemountForUrl
  // dedup prevents duplicates.
  sweepAllMountPoints()
}

// The URL normalizer is used for the `data-href` dedup inside
// `shouldRemountForUrl` — the button stays put across SPA re-renders as
// long as the normalized URL still matches. Quiet the unused-import lint.
void normalizeUrl

setupContentScript({
  host: 'linkedin',
  parsers: {
    parseLinkedIn,
    parseLinkedInCompany,
  },
  ensureButton,
})

// Also re-sweep on body mutations — setupContentScript wires observeDocumentBody
// for the button, but the search-page state sync (selected-count label,
// checkbox state) needs its own tick too. observeDocumentBody already runs on
// every mutation, so we're good.
void observeDocumentBody
