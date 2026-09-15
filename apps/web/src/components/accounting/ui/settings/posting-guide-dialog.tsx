// apps/web/src/components/accounting/ui/settings/posting-guide-dialog.tsx
'use client'

// The posting guide (plans/accounting/tasks/28-how-your-books-post.md §4): one
// `GuideDialog`, paged by posting type plus an overview, opened from the `?`
// on every Posting page section, the ledger toolbar and the bulk dialogs.
//
// Every sentence about a posting type on these pages is read off
// `POSTING_POLICY`: `sentence`, `trigger`, `parameters[].sentence`,
// `template[].what`, `settings`. Nothing here is written per type, so the
// guide cannot drift from the Posting page, which renders the same record.
// The catalog supplies each setting's description; the role map supplies the
// account each template role resolves to for THIS organisation.

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  LEDGER_WIDE_SETTING_KEYS,
  POSTING_POLICY,
  type PostingPolicy,
  type PostingTemplateLine,
  type RoleAssignmentRow,
} from '@auxx/lib/postings/client'
import type { SettingConfig } from '@auxx/lib/settings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  GuideColumn,
  GuideColumns,
  GuideConcept,
  GuideConcepts,
  GuideDialog,
  GuidePage,
  GuideSection,
  GuideStep,
  GuideSteps,
} from '@auxx/ui/components/guide'
import { ChevronRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSettingsCatalog } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { formatAccountLabel } from '../account-label-format'
import {
  EXTERNAL_SETTING_HOMES,
  NEVER_POLICIES,
  POSTING_PAGE_POLICIES,
  POSTING_SETTINGS_HREF,
  type PostingGuidePage,
  postingSectionAnchor,
  settingRowTitle,
  TRIGGER_KIND_ICON,
  TRIGGER_KIND_LABEL,
  TRIGGER_KIND_ORDER,
  triggerSentence,
} from './posting-page-model'

interface PostingGuideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The page to land on. A section's `?` passes its own type; the ledger toolbar passes the overview. */
  initialPage?: PostingGuidePage
}

export function PostingGuideDialog({
  open,
  onOpenChange,
  initialPage = 'overview',
}: PostingGuideDialogProps) {
  // Re-seed on every open so a deep-linked `?` lands where it asked.
  const [page, setPage] = useState<PostingGuidePage>(initialPage)
  useEffect(() => {
    if (open) setPage(initialPage)
  }, [open, initialPage])

  // The org's role map, so a template role reads as the account it resolves
  // to here rather than as a role name. Fetched only while the guide is open.
  const roleMap = api.ledger.roleMap.useQuery(undefined, { enabled: open })
  const accountsByRole = useMemo(() => {
    const map = new Map<string, RoleAssignmentRow>()
    for (const row of roleMap.data?.roles ?? []) map.set(row.role, row)
    return map
  }, [roleMap.data])

  const current: PostingPolicy | null =
    page === 'overview' || page === 'not-posting' ? null : POSTING_POLICY[page]

  const crumbs = [
    {
      label: 'Overview',
      active: page === 'overview',
      onClick: page === 'overview' ? undefined : () => setPage('overview'),
    },
    ...(page === 'not-posting' ? [{ label: 'Not posting', active: true }] : []),
    ...(current ? [{ label: current.label, active: true }] : []),
  ]

  return (
    <GuideDialog
      open={open}
      onOpenChange={onOpenChange}
      title='How your books post'
      heading='Help'
      page={page}
      crumbs={crumbs}
      onBack={page === 'overview' ? undefined : () => setPage('overview')}>
      <GuidePage value='overview' size='3xl'>
        <OverviewGuideBody onOpen={setPage} />
      </GuidePage>

      {POSTING_PAGE_POLICIES.map((policy) => (
        <GuidePage key={policy.type} value={policy.type} size='3xl'>
          <PolicyGuideBody policy={policy} accountsByRole={accountsByRole} />
        </GuidePage>
      ))}

      <GuidePage value='not-posting' size='3xl'>
        <NotPostingGuideBody accountsByRole={accountsByRole} />
      </GuidePage>
    </GuideDialog>
  )
}

// ── Overview: every type, grouped by how it is triggered ─────────────────────

function OverviewGuideBody({ onOpen }: { onOpen: (page: PostingGuidePage) => void }) {
  const kinds = TRIGGER_KIND_ORDER.filter((kind) => kind !== 'never')
  return (
    <div className='[&>div:first-child]:mt-0 [&>div:first-child]:border-t-0 [&>div:first-child]:pt-0'>
      {kinds.map((kind) => {
        const policies = POSTING_PAGE_POLICIES.filter((policy) => policy.trigger.kind === kind)
        if (policies.length === 0) return null
        const Icon = TRIGGER_KIND_ICON[kind]
        return (
          <GuideSection key={kind} title={TRIGGER_KIND_LABEL[kind]} cols={2}>
            {policies.map((policy) => (
              <GuideConcept
                key={policy.type}
                glyph={<Icon className='size-3.5 text-muted-foreground' />}
                term={policy.label}>
                {policy.sentence}{' '}
                <Button
                  variant='link'
                  size='xs'
                  className='h-auto p-0 align-baseline'
                  onClick={() => onOpen(policy.type)}>
                  Details
                  <ChevronRight />
                </Button>
              </GuideConcept>
            ))}
          </GuideSection>
        )
      })}

      <GuideSection title={TRIGGER_KIND_LABEL.never} cols={2}>
        {NEVER_POLICIES.map((policy) => (
          <GuideConcept key={policy.type} term={policy.label}>
            {policy.sentence}
          </GuideConcept>
        ))}
        <GuideConcept term='Why they are declared'>
          <Button
            variant='link'
            size='xs'
            className='h-auto p-0 align-baseline'
            onClick={() => onOpen('not-posting')}>
            What each one would post, and what holds it
            <ChevronRight />
          </Button>
        </GuideConcept>
      </GuideSection>
    </div>
  )
}

// ── One type: when it posts, what the entry looks like, what changes it ──────

function PolicyGuideBody({
  policy,
  accountsByRole,
}: {
  policy: PostingPolicy
  accountsByRole: Map<string, RoleAssignmentRow>
}) {
  return (
    <>
      <p className='mb-5 text-muted-foreground text-sm'>{policy.sentence}</p>
      <GuideColumns>
        <WhenItPostsColumn policy={policy} />
        <EntryColumn template={policy.template} accountsByRole={accountsByRole} />
        <WhatChangesItColumn policy={policy} />
      </GuideColumns>
    </>
  )
}

/** The trigger first, then every declared parameter, as numbered steps. */
function WhenItPostsColumn({ policy }: { policy: PostingPolicy }) {
  const sentence = triggerSentence(policy.trigger)
  return (
    <GuideColumn title='When it posts'>
      <GuideSteps>
        <GuideStep n={1} title={TRIGGER_KIND_LABEL[policy.trigger.kind]}>
          {sentence ?? policy.sentence}
          {!policy.enabled && policy.trigger.kind !== 'never' && (
            <>
              {' '}
              <Badge variant='outline' size='xs'>
                Not counted as enabled
              </Badge>
            </>
          )}
        </GuideStep>
        {policy.parameters.map((parameter, index) => (
          <GuideStep key={parameter.name} n={index + 2} title={parameter.name}>
            <span className='font-medium text-foreground/80'>{parameter.value}.</span>{' '}
            {parameter.sentence}
          </GuideStep>
        ))}
      </GuideSteps>
    </GuideColumn>
  )
}

/**
 * The template, one row per line, with the role resolved to this organisation's
 * account through the role map. A `by id` line names the record it reads
 * instead, because there is no role for the map to resolve.
 */
function EntryColumn({
  template,
  accountsByRole,
}: {
  template: readonly PostingTemplateLine[]
  accountsByRole: Map<string, RoleAssignmentRow>
}) {
  return (
    <GuideColumn title='What the entry looks like'>
      {template.length === 0 ? (
        <p className='text-muted-foreground text-xs'>No entry.</p>
      ) : (
        <GuideConcepts>
          {template.map((line, index) => (
            <GuideConcept
              key={`${line.side}-${line.role}-${index}`}
              inlineGlyph
              glyph={
                <Badge
                  variant={line.side === 'debit' ? 'outline' : 'secondary'}
                  size='xs'
                  className='w-7 justify-center font-mono'>
                  {line.side === 'debit' ? 'Dr' : 'Cr'}
                </Badge>
              }
              term={roleTerm(line.role, accountsByRole)}>
              {line.what}
            </GuideConcept>
          ))}
        </GuideConcepts>
      )}
    </GuideColumn>
  )
}

/** `1200 · Card Clearing`, or the role's label with its mapping state when unmapped. */
function roleTerm(
  role: AccountRole | 'by id',
  accountsByRole: Map<string, RoleAssignmentRow>
): string {
  if (role === 'by id') return 'An account named by the record'
  const label = ACCOUNT_ROLE_LABELS[role]
  const row = accountsByRole.get(role)
  if (row?.account) return formatAccountLabel(row.account)
  if (row?.state === 'unused') return `${label} (marked unused)`
  return `${label} (not mapped yet)`
}

/** The settings, each linking to its row on the Posting page or to the page that owns it, then the records. */
function WhatChangesItColumn({ policy }: { policy: PostingPolicy }) {
  const catalog = useSettingsCatalog() as Record<string, SettingConfig | undefined>
  const records = policy.records ?? []

  return (
    <GuideColumn title='What changes it'>
      <GuideConcepts>
        {policy.settings.map((key) => {
          const home = EXTERNAL_SETTING_HOMES[key]
          const href = home?.href ?? `${POSTING_SETTINGS_HREF}#${postingSectionAnchor(policy.type)}`
          return (
            <GuideConcept key={key} term={settingRowTitle(key, policy)}>
              {catalog[key]?.description}{' '}
              <GuideLink href={href}>
                {home ? `Set under ${home.label}` : 'Set on Posting'}
              </GuideLink>
            </GuideConcept>
          )
        })}
        {records.map((record) => (
          <GuideConcept key={record.href} term={record.label}>
            A record, not a setting: the accounts this entry names by id are read from it.{' '}
            <GuideLink href={record.href}>Open</GuideLink>
          </GuideConcept>
        ))}
        {policy.settings.length === 0 && records.length === 0 && (
          <GuideConcept term='The role map'>
            Nothing else. Each role above posts to the account the role map names.{' '}
            <GuideLink href='/app/accounting/settings/accounts'>Accounts</GuideLink>
          </GuideConcept>
        )}
        <GuideConcept term='Every type'>
          {LEDGER_WIDE_SETTING_KEYS.map((key) => settingRowTitle(key).toLowerCase()).join(', ')}{' '}
          apply to every entry.{' '}
          <GuideLink
            href={
              EXTERNAL_SETTING_HOMES['accounting.cutoffPeriod']?.href ??
              '/app/accounting/settings/general'
            }>
            General
          </GuideLink>
        </GuideConcept>
      </GuideConcepts>
    </GuideColumn>
  )
}

// ── The never types, with the template each would post ───────────────────────

function NotPostingGuideBody({
  accountsByRole,
}: {
  accountsByRole: Map<string, RoleAssignmentRow>
}) {
  return (
    <GuideColumns cols={2}>
      {NEVER_POLICIES.map((policy) => (
        <GuideColumn key={policy.type} title={policy.label}>
          <p className='text-muted-foreground text-xs'>{policy.sentence}</p>
          {policy.parameters.length > 0 && (
            <GuideSteps>
              {policy.parameters.map((parameter, index) => (
                <GuideStep key={parameter.name} n={index + 1} title={parameter.name}>
                  <span className='font-medium text-foreground/80'>{parameter.value}.</span>{' '}
                  {parameter.sentence}
                </GuideStep>
              ))}
            </GuideSteps>
          )}
          {policy.template.length > 0 && (
            <GuideConcepts>
              {policy.template.map((line, index) => (
                <GuideConcept
                  key={`${line.side}-${line.role}-${index}`}
                  inlineGlyph
                  glyph={
                    <Badge
                      variant={line.side === 'debit' ? 'outline' : 'secondary'}
                      size='xs'
                      className='w-7 justify-center font-mono'>
                      {line.side === 'debit' ? 'Dr' : 'Cr'}
                    </Badge>
                  }
                  term={roleTerm(line.role, accountsByRole)}>
                  {line.what}
                </GuideConcept>
              ))}
            </GuideConcepts>
          )}
        </GuideColumn>
      ))}
    </GuideColumns>
  )
}

function GuideLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className='inline-flex items-center gap-0.5 text-primary-600 hover:underline'>
      {children}
      <ExternalLink className='size-3' />
    </Link>
  )
}

export type { PostingGuidePage }
