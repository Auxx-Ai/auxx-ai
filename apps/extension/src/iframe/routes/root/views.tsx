// apps/extension/src/iframe/routes/root/views.tsx

import { Button, buttonVariants } from '@auxx/ui/components/button'
import Loader from '@auxx/ui/components/loader'
import { Building2, ChevronRight, Plus, Sparkles, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import type { ParsedCompany, ParsedPerson } from '../../../lib/parsers/types'
import { useRouteStack } from '../../hooks/use-route-stack'
import { BASE_URL } from '../../trpc'
import { companyToPerson, personToCompany } from './field-values'
import type { EntityType, ExistingMatch, GenericPage, Phase } from './types'
import { HOST_LABEL } from './types'

/**
 * Read-only view layer for the root capture flow. The orchestrator
 * (`root-route.tsx`) owns state + handlers and renders `<PhaseView>` with
 * them as props.
 */

function recordDeepLink(entityType: EntityType, recordId: string): string {
  return entityType === 'contact'
    ? `${BASE_URL}/app/contacts/${recordId}`
    : `${BASE_URL}/app/companies/${recordId}`
}

export function loginUrl(): string {
  return `${BASE_URL}/login`
}

export function PhaseView({
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
      return <Loader size='sm' title='Loading' subtitle='' />

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
      // Defer rendering the matches/capture decision until the lookup
      // round-trip resolves — without this, the empty-matches branch
      // renders briefly before matches arrive (visible as a flash of
      // the capture view on back-navigation from a detail route).
      if (phase.matchesStatus === 'loading') {
        return <Loader size='sm' title='Checking for existing records' subtitle='' />
      }
      // Two-step UX when there are existing matches: show the "N similar
      // found" list first (no parsed card, no save buttons) so the user
      // doesn't accidentally double-save. They can opt into the capture
      // view via "Add anyway?" — that path renders the parsed card +
      // save buttons, identical to the no-matches path. Folk's flow.
      return <ReadyView phase={phase} onSaveAs={onSaveAs} />
    }

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

/**
 * Top-level switch for the `ready` phase. Reads the root sub-view off the
 * route stack — `matches` shows the existing-matches list (default when
 * any matches were found), `capture` shows the parsed card + save buttons
 * (folk's "Add anyway?" path).
 *
 * Putting this in the route stack (instead of local useState) lets the
 * header's back chevron handle "back to matches" for free, and pops on
 * parse-identity change so a SPA navigation to a different profile resets
 * to the matches list for that profile.
 */
function ReadyView({
  phase,
  onSaveAs,
}: {
  phase: Extract<Phase, { kind: 'ready' }>
  onSaveAs: (entityType: EntityType) => void
}) {
  const { top, push, pop } = useRouteStack()
  const parseKey = phase.person?.externalId ?? phase.company?.externalId ?? ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: parseKey is the trigger; pop/top are read live.
  useEffect(() => {
    if (top.kind === 'root' && top.view === 'capture') pop()
  }, [parseKey])

  const isCaptureView = top.kind === 'root' && top.view === 'capture'

  if (phase.existingMatches.length > 0 && !isCaptureView) {
    return (
      <MatchesOnlyView
        matches={phase.existingMatches}
        onAddAnyway={() => push({ kind: 'root', view: 'capture' })}
      />
    )
  }
  return <ReadyToSaveView phase={phase} onSaveAs={onSaveAs} />
}

/**
 * Two-row suggestion list — folk's "save as contact / save as company"
 * decision presented like a shadcn integrations card. The parser produces
 * one shape (person OR company); we synthesize the other via
 * personToCompany / companyToPerson so the user always sees both options.
 *
 * Primary row = the parser's best guess (top of the list). Secondary row
 * = the cross-entity option for ambiguous profiles (brand accounts,
 * solo-founder pages, verified orgs).
 */
function ReadyToSaveView({
  phase,
  onSaveAs,
}: {
  phase: Extract<Phase, { kind: 'ready' }>
  onSaveAs: (entityType: EntityType) => void
}) {
  const primary = phase.target.entityType
  const secondary: EntityType = primary === 'contact' ? 'company' : 'contact'
  const isSaving = phase.savingAs !== null

  const personData = phase.person ?? companyToPerson(phase.company)
  const companyData = phase.company ?? personToCompany(phase.person)

  return (
    <div className='py-6 px-3'>
      <div className='bg-foreground/5 group rounded-2xl'>
        <div className='flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium'>
          <Sparkles className='size-3.5 opacity-50' />2 suggestions found
        </div>
        <div className='relative'>
          <div className='absolute inset-0 scale-100 blur-lg transition-all duration-300 dark:opacity-35'>
            <div className='bg-linear-to-r/increasing animate-hue-rotate absolute inset-x-6 bottom-0 top-12 -translate-y-3 from-pink-400 to-purple-400' />
          </div>
          <div className='bg-illustration ring-foreground/10 relative overflow-hidden rounded-2xl border border-transparent shadow-md shadow-black/5 ring-1'>
            <Suggestion
              entityType={primary}
              person={personData}
              company={companyData}
              onAdd={() => onSaveAs(primary)}
              saving={phase.savingAs === primary}
              disabled={isSaving && phase.savingAs !== primary}
            />
            <Suggestion
              entityType={secondary}
              person={personData}
              company={companyData}
              onAdd={() => onSaveAs(secondary)}
              saving={phase.savingAs === secondary}
              disabled={isSaving && phase.savingAs !== secondary}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

type SuggestionRow = { title: string; description: string; icon: ReactNode }

function suggestionRow(
  entityType: EntityType,
  person: ParsedPerson | null,
  company: ParsedCompany | null
): SuggestionRow {
  if (entityType === 'contact') {
    const title =
      person?.fullName ??
      ([person?.firstName, person?.lastName].filter(Boolean).join(' ') || 'New contact')
    const description = person?.primaryEmail ?? person?.phone ?? person?.notes ?? 'Contact'
    const icon = person?.avatarUrl ? (
      <img src={person.avatarUrl} alt='' className='h-full w-full object-cover' />
    ) : (
      <User className='size-5' />
    )
    return { title, description, icon }
  }
  const title = company?.name ?? 'New company'
  const description = company?.domain ?? company?.notes ?? 'Company'
  const icon = company?.avatarUrl ? (
    <img src={company.avatarUrl} alt='' className='h-full w-full object-cover' />
  ) : (
    <Building2 className='size-5' />
  )
  return { title, description, icon }
}

function Suggestion({
  entityType,
  person,
  company,
  onAdd,
  saving,
  disabled,
}: {
  entityType: EntityType
  person: ParsedPerson | null
  company: ParsedCompany | null
  onAdd: () => void
  saving: boolean
  disabled: boolean
}) {
  const { title, description, icon } = suggestionRow(entityType, person, company)
  const label = entityType === 'contact' ? 'Add contact' : 'Add company'
  const loadingLabel = entityType === 'contact' ? 'Adding contact…' : 'Adding company…'
  const hasImageIcon = entityType === 'contact' ? !!person?.avatarUrl : !!company?.avatarUrl
  return (
    <div className='grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-dashed py-0 pe-2 last:border-b-0'>
      <div
        className={`bg-muted border-foreground/5 flex size-12 items-center justify-center rounded-lg border ${hasImageIcon ? 'overflow-hidden' : '*:size-5 text-muted-foreground'}`}>
        {icon}
      </div>
      <div className='min-w-0 space-y-0.5'>
        <h3 className='truncate text-sm font-medium' title={title}>
          {title}
        </h3>
        <p className='text-muted-foreground line-clamp-1 text-sm' title={description}>
          {description}
        </p>
      </div>
      <Button
        variant='outline'
        size='sm'
        onClick={onAdd}
        loading={saving}
        loadingText={loadingLabel}
        disabled={disabled}>
        <Plus className='size-4' />
        {label}
      </Button>
    </div>
  )
}

/**
 * Default view when existing matches are found. Suppresses the parsed
 * card + save buttons so the user doesn't accidentally create a
 * duplicate. "Add anyway?" reveals the standard capture view.
 */
function MatchesOnlyView({
  matches,
  onAddAnyway,
}: {
  matches: ExistingMatch[]
  onAddAnyway: () => void
}) {
  return (
    <div className='space-y-4 p-3'>
      <SimilarMatchesList matches={matches} />
      <Button onClick={onAddAnyway} variant='outline' className='w-full'>
        Add anyway?
      </Button>
    </div>
  )
}

/**
 * Folk's "N similar found" list, styled as the same illustration card as
 * `ReadyToSaveView` so dedup hits and fresh suggestions share the same
 * visual shell. Each row is a full-width button that pushes the detail
 * route. The matched field's value is shown as the description — it's the
 * most useful identifier we have at this point (no displayName comes back
 * from `lookupByField`); the detail view fills in the rest.
 */
function SimilarMatchesList({ matches }: { matches: ExistingMatch[] }) {
  const { push } = useRouteStack()
  const heading =
    matches.length === 1 ? '1 similar record found' : `${matches.length} similar records found`
  return (
    <div className='bg-foreground/5 group rounded-2xl'>
      <div className='flex items-center gap-1.5 px-2 py-2.5 text-sm font-medium'>
        <Sparkles className='size-3.5 opacity-50' />
        {heading}
      </div>
      <div className='relative'>
        <div className='absolute inset-0 scale-100 blur-lg transition-all duration-300 dark:opacity-35'>
          <div className='bg-linear-to-r/increasing animate-hue-rotate absolute inset-x-6 bottom-0 top-12 -translate-y-3 from-pink-400 to-purple-400' />
        </div>
        <div className='bg-illustration ring-foreground/10 relative overflow-hidden rounded-2xl border border-transparent pe-3 shadow-md shadow-black/5 ring-1'>
          {matches.map((match) => (
            <MatchRow
              key={match.recordId}
              match={match}
              onOpen={() => push({ kind: match.entityType, recordId: match.recordId })}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function MatchRow({ match, onOpen }: { match: ExistingMatch; onOpen: () => void }) {
  const FallbackIcon = match.entityType === 'contact' ? User : Building2
  const entityLabel = match.entityType === 'contact' ? 'Contact' : 'Company'
  const title = match.displayName ?? entityLabel
  return (
    <button
      type='button'
      onClick={onOpen}
      className='grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-dashed text-left transition-colors last:border-b-0 hover:opacity-80'>
      <div className='bg-muted border-foreground/5 flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border text-muted-foreground'>
        {match.avatarUrl ? (
          <img
            src={match.avatarUrl}
            alt=''
            className='h-full w-full object-cover'
            referrerPolicy='no-referrer'
          />
        ) : (
          <FallbackIcon className='size-5' />
        )}
      </div>
      <div className='min-w-0 space-y-0.5'>
        <h3 className='truncate text-sm font-medium' title={title}>
          {title}
        </h3>
        {match.secondaryDisplayValue && (
          <p
            className='text-muted-foreground line-clamp-1 text-sm'
            title={match.secondaryDisplayValue}>
            {match.secondaryDisplayValue}
          </p>
        )}
      </div>
      <div
        className={buttonVariants({
          variant: 'outline',
          size: 'icon',
          className: 'pointer-events-none',
        })}>
        <ChevronRight className='size-4' />
      </div>
    </button>
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
    <div className='space-y-3 p-3'>
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
