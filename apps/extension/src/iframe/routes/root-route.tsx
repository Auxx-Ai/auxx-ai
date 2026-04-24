// apps/extension/src/iframe/routes/root-route.tsx

import { Button } from '@auxx/ui/components/button'
import { useCallback, useEffect, useState } from 'react'
import type { PageOperation } from '../../lib/messaging'
import type { ParsedCompany, ParsedPerson, ParseResult } from '../../lib/parsers/types'
import { ParsedCard } from '../components/parsed-card'
import {
  BASE_URL,
  createRecord,
  firstResultId,
  reportParserHealth,
  type SessionResponse,
  searchRecords,
  TrpcCallError,
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
  | { kind: 'unsupported-host' }
  | { kind: 'parsing'; target: Target }
  | {
      kind: 'ready'
      target: Target
      person: ParsedPerson | null
      company: ParsedCompany | null
      existingRecordId: string | null
    }
  | { kind: 'saved'; entityType: EntityType; recordId: string }
  | { kind: 'error'; message: string }

type SupportedHost = 'gmail' | 'linkedin' | 'sales-navigator'

const HOST_LABEL: Record<SupportedHost, string> = {
  gmail: 'Gmail',
  linkedin: 'LinkedIn',
  'sales-navigator': 'Sales Navigator',
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
    firstName: person.firstName,
    lastName: person.lastName,
    fullName: person.fullName,
    primaryEmail: person.primaryEmail,
    phone: person.phone,
    avatarUrl: person.avatarUrl,
    notes: person.notes,
    externalId: person.externalId,
  }
}

function buildCompanyFieldValues(company: ParsedCompany): Record<string, unknown> {
  return {
    name: company.name,
    domain: company.domain,
    avatarUrl: company.avatarUrl,
    notes: company.notes,
    externalId: company.externalId,
  }
}

// ─── Dedup lookups ─────────────────────────────────────────────

async function findExistingByPerson(person: ParsedPerson): Promise<string | null> {
  try {
    const byExternal = await searchRecords({
      entityDefinitionId: 'contact',
      query: person.externalId,
    })
    const hit = firstResultId(byExternal)
    if (hit) return hit
  } catch {
    /* fall through */
  }

  if (person.primaryEmail) {
    try {
      const byEmail = await searchRecords({
        entityDefinitionId: 'contact',
        query: person.primaryEmail,
      })
      const hit = firstResultId(byEmail)
      if (hit) return hit
    } catch {
      /* miss */
    }
  }
  return null
}

async function findExistingByCompany(company: ParsedCompany): Promise<string | null> {
  try {
    const byExternal = await searchRecords({
      entityDefinitionId: 'company',
      query: company.externalId,
    })
    const hit = firstResultId(byExternal)
    if (hit) return hit
  } catch {
    /* fall through */
  }

  if (company.domain) {
    try {
      const byDomain = await searchRecords({
        entityDefinitionId: 'company',
        query: company.domain,
      })
      const hit = firstResultId(byDomain)
      if (hit) return hit
    } catch {
      /* miss */
    }
  }
  return null
}

function recordDeepLink(entityType: EntityType, recordId: string): string {
  return entityType === 'contact'
    ? `${BASE_URL}/app/contacts/${recordId}`
    : `${BASE_URL}/app/companies/${recordId}`
}

// Keep the dedup helpers + their imports live for the commented-out callsites
// above. Delete once we decide whether to re-enable dedup.
void findExistingByPerson
void findExistingByCompany
void firstResultId
void searchRecords

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
        setPhase({ kind: 'unsupported-host' })
        return
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

      if (target.entityType === 'contact') {
        const person = result?.people[0] ?? null
        setPhase({ kind: 'ready', target, person, company: null, existingRecordId: null })
        // TODO: re-enable record.search dedup once it's reliable + fast. For
        // now we always render the Save button; user gets a duplicate only if
        // they hit Save a second time on the same person.
        // if (person) {
        //   void findExistingByPerson(person).then((existing) => {
        //     if (cancelled || !existing) return
        //     setPhase((current) =>
        //       current.kind === 'ready' && current.person?.externalId === person.externalId
        //         ? { ...current, existingRecordId: existing }
        //         : current
        //     )
        //   })
        // }
        return
      }

      // company
      const company = result?.companies[0] ?? null
      setPhase({ kind: 'ready', target, person: null, company, existingRecordId: null })
      // TODO: re-enable company dedup along with the person-side search.
      // if (company) {
      //   void findExistingByCompany(company).then((existing) => {
      //     if (cancelled || !existing) return
      //     setPhase((current) =>
      //       current.kind === 'ready' && current.company?.externalId === company.externalId
      //         ? { ...current, existingRecordId: existing }
      //         : current
      //     )
      //   })
      // }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [phase])

  const handleSave = useCallback(async () => {
    if (phase.kind !== 'ready') return
    const target = phase.target
    setPhase({ kind: 'parsing', target })
    try {
      if (target.entityType === 'contact' && phase.person) {
        const created = await createRecord({
          entityDefinitionId: 'contact',
          values: buildContactFieldValues(phase.person),
        })
        setPhase({ kind: 'saved', entityType: 'contact', recordId: created.instance.id })
        return
      }
      if (target.entityType === 'company' && phase.company) {
        const created = await createRecord({
          entityDefinitionId: 'company',
          values: buildCompanyFieldValues(phase.company),
        })
        setPhase({ kind: 'saved', entityType: 'company', recordId: created.instance.id })
        return
      }
      setPhase({ kind: 'error', message: 'Nothing to save.' })
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

  return <PhaseView phase={phase} onSave={handleSave} />
}

function PhaseView({ phase, onSave }: { phase: Phase; onSave: () => void }) {
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

    case 'unsupported-host':
      return (
        <Empty
          title='Nothing to capture here'
          body='Open a Gmail thread, a LinkedIn profile or company page, or a Sales Navigator lead to capture a record.'
        />
      )

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
      if (phase.existingRecordId) {
        return (
          <SavedView
            phase={phase}
            recordId={phase.existingRecordId}
            heading={`Already in Auxx`}
            cta='Open in Auxx'
          />
        )
      }
      return <ReadyToSaveView phase={phase} onSave={onSave} />
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

function ReadyToSaveView({
  phase,
  onSave,
}: {
  phase: Extract<Phase, { kind: 'ready' }>
  onSave: () => void
}) {
  const label = phase.target.entityType === 'contact' ? 'Save to Auxx' : 'Save company'
  return (
    <div className='space-y-4'>
      {phase.person && <ParsedCard person={phase.person} />}
      {phase.company && <ParsedCard company={phase.company} />}
      <Button onClick={onSave} className='w-full'>
        {label}
      </Button>
    </div>
  )
}

function SavedView({
  phase,
  recordId,
  heading,
  cta,
}: {
  phase: Extract<Phase, { kind: 'ready' }>
  recordId: string
  heading: string
  cta: string
}) {
  return (
    <div className='space-y-4'>
      <h2 className='text-sm text-muted-foreground'>{heading}</h2>
      {phase.person && <ParsedCard person={phase.person} />}
      {phase.company && <ParsedCard company={phase.company} />}
      <Button asChild className='w-full'>
        <a
          href={recordDeepLink(phase.target.entityType, recordId)}
          target='_blank'
          rel='noreferrer'>
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
