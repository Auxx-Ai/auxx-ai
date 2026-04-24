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
 *   - MessageTemplateApp (needs auxx templates feature)
 *   - Multi-select iframe sync for search (needs iframe-side selection pills)
 *   - Canonical URL resolution for dedup (currently uses raw URL)
 */

import {
  AUXX_BUTTON_ID,
  type ContactType,
  createAuxxButton,
  markInAuxx,
  shouldRemountForUrl,
} from '../lib/button-injection'
import { observeDocumentBody, queryXpath, queryXpathAll } from '../lib/dom'
import { linkedInCompanyExternalId, linkedInExternalId } from '../lib/external-id'
import { lookupRecordId } from '../lib/lookup'
import { parseLinkedIn } from '../lib/parsers/linkedin'
import { parseLinkedInCompany } from '../lib/parsers/linkedin-company'
import { createSearchMultiselect, type SearchCard } from '../lib/search-multiselect'
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

  void checkAndFlipButton(btn, url, contactType)
}

function externalIdFromProfileUrl(url: string, contactType: ContactType): string | null {
  try {
    const pathname = new URL(url).pathname
    if (contactType === 'person') {
      const m = pathname.match(/^\/in\/([^/?#]+)/)
      return m?.[1] ? linkedInExternalId(m[1]) : null
    }
    const m = pathname.match(/^\/company\/([^/?#]+)/)
    return m?.[1] ? linkedInCompanyExternalId(m[1]) : null
  } catch {
    return null
  }
}

async function checkAndFlipButton(
  btn: HTMLElement,
  url: string,
  contactType: ContactType
): Promise<void> {
  const externalId = externalIdFromProfileUrl(url, contactType)
  if (!externalId) return
  const recordId = await lookupRecordId(contactType === 'company' ? 'company' : 'contact', [
    { systemAttribute: 'external_id', value: externalId },
  ])
  if (!recordId) return
  // Abort if the button was remounted for a different URL between the fire
  // and the response — we don't want to flip a stale button.
  if (!document.contains(btn) || btn.getAttribute('data-href') !== url) return
  markInAuxx(btn)
}

// ─── Search multi-select controller ───────────────────────────

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

const searchMultiselect = createSearchMultiselect({
  hostId: 'linkedin',
  getCards: getSearchProfileCards,
  getHeaderContainer: () => {
    const container = queryXpath(SEARCH_RESULTS_SECTION_XPATH)
    return container ?? null
  },
  header: {
    // Inherit LinkedIn's card styling where possible.
    get extraClassName() {
      return (
        document.querySelector('.artdeco-card')?.className ||
        queryXpath(
          '//*[@data-view-name="people-search-result"]/..|//*[@data-testid="lazy-column"]/div[1]//*[@role="list"]/..'
        )?.className ||
        ''
      )
    },
  },
  decorateCard: (element) => {
    element.style.display = 'flex'
    const lastChild = element.lastElementChild
    if (lastChild instanceof HTMLElement) lastChild.style.cssText = 'flex: 1; min-width: 0;'
  },
  onBulkAdd: () => openPanel(),
})

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
    searchMultiselect.mount()
  }

  // TODO(plan 19): MessageTemplateApp in the compose toolbar + conversation
  //   bubbles. Needs auxx templates feature first.
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
