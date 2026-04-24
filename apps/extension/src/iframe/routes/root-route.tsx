// apps/extension/src/iframe/routes/root-route.tsx

import { Button } from '@auxx/ui/components/button'
import { useCallback, useEffect, useState } from 'react'
import type { PageOperation } from '../../lib/messaging'
import type { ParsedCompany, ParsedPerson, ParseResult } from '../../lib/parsers/types'
import { ParsedCard } from '../components/parsed-card'
import {
  BASE_URL,
  createRecord,
  type LookupByFieldCandidate,
  lookupByField,
  reportParserHealth,
  type SessionResponse,
  TrpcCallError,
  uploadAvatarFromUrl,
} from '../trpc'

/**
 * The capture-from-this-page flow. Lives inside the iframe shell's main
 * area when the route stack is `[root]`. Responsible for:
 *   - detecting supported host + target entity (contact vs company) from the
 *     active tab
 *   - invoking the parser via the background RPC
 *   - deduping against the network (externalId → primaryEmail fallback)
 *   - rendering parsed fields + Save / Open CTAs
 *
 * Signed-out / no-org cases short-circuit with the existing CTAs.
 */

type EntityType = 'contact' | 'company'

type Target = {
  host: SupportedHost
  entityType: EntityType
  parseOp: PageOperation
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'no-org' }
  | { kind: 'generic-site'; page: GenericPage | null; existingRecordId: string | null }
  | { kind: 'saving-generic'; page: GenericPage }
  | { kind: 'parsing'; target: Target }
  | {
      kind: 'ready'
      target: Target
      person: ParsedPerson | null
      company: ParsedCompany | null
      /**
       * Set when a prior capture of this same URL exists — either as a contact
       * OR a company, since the "Save as" buttons let the user pick either.
       * `entityType` is the one we actually found (may differ from
       * `target.entityType`), used to build the correct deep link.
       */
      existingMatch: { recordId: string; entityType: EntityType } | null
    }
  | { kind: 'saved'; entityType: EntityType; recordId: string }
  | { kind: 'needs-fb-contact-info'; profileUrl: string }
  | { kind: 'error'; message: string }

/**
 * The active tab's URL + title, normalized. Captured once on boot for the
 * generic-site capture view. `hostname` is lowercased and www-stripped so
 * it can double as a company_domain value on save.
 */
type GenericPage = {
  url: string
  title: string
  hostname: string
}

function readGenericPage(tab: chrome.tabs.Tab | null): GenericPage | null {
  const rawUrl = tab?.url
  if (!rawUrl) return null
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const hostname = u.hostname.replace(/^www\./, '').toLowerCase()
    if (!hostname) return null
    const title = (tab?.title ?? '').trim() || hostname
    return { url: rawUrl, title, hostname }
  } catch {
    return null
  }
}

type SupportedHost = 'gmail' | 'linkedin' | 'sales-navigator' | 'twitter' | 'facebook' | 'instagram'

const HOST_LABEL: Record<SupportedHost, string> = {
  gmail: 'Gmail',
  linkedin: 'LinkedIn',
  'sales-navigator': 'Sales Navigator',
  twitter: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
}

/**
 * Top-level x.com / twitter.com paths that aren't usernames. Without this
 * guard, the iframe would try to parse a profile out of `x.com/home` and
 * silently fail.
 */
const TWITTER_RESERVED_PATHS = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'i',
  'compose',
  'settings',
  'tos',
  'privacy',
  'about',
  'search',
  'login',
  'signup',
  'logout',
  'account',
  'jobs',
  'premium_sign_up',
])

/**
 * Top-level facebook.com paths that aren't profiles. `profile.php` is
 * whitelisted by falling through — we key dedup off the `id` query param.
 */
const FACEBOOK_RESERVED_PATHS = new Set([
  'home',
  'marketplace',
  'groups',
  'watch',
  'events',
  'messages',
  'friends',
  'bookmarks',
  'notifications',
  'settings',
  'gaming',
  'reel',
  'pages',
  'stories',
  'policies',
  'help',
  'business',
  'login',
  'signup',
  'logout',
])

/**
 * Top-level instagram.com paths that aren't profiles. `/<username>/followers`,
 * `/<username>/tagged`, etc. aren't listed here — the first segment is the
 * username, so the parser's `h2 === url slug` guard gates parse success.
 */
const INSTAGRAM_RESERVED_PATHS = new Set([
  'accounts',
  'direct',
  'explore',
  'p',
  'reel',
  'reels',
  'stories',
  'tv',
  'tags',
  'locations',
  'legal',
  'about',
  'developer',
  'press',
  'web',
  'emails',
  'privacy',
  'session',
  'challenge',
  'oauth',
  'api',
])

/**
 * Returns the deep-link to the Contact and Basic Info sub-tab of the current
 * Facebook profile, or null when the URL already points there. The parser
 * only succeeds inside that tab so we route the user there via a hint before
 * dispatching.
 */
function facebookContactInfoUrl(u: URL): string | null {
  if (u.pathname.includes('about_contact_and_basic_info')) return null
  if (u.searchParams.get('sk') === 'about_contact_and_basic_info') return null
  if (u.pathname.includes('profile.php')) {
    const id = u.searchParams.get('id')
    if (!id) return null
    return `https://www.facebook.com/profile.php?id=${id}&sk=about_contact_and_basic_info`
  }
  const vanity = u.pathname.split('/').filter(Boolean)[0]
  if (!vanity) return null
  return `https://www.facebook.com/${vanity}/about_contact_and_basic_info`
}

function detectTarget(url: string | undefined): Target | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname === 'mail.google.com') {
      return { host: 'gmail', entityType: 'contact', parseOp: 'parseGmail' }
    }
    if (u.hostname === 'www.linkedin.com') {
      if (u.pathname.startsWith('/sales/')) {
        return {
          host: 'sales-navigator',
          entityType: 'contact',
          parseOp: 'parseSalesNavigator',
        }
      }
      if (u.pathname.startsWith('/company/')) {
        return {
          host: 'linkedin',
          entityType: 'company',
          parseOp: 'parseLinkedInCompany',
        }
      }
      return { host: 'linkedin', entityType: 'contact', parseOp: 'parseLinkedIn' }
    }
    if (u.hostname === 'twitter.com' || u.hostname === 'x.com' || u.hostname === 'www.x.com') {
      if (u.pathname.startsWith('/search') || u.pathname.startsWith('/i/lists/')) {
        return { host: 'twitter', entityType: 'contact', parseOp: 'parseTwitterSearch' }
      }
      const firstSegment = u.pathname.split('/')[1] ?? ''
      if (!firstSegment || TWITTER_RESERVED_PATHS.has(firstSegment)) return null
      return { host: 'twitter', entityType: 'contact', parseOp: 'parseTwitterProfile' }
    }
    if (u.hostname === 'www.facebook.com' || u.hostname === 'facebook.com') {
      const firstSegment = u.pathname.split('/')[1] ?? ''
      if (firstSegment !== 'profile.php' && FACEBOOK_RESERVED_PATHS.has(firstSegment)) return null
      if (!firstSegment) return null
      // entityType is provisional — the parser self-detects and the
      // parse-result handler re-routes to 'company' when the result
      // populates the companies array. See the run() effect below.
      return { host: 'facebook', entityType: 'contact', parseOp: 'parseFacebook' }
    }
    if (u.hostname === 'www.instagram.com' || u.hostname === 'instagram.com') {
      const firstSegment = u.pathname.split('/')[1] ?? ''
      if (!firstSegment) return null
      if (INSTAGRAM_RESERVED_PATHS.has(firstSegment)) return null
      return { host: 'instagram', entityType: 'contact', parseOp: 'parseInstagramProfile' }
    }
    return null
  } catch {
    return null
  }
}

async function readActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return tab ?? null
  } catch {
    return null
  }
}

async function invokeOnPage<T = unknown>(operation: PageOperation): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'invoke', operation, args: [] }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      if (!response?.ok) {
        resolve(null)
        return
      }
      resolve((response.value as T) ?? null)
    })
  })
}

// ─── Field-value mappers ───────────────────────────────────────

function buildContactFieldValues(person: ParsedPerson): Record<string, unknown> {
  return {
    first_name: person.firstName,
    last_name: person.lastName,
    full_name: person.fullName,
    primary_email: person.primaryEmail,
    phone: person.phone,
    notes: person.notes,
    // externalId is multi-value (options.multi=true in the registry). Send
    // the capture's identifier as a single-element array so the server
    // writes one FieldValue row; future recaptures append via mode: 'add'.
    external_id: [person.externalId],
    // contact_avatar is a FILE field — populated separately via
    // buildAvatarFieldValue() which resolves the URL to an asset ref.
  }
}

function buildCompanyFieldValues(company: ParsedCompany): Record<string, unknown> {
  return {
    company_name: company.name,
    company_domain: company.domain,
    company_notes: company.notes,
    // externalId is multi-value — see buildContactFieldValues.
    external_id: [company.externalId],
    // company_logo is a FILE field — populated separately via
    // buildAvatarFieldValue() which resolves the URL to an asset ref.
  }
}

/**
 * Convert a parsed person into company-shaped data. Used when the user
 * clicks the secondary "Save as company" button on a profile that Auxx
 * detected as a contact (e.g. a Twitter org account or an ambiguous page).
 * The externalId is passed through as-is — the same URL always produces the
 * same identifier, so re-captures will still dedup against the original.
 */
function personToCompany(person: ParsedPerson | null): ParsedCompany | null {
  if (!person) return null
  const joinedFromParts = [person.firstName, person.lastName].filter(Boolean).join(' ')
  const name = person.fullName ?? (joinedFromParts.length > 0 ? joinedFromParts : undefined)
  return {
    name,
    avatarUrl: person.avatarUrl,
    notes: person.notes,
    externalId: person.externalId,
  }
}

/** Inverse of `personToCompany` — for the "Save as contact" button on a company parse. */
function companyToPerson(company: ParsedCompany | null): ParsedPerson | null {
  if (!company) return null
  const parts = (company.name ?? '').split(/\s+/).filter(Boolean)
  const firstName = parts[0]
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined
  return {
    firstName,
    lastName,
    fullName: company.name,
    avatarUrl: company.avatarUrl,
    notes: company.notes,
    externalId: company.externalId,
  }
}

// FILE fields are keyed by systemAttribute in the resource registry.
const AVATAR_SYSTEM_ATTR: Record<EntityType, string> = {
  contact: 'contact_avatar',
  company: 'company_logo',
}

async function buildAvatarFieldValue(
  entityType: EntityType,
  avatarUrl: string | undefined
): Promise<Record<string, unknown>> {
  if (!avatarUrl) return {}
  try {
    const { ref } = await uploadAvatarFromUrl({ url: avatarUrl, entityType })
    return { [AVATAR_SYSTEM_ATTR[entityType]]: { ref } }
  } catch (err) {
    // Avatar upload is best-effort — fall through to saving the record
    // without the image. LinkedIn CDN URLs expire; a 403 here is expected.
    console.warn('[auxx] avatar upload failed, saving without', err)
    return {}
  }
}

// ─── Dedup lookups ─────────────────────────────────────────────
//
// Single round-trip priority lookup via `record.lookupByField`:
// externalId first (exact match on the capture's source+id), then
// primary_email / company_domain as a wider-net fallback. See
// plans/folk/21-record-lookup-by-field.md §"Wire shape" for why we send
// the whole list in one call rather than two serial searches.

/**
 * `lookupByField` returns a composite RecordId (`contact:abc123`); the detail
 * routes (`/app/contacts/[contactId]`) take the bare instance id. Strip the
 * entity prefix so deep-links resolve instead of falling through to root.
 */
function instanceIdFromRecordId(recordId: string): string {
  const colon = recordId.indexOf(':')
  return colon === -1 ? recordId : recordId.slice(colon + 1)
}

async function findExistingByPerson(person: ParsedPerson): Promise<string | null> {
  const candidates: LookupByFieldCandidate[] = [
    { systemAttribute: 'external_id', value: person.externalId },
  ]
  if (person.primaryEmail) {
    candidates.push({ systemAttribute: 'primary_email', value: person.primaryEmail })
  }
  try {
    const result = await lookupByField({ entityDefinitionId: 'contact', candidates })
    const hit = result.items[0]?.recordId
    return hit ? instanceIdFromRecordId(hit) : null
  } catch {
    return null
  }
}

async function findExistingByCompany(company: ParsedCompany): Promise<string | null> {
  const candidates: LookupByFieldCandidate[] = [
    { systemAttribute: 'external_id', value: company.externalId },
  ]
  if (company.domain) {
    candidates.push({ systemAttribute: 'company_domain', value: company.domain })
  }
  try {
    const result = await lookupByField({ entityDefinitionId: 'company', candidates })
    const hit = result.items[0]?.recordId
    return hit ? instanceIdFromRecordId(hit) : null
  } catch {
    return null
  }
}

/**
 * Look up an existing record in a specific entity type, synthesizing the
 * cross-entity candidate via personToCompany / companyToPerson when the
 * parse result only carries the other shape. Twitter profiles, for
 * example, always parse as a person — but the user may have hit the
 * secondary "Save as company" button on a prior visit, writing a company
 * row with the same externalId. Without this cross-lookup, the iframe
 * would offer Save again on re-visit.
 */
async function findExistingInEntity(
  entityType: EntityType,
  person: ParsedPerson | null,
  company: ParsedCompany | null
): Promise<string | null> {
  if (entityType === 'contact') {
    const p = person ?? companyToPerson(company)
    return p ? findExistingByPerson(p) : null
  }
  const c = company ?? personToCompany(person)
  return c ? findExistingByCompany(c) : null
}

async function findExistingByGenericPage(page: GenericPage): Promise<string | null> {
  // Mirror the externalId shape we write in `handleSaveGenericCompany` so the
  // two paths dedupe against each other.
  const candidates: LookupByFieldCandidate[] = [
    { systemAttribute: 'external_id', value: `website:${page.hostname}` },
    { systemAttribute: 'company_domain', value: page.hostname },
  ]
  try {
    const result = await lookupByField({ entityDefinitionId: 'company', candidates })
    const hit = result.items[0]?.recordId
    return hit ? instanceIdFromRecordId(hit) : null
  } catch {
    return null
  }
}

function recordDeepLink(entityType: EntityType, recordId: string): string {
  return entityType === 'contact'
    ? `${BASE_URL}/app/contacts/${recordId}`
    : `${BASE_URL}/app/companies/${recordId}`
}

function loginUrl(): string {
  return `${BASE_URL}/login`
}

type Props = {
  session: SessionResponse
}

export function RootRoute({ session }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  // Bumped whenever we want to force a re-parse (session change, or the
  // `panelOpened` broadcast from the SW after the user clicks the toolbar
  // button on a different profile). Without this the boot effect sticks on
  // its first `ready` state and never picks up SPA navigation.
  const [rebootToken, setRebootToken] = useState(0)

  // SW broadcasts on:
  //   - `panelOpened` — every showFrame/toggleFrame
  //   - `tabNavigated` — URL changes (including SPA pushState inside LinkedIn)
  // Either signal bumps the boot effect so we re-detect + re-parse.
  useEffect(() => {
    const handler = (msg: unknown): void => {
      if (typeof msg !== 'object' || msg === null) return
      const type = (msg as { type?: string }).type
      if (type === 'panelOpened' || type === 'tabNavigated') {
        setRebootToken((n) => n + 1)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  // Boot: auth + active tab → detect target. Re-runs on session change and
  // on every panelOpened bump.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebootToken is a tick counter that intentionally forces this effect to re-run without being referenced inside the body.
  useEffect(() => {
    let cancelled = false

    async function boot() {
      if (!session.signedIn) {
        setPhase({ kind: 'signed-out' })
        return
      }
      if (!session.state.organizationId) {
        setPhase({ kind: 'no-org' })
        return
      }
      const tab = await readActiveTab()
      if (cancelled) return
      const target = detectTarget(tab?.url)
      if (!target) {
        setPhase({ kind: 'generic-site', page: readGenericPage(tab), existingRecordId: null })
        return
      }
      // Facebook only parses from the About → Contact and Basic Info tab.
      // Route the user there via a hint before attempting the parse.
      if (target.host === 'facebook' && tab?.url) {
        try {
          const hintUrl = facebookContactInfoUrl(new URL(tab.url))
          if (hintUrl) {
            setPhase({ kind: 'needs-fb-contact-info', profileUrl: hintUrl })
            return
          }
        } catch {
          /* bad url — fall through to parse */
        }
      }
      setPhase({ kind: 'parsing', target })
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [session, rebootToken])

  // Parse + (async, non-blocking) dedup.
  useEffect(() => {
    if (phase.kind !== 'parsing') return
    let cancelled = false
    const target = phase.target

    async function run() {
      const result = await invokeOnPage<ParseResult>(target.parseOp)
      if (cancelled) return

      // Parser health is informational, don't await.
      void reportParserHealth({
        host: target.host,
        url: window.location.href,
        parsed: !!result && (result.people.length > 0 || result.companies.length > 0),
        extensionVersion: chrome.runtime.getManifest().version,
      }).catch(() => {
        /* swallow */
      })

      // Facebook special case: the parser self-detects person vs company
      // (Pages and People share the same URL shape). Re-route entityType
      // from the result rather than inventing an "either" Target variant.
      const resolvedTarget: Target =
        target.host === 'facebook' && (result?.companies.length ?? 0) > 0
          ? { ...target, entityType: 'company' }
          : target

      const person = resolvedTarget.entityType === 'contact' ? (result?.people[0] ?? null) : null
      const company =
        resolvedTarget.entityType === 'company' ? (result?.companies[0] ?? null) : null

      setPhase({
        kind: 'ready',
        target: resolvedTarget,
        person,
        company,
        existingMatch: null,
      })

      // Cross-entity dedup: the "Save as contact / Save as company" buttons
      // mean a prior capture may live under either entity. Check both in
      // parallel; prefer a match in the primary entity type, fall back to
      // the other.
      if (!person && !company) return
      const primary = resolvedTarget.entityType
      const other: EntityType = primary === 'contact' ? 'company' : 'contact'
      const parseExternalId = person?.externalId ?? company?.externalId ?? null
      void Promise.all([
        findExistingInEntity(primary, person, company),
        findExistingInEntity(other, person, company),
      ]).then(([primaryHit, otherHit]) => {
        if (cancelled) return
        const match = primaryHit
          ? { recordId: primaryHit, entityType: primary }
          : otherHit
            ? { recordId: otherHit, entityType: other }
            : null
        if (!match) return
        setPhase((current) => {
          if (current.kind !== 'ready') return current
          const currentExternalId =
            current.person?.externalId ?? current.company?.externalId ?? null
          if (currentExternalId !== parseExternalId) return current
          return { ...current, existingMatch: match }
        })
      })
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [phase])

  // Generic-site dedup: look up company by `website:<host>` externalId or
  // company_domain so unsupported pages flip to "Already in Auxx" instead of
  // offering Save twice for the same host.
  useEffect(() => {
    if (phase.kind !== 'generic-site' || !phase.page) return
    const page = phase.page
    let cancelled = false
    void findExistingByGenericPage(page).then((existing) => {
      if (cancelled || !existing) return
      setPhase((current) =>
        current.kind === 'generic-site' && current.page?.hostname === page.hostname
          ? { ...current, existingRecordId: existing }
          : current
      )
    })
    return () => {
      cancelled = true
    }
  }, [phase])

  const handleSaveGenericCompany = useCallback(async () => {
    if (phase.kind !== 'generic-site' || !phase.page) return
    const page = phase.page
    setPhase({ kind: 'saving-generic', page })
    try {
      const created = await createRecord({
        entityDefinitionId: 'company',
        values: {
          company_name: page.title,
          company_domain: page.hostname,
          company_notes: page.url,
          external_id: [`website:${page.hostname}`],
        },
      })
      setPhase({ kind: 'saved', entityType: 'company', recordId: created.instance.id })
    } catch (err) {
      const message =
        err instanceof TrpcCallError
          ? `Save failed (${err.code ?? err.httpStatus ?? 'error'}): ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Save failed.'
      setPhase({ kind: 'error', message })
    }
  }, [phase])

  const handleSaveAs = useCallback(
    async (entityType: EntityType) => {
      if (phase.kind !== 'ready') return
      const target = phase.target
      setPhase({ kind: 'parsing', target })
      try {
        if (entityType === 'contact') {
          const person = phase.person ?? companyToPerson(phase.company)
          if (!person) {
            setPhase({ kind: 'error', message: 'Nothing to save.' })
            return
          }
          const avatarValue = await buildAvatarFieldValue('contact', person.avatarUrl)
          const created = await createRecord({
            entityDefinitionId: 'contact',
            values: { ...buildContactFieldValues(person), ...avatarValue },
          })
          setPhase({ kind: 'saved', entityType: 'contact', recordId: created.instance.id })
          return
        }
        const company = phase.company ?? personToCompany(phase.person)
        if (!company) {
          setPhase({ kind: 'error', message: 'Nothing to save.' })
          return
        }
        const avatarValue = await buildAvatarFieldValue('company', company.avatarUrl)
        const created = await createRecord({
          entityDefinitionId: 'company',
          values: { ...buildCompanyFieldValues(company), ...avatarValue },
        })
        setPhase({ kind: 'saved', entityType: 'company', recordId: created.instance.id })
      } catch (err) {
        const message =
          err instanceof TrpcCallError
            ? `Save failed (${err.code ?? err.httpStatus ?? 'error'}): ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Save failed.'
        setPhase({ kind: 'error', message })
      }
    },
    [phase]
  )

  return (
    <PhaseView
      phase={phase}
      onSaveAs={handleSaveAs}
      onSaveGenericCompany={handleSaveGenericCompany}
    />
  )
}

function PhaseView({
  phase,
  onSaveAs,
  onSaveGenericCompany,
}: {
  phase: Phase
  onSaveAs: (entityType: EntityType) => void
  onSaveGenericCompany: () => void
}) {
  switch (phase.kind) {
    case 'loading':
      return <p className='text-sm text-muted-foreground'>Loading…</p>

    case 'signed-out':
      return (
        <Empty
          title='Sign in to Auxx'
          body='Connect to your Auxx workspace to save contacts directly from this page.'
          action={{ label: 'Sign in', href: loginUrl() }}
        />
      )

    case 'no-org':
      return (
        <Empty
          title='No active organization'
          body='Pick a workspace inside Auxx to start saving contacts here.'
          action={{ label: 'Open Auxx', href: BASE_URL }}
        />
      )

    case 'generic-site':
      return (
        <GenericSiteView
          page={phase.page}
          existingRecordId={phase.existingRecordId}
          onSaveCompany={onSaveGenericCompany}
        />
      )

    case 'saving-generic':
      return <p className='text-sm text-muted-foreground'>Saving {phase.page.hostname}…</p>

    case 'parsing':
      return (
        <p className='text-sm text-muted-foreground'>Reading {HOST_LABEL[phase.target.host]}…</p>
      )

    case 'ready': {
      const target = phase.target
      const subject = target.entityType === 'contact' ? phase.person : phase.company
      if (!subject) {
        return (
          <Empty
            title={`No ${target.entityType} found on this ${HOST_LABEL[target.host]} page`}
            body={
              target.entityType === 'contact'
                ? 'Try opening a thread or profile with a recipient or person details.'
                : 'Try opening a company profile.'
            }
          />
        )
      }
      if (phase.existingMatch) {
        return (
          <SavedView
            phase={phase}
            recordId={phase.existingMatch.recordId}
            entityType={phase.existingMatch.entityType}
            heading={`Already in Auxx`}
            cta='Open in Auxx'
          />
        )
      }
      return <ReadyToSaveView phase={phase} onSaveAs={onSaveAs} />
    }

    case 'saved':
      return (
        <Empty
          title='Saved to Auxx'
          body={
            phase.entityType === 'contact'
              ? 'The contact is now in your workspace.'
              : 'The company is now in your workspace.'
          }
          action={{
            label: 'Open in Auxx',
            href: recordDeepLink(phase.entityType, phase.recordId),
          }}
        />
      )

    case 'needs-fb-contact-info':
      return (
        <Empty
          title='Open Contact and Basic Info'
          body='Facebook only exposes profile details on the About → Contact and Basic Info tab.'
          action={{ label: 'Open tab', href: phase.profileUrl }}
        />
      )

    case 'error':
      return (
        <Empty
          title='Something went wrong'
          body={phase.message}
          action={{ label: 'Open Auxx', href: BASE_URL }}
        />
      )
  }
}

function GenericSiteView({
  page,
  existingRecordId,
  onSaveCompany,
}: {
  page: GenericPage | null
  existingRecordId: string | null
  onSaveCompany: () => void
}) {
  if (!page) {
    return (
      <Empty
        title='No page detected'
        body='Open Auxx to manage your records, or navigate to a page you want to capture.'
        action={{ label: 'Open Auxx', href: BASE_URL }}
      />
    )
  }
  if (existingRecordId) {
    return (
      <div className='space-y-4'>
        <h2 className='text-sm text-muted-foreground'>Already in Auxx</h2>
        <div className='space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2'>
          <p className='truncate text-sm font-medium' title={page.title}>
            {page.title}
          </p>
          <p className='truncate text-xs text-muted-foreground' title={page.url}>
            {page.hostname}
          </p>
        </div>
        <Button asChild className='w-full'>
          <a href={recordDeepLink('company', existingRecordId)} target='_blank' rel='noreferrer'>
            Open in Auxx
          </a>
        </Button>
      </div>
    )
  }
  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <h2 className='text-base font-medium'>Save this page</h2>
        <p className='text-sm text-muted-foreground'>
          This page isn't a profile Auxx can parse yet. You can still capture it as a company.
        </p>
      </div>
      <div className='space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2'>
        <p className='truncate text-sm font-medium' title={page.title}>
          {page.title}
        </p>
        <p className='truncate text-xs text-muted-foreground' title={page.url}>
          {page.hostname}
        </p>
      </div>
      <Button onClick={onSaveCompany} className='w-full'>
        Save as company
      </Button>
      <Button asChild variant='outline' className='w-full'>
        <a href={BASE_URL} target='_blank' rel='noreferrer'>
          Open Auxx
        </a>
      </Button>
    </div>
  )
}

function ReadyToSaveView({
  phase,
  onSaveAs,
}: {
  phase: Extract<Phase, { kind: 'ready' }>
  onSaveAs: (entityType: EntityType) => void
}) {
  // Primary = the parser's best guess. Secondary = the other — some profiles
  // (brand accounts, solo-founder pages, verified orgs) are genuinely
  // ambiguous, so we always let the user pick.
  const primary = phase.target.entityType
  const secondary: EntityType = primary === 'contact' ? 'company' : 'contact'
  return (
    <div className='space-y-4'>
      {phase.person && <ParsedCard person={phase.person} />}
      {phase.company && <ParsedCard company={phase.company} />}
      <Button onClick={() => onSaveAs(primary)} className='w-full'>
        {saveLabel(primary)}
      </Button>
      <Button onClick={() => onSaveAs(secondary)} variant='outline' className='w-full'>
        {saveLabel(secondary)}
      </Button>
    </div>
  )
}

function saveLabel(entityType: EntityType): string {
  return entityType === 'contact' ? 'Save as contact' : 'Save as company'
}

function SavedView({
  phase,
  recordId,
  entityType,
  heading,
  cta,
}: {
  phase: Extract<Phase, { kind: 'ready' }>
  recordId: string
  entityType: EntityType
  heading: string
  cta: string
}) {
  return (
    <div className='space-y-4'>
      <h2 className='text-sm text-muted-foreground'>{heading}</h2>
      {phase.person && <ParsedCard person={phase.person} />}
      {phase.company && <ParsedCard company={phase.company} />}
      <Button asChild className='w-full'>
        <a href={recordDeepLink(entityType, recordId)} target='_blank' rel='noreferrer'>
          {cta}
        </a>
      </Button>
    </div>
  )
}

function Empty({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: { label: string; href: string }
}) {
  return (
    <div className='space-y-3'>
      <h2 className='text-base font-medium'>{title}</h2>
      <p className='text-sm text-muted-foreground'>{body}</p>
      {action && (
        <Button asChild className='w-full'>
          <a href={action.href} target='_blank' rel='noreferrer'>
            {action.label}
          </a>
        </Button>
      )}
    </div>
  )
}
