// apps/web/src/components/accounting/ui/settings/posting-settings-page.tsx
'use client'

// Accounting > Settings > Posting (plans/accounting/tasks/done/28-how-your-books-post.md §3).
//
// One `SettingsSection` per posting type that writes to the ledger, in
// trigger-kind order, then one collapsed section for the types declared never
// to post. Everything a section says is read off `POSTING_POLICY`; the rows are
// the policy's `settings` rendered through `SettingsFieldRow`, so a setting
// reaches this page by being listed on the policy and nowhere else.
//
// The bulk "Run now" dialogs are gone (accounting migration step 1b): each
// avenue now writes as it happens, gated by its own `accounting.autoPost.<avenue>`
// row - one more setting the policy declares and this page renders the same
// way it renders every other one. The Drafts tab (step 1c) is where a held
// draft gets reviewed and posted.
//
// Draft keys are scoped explicitly, for the reason `general-settings-page`
// gives: every `accounting.*` key is `GENERAL` scope, so the draft is narrowed
// to `POSTING_PAGE_INPUT_KEYS` and diffs only against those.

import type { PostingPolicy, PostingType } from '@auxx/lib/accounting/ledger/client'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import type { SettingKey, SettingValue } from '@auxx/lib/settings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import { ChevronDown, CircleHelp, ExternalLink, Lock } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useMemo, useState } from 'react'
import { BankAccountPicker } from '~/components/accounting/ui/bank-account-picker'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { Tooltip } from '~/components/global/tooltip'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { useAccountingSetupDraft } from '../../hooks/use-accounting-setup-draft'
import { readText } from './accounting-settings-keys'
import { ExportAvenueRow } from './export-avenue-row'
import { PostingGuideDialog } from './posting-guide-dialog'
import {
  autoPostKeyForAvenue,
  autoSendKeyForAvenue,
  EXPORT_ROW_DRAFT_KEYS,
  EXTERNAL_SETTING_HOMES,
  exportAvenueForPolicy,
  NEVER_POLICIES,
  POSTING_PAGE_INPUT_KEYS,
  POSTING_PAGE_POLICIES,
  type PostingGuidePage,
  postingSectionAnchor,
  settingRowTitle,
  splitPostingColumns,
  summaryGrainKeyForAvenue,
  TRIGGER_KIND_ICON,
  triggerSentence,
} from './posting-page-model'
import { describeNextFire, nextScheduledFire } from './posting-schedule'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Posting' },
]

const PAGE_DESCRIPTION = 'What posts to the ledger, when, and the settings that change it.'

/**
 * Render a `YYYY-MM-DD` posting date.
 *
 * 🛑 Formatted in UTC, never through `formatAccountingDate`: `latest.txnDate`
 * was already cut in the org's book time zone server-side, so re-projecting
 * it into that zone shifts a July 1 posting to June 30 on any org west of UTC.
 */
function formatDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return dayKey
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function AccountingPostingSettingsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { hasAccess } = useFeatureFlags()

  // One draft over every input key on the page. Nothing here validates, so one
  // slice and one save bar; the sections differ only in which keys they show.
  // `EXPORT_ROW_DRAFT_KEYS` rides along - `autoSend`/`summaryGrain` are keyed
  // on the AVENUE (posting-page-model.ts), so they are not on any policy's own
  // `settings` list the way `POSTING_PAGE_INPUT_KEYS` is built.
  const draft = useAccountingSetupDraft([...POSTING_PAGE_INPUT_KEYS, ...EXPORT_ROW_DRAFT_KEYS])

  const latest = api.ledger.latestPostingsByType.useQuery(undefined, {
    enabled: hasAccess(FeatureKey.accounting),
  })
  const latestByType = useMemo(() => {
    const map = new Map<PostingType, { docNumber: string | null; txnDate: string }>()
    for (const row of latest.data ?? []) map.set(row.postingType, row)
    return map
  }, [latest.data])

  const [guidePage, setGuidePage] = useState<PostingGuidePage | null>(null)

  if (!hasAccess(FeatureKey.accounting)) {
    return (
      <SettingsPage title='Posting' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Accounting Not Available'
          description='Upgrade your plan to keep books in Auxx.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  /** One policy-listed setting as a row: an input on this page, or a link to the page that owns it. */
  function renderSettingRow(policy: PostingPolicy, key: string) {
    const home = EXTERNAL_SETTING_HOMES[key]
    if (home) return null
    const copy = policy.settingCopy?.[key]

    return (
      <SettingsFieldRow
        key={key}
        settingKey={key as SettingKey}
        title={copy?.title}
        description={copy?.description}
        {...draft.controlled(key)}
      />
    )
  }

  const columns = splitPostingColumns(POSTING_PAGE_POLICIES)

  function renderPolicy(policy: PostingPolicy) {
    const Icon = TRIGGER_KIND_ICON[policy.trigger.kind]
    // The avenue whose export row belongs on THIS section (posting-page-model.ts)
    // - `null` for a policy sharing its avenue with another, already-chosen one.
    const avenue = exportAvenueForPolicy(policy)
    const avenueAutoPostKey = avenue ? autoPostKeyForAvenue(avenue) : null
    // The avenue's own `autoPost` row moves INTO the export row below, so it is
    // dropped from the generic loop rather than shown twice.
    const inputKeys = policy.settings.filter(
      (key) => !(key in EXTERNAL_SETTING_HOMES) && key !== avenueAutoPostKey
    )
    const externalKeys = policy.settings.filter((key) => key in EXTERNAL_SETTING_HOMES)
    const summaryGrainKey = avenue ? summaryGrainKeyForAvenue(avenue) : null

    return (
      <div key={policy.type} id={postingSectionAnchor(policy.type)}>
        <SettingsSection
          icon={Icon}
          title={
            <span className='flex items-center gap-2'>
              {policy.label}
              {!policy.enabled && (
                <Tooltip content={policy.disabledSentence}>
                  <Badge variant='outline' size='xs'>
                    Not counted as enabled
                  </Badge>
                </Tooltip>
              )}
            </span>
          }
          description={policy.sentence}
          action={<GuideButton label={policy.label} onClick={() => setGuidePage(policy.type)} />}>
          {(inputKeys.length > 0 || avenue) && (
            <FieldPanel
              className='mt-1 p-0'
              resizeId={`accounting-posting-${policy.type}`}
              defaultLabelWidth={220}>
              {inputKeys.map((key) => renderSettingRow(policy, key))}
              {avenue && (
                <ExportAvenueRow
                  autoPost={
                    avenueAutoPostKey
                      ? {
                          checked: !!draft.draft[avenueAutoPostKey],
                          onChange: (checked) => draft.patch({ [avenueAutoPostKey]: checked }),
                        }
                      : undefined
                  }
                  autoSend={{
                    checked: !!draft.draft[autoSendKeyForAvenue(avenue)],
                    onChange: (checked) => draft.patch({ [autoSendKeyForAvenue(avenue)]: checked }),
                  }}
                  summaryGrain={
                    summaryGrainKey
                      ? {
                          value: (draft.draft[summaryGrainKey] as 'day' | 'month') ?? 'day',
                          onChange: (value) => draft.patch({ [summaryGrainKey]: value }),
                        }
                      : undefined
                  }
                />
              )}
            </FieldPanel>
          )}

          <PolicyFacts
            policy={policy}
            latest={latestByType.get(policy.type) ?? null}
            latestLoading={latest.isPending}
            externalKeys={externalKeys}
          />
        </SettingsSection>
      </div>
    )
  }

  return (
    <SettingsPage
      title='Posting'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      button={
        <Button variant='outline' size='sm' onClick={() => setGuidePage('overview')}>
          <CircleHelp /> How your books post
        </Button>
      }>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <p className='text-muted-foreground text-xs'>
          Every type below respects the cutoff period, the book timezone and the locked months.
          Those are set under{' '}
          <Link
            href='/app/accounting/settings/general'
            className='inline-flex items-center gap-1 text-primary-600 hover:underline'>
            General
            <ExternalLink className='size-3' />
          </Link>
          .
        </p>

        <div className='grid grid-cols-1 items-start gap-8 lg:grid-cols-2'>
          <div className='flex flex-col gap-8'>{columns.left.map(renderPolicy)}</div>
          <div className='flex flex-col gap-8'>
            {columns.right.map(renderPolicy)}
            <NotPostingSection onGuide={() => setGuidePage('not-posting')} />
          </div>
        </div>

        <FormSaveBar
          dirty={draft.dirty}
          isSaving={draft.isSaving}
          onSave={draft.save}
          onDiscard={draft.discard}
        />
      </div>

      {guidePage && (
        <PostingGuideDialog
          open
          onOpenChange={(open) => !open && setGuidePage(null)}
          initialPage={guidePage}
        />
      )}
    </SettingsPage>
  )
}

/**
 * The facts under a section: how it is triggered, the newest entry of the type
 * and, for a schedule, when it fires next (§3.2); then where the settings this
 * page does not own are edited, and the records the entry reads.
 */
function PolicyFacts({
  policy,
  latest,
  latestLoading,
  externalKeys,
}: {
  policy: PostingPolicy
  latest: { docNumber: string | null; txnDate: string } | null
  latestLoading: boolean
  externalKeys: readonly string[]
}) {
  const trigger = triggerSentence(policy.trigger)
  const next = nextScheduledFire(policy.trigger)
  const records = policy.records ?? []

  return (
    <div className='flex flex-col gap-1 text-muted-foreground text-xs'>
      {trigger && (
        <p>
          <span className='font-medium text-foreground/80'>Posts</span> {lowerFirst(trigger)}.
        </p>
      )}
      <p className='flex flex-wrap items-center gap-x-3 gap-y-1'>
        <span>
          <span className='font-medium text-foreground/80'>Last posted</span>{' '}
          {latest ? (
            <>
              {formatDayKey(latest.txnDate)}{' '}
              <span className='font-mono'>({latest.docNumber || 'draft'})</span>
            </>
          ) : latestLoading ? (
            'loading'
          ) : (
            'never'
          )}
        </span>
        {next && (
          <span>
            <span className='font-medium text-foreground/80'>Next</span> {describeNextFire(next)}
          </span>
        )}
      </p>
      {externalKeys.length > 0 && (
        <p className='flex flex-wrap items-center gap-x-3 gap-y-1'>
          {externalKeys.map((key) => {
            const home = EXTERNAL_SETTING_HOMES[key]
            if (!home) return null
            return (
              <FactLink key={key} href={home.href}>
                {settingRowTitle(key)}: set under {home.label}
              </FactLink>
            )
          })}
        </p>
      )}
      {records.length > 0 && (
        <p className='flex flex-wrap items-center gap-x-3 gap-y-1'>
          {records.map((record) => (
            <FactLink key={record.href} href={record.href}>
              {record.label}
            </FactLink>
          ))}
        </p>
      )}
    </div>
  )
}

/** The declared `never` types, collapsed (§10 decision 3): the honest answer to "why is my inventory not moving per receipt". */
function NotPostingSection({ onGuide }: { onGuide: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div id='posting-never'>
      <SettingsSection
        icon={TRIGGER_KIND_ICON.never}
        title='Not posting'
        description={`${NEVER_POLICIES.map((policy) => policy.label).join(', ')}. Declared not to post.`}
        action={<GuideButton label='what does not post' onClick={onGuide} />}>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant='ghost' size='sm'>
              <ChevronDown
                className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
              />
              {open ? 'Hide' : 'Show'} why
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className='mt-2 flex flex-col gap-2 text-xs'>
              {NEVER_POLICIES.map((policy) => (
                <div key={policy.type}>
                  <dt className='font-medium text-foreground/80'>{policy.label}</dt>
                  <dd className='text-muted-foreground'>
                    {policy.sentence}
                    {policy.parameters.map((parameter) => ` ${parameter.sentence}`).join('')}
                  </dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      </SettingsSection>
    </div>
  )
}

function GuideButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip content={`How ${label.toLowerCase()} posts`}>
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label={`How ${label.toLowerCase()} posts`}
        onClick={onClick}>
        <CircleHelp />
      </Button>
    </Tooltip>
  )
}

function FactLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className='inline-flex items-center gap-1 text-primary-600 hover:underline'>
      {children}
      <ExternalLink className='size-3' />
    </Link>
  )
}

function lowerFirst(sentence: string): string {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1)
}
