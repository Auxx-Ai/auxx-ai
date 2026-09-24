// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-questions.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type {
  BankAccountProposal,
  ConnectAndGoPrepareReport,
} from '@auxx/lib/accounting/connect-and-go/client'
import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  accountLabel,
  ROLE_ACCOUNT_SUBTYPES,
  ROLE_ACCOUNT_TYPES,
} from '@auxx/lib/accounting/ledger/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { pluralize } from '@auxx/utils'
import { CalendarClock, CreditCard, Landmark, ListTree, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useChartAccounts } from '../gl-account-picker'
import { MappingAccountSelect } from '../settings/mapping-account-select'

/** The person's answers, held until Finish. */
export interface ConnectAndGoDraft {
  cutoffPeriod: string
  bookTimeZone: string
  roles: Record<string, string | null>
  railBanks: Record<string, string | null>
  acceptBankAccounts: string[]
}

type CutoverSource = ConnectAndGoPrepareReport['proposedCutover']['source']

interface ConnectAndGoQuestionsProps {
  report: ConnectAndGoPrepareReport
  draft: ConnectAndGoDraft
  onChange: (patch: Partial<ConnectAndGoDraft>) => void
  providerLabel: string
  disabled?: boolean
}

/** The cutover and every question prepare could not answer on its own. */
export function ConnectAndGoQuestions({
  report,
  draft,
  onChange,
  providerLabel,
  disabled,
}: ConnectAndGoQuestionsProps) {
  const { accounts } = useChartAccounts()
  const names = useMemo(
    () => new Map(accounts.map((account) => [account.id, accountLabel(account)])),
    [accounts]
  )
  const { roles, rails, bankAccounts } = report.questions

  return (
    <>
      <Section
        title='Cutover'
        icon={<CalendarClock className='size-4 text-muted-foreground' />}
        collapsible={false}>
        <div className='flex flex-col gap-3'>
          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='accounting-connect-and-go'
            defaultLabelWidth={170}
            className='p-0'>
            <FieldPanelRow
              title='Cutover month'
              type={BaseType.STRING}
              showIcon
              isRequired
              description={cutoverNote(report.proposedCutover.source, providerLabel)}>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={draft.cutoffPeriod}
                placeholder='2025-12'
                disabled={disabled || report.finalized}
                onChange={(value) => onChange({ cutoffPeriod: ((value as string) ?? '').trim() })}
              />
            </FieldPanelRow>
            {!report.bookTimeZone && (
              <FieldPanelRow
                title='Book timezone'
                type={BaseType.STRING}
                showIcon
                isRequired
                description='The IANA timezone your books are kept in. There is no UTC fallback.'>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={draft.bookTimeZone}
                  placeholder='America/New_York'
                  disabled={disabled}
                  onChange={(value) => onChange({ bookTimeZone: ((value as string) ?? '').trim() })}
                />
              </FieldPanelRow>
            )}
          </FieldPanel>
          <Alert variant='warning'>
            <TriangleAlert />
            <AlertDescription>
              Everything after the cutover is posted and exported by Auxx. If another app already
              writes your Shopify sales into {providerLabel} (its native app, Synder, A2X), stop it
              at the cutover, or those sales are counted twice. Everything on or before the cutover
              comes in as the opening entry and is never posted order by order.
            </AlertDescription>
          </Alert>
        </div>
      </Section>

      {roles.length > 0 && (
        <Section
          title='Which account?'
          description={`${providerLabel} has more than one account that could take these.`}
          icon={<ListTree className='size-4 text-muted-foreground' />}
          collapsible={false}>
          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='accounting-connect-and-go'
            defaultLabelWidth={170}
            className='p-0'>
            {roles.map((question) => {
              const role = question.role as AccountRole
              const suggested = question.candidateAccountIds
                .map((id) => names.get(id))
                .filter(Boolean)
              return (
                <FieldPanelRow
                  key={role}
                  title={ACCOUNT_ROLE_LABELS[role] ?? role}
                  type={BaseType.ENUM}
                  showIcon
                  description={
                    suggested.length > 0 ? `Likely: ${suggested.join(', ')}` : undefined
                  }>
                  <MappingAccountSelect
                    value={draft.roles[role] ?? null}
                    filterTypes={[ROLE_ACCOUNT_TYPES[role]]}
                    subtypePin={ROLE_ACCOUNT_SUBTYPES[role]}
                    disabled={disabled}
                    onChange={(value) =>
                      onChange({
                        roles: { ...draft.roles, [role]: value === 'inherit' ? null : value },
                      })
                    }
                  />
                </FieldPanelRow>
              )
            })}
          </FieldPanel>
        </Section>
      )}

      {rails.length > 0 && (
        <Section
          title='Where each payment rail pays out'
          description='The bank account each processor deposits into.'
          icon={<CreditCard className='size-4 text-muted-foreground' />}
          collapsible={false}>
          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='accounting-connect-and-go'
            defaultLabelWidth={170}
            className='p-0'>
            {rails.map((question) =>
              question.kind === 'rail_bank' ? (
                <FieldPanelRow
                  key={`bank:${question.gatewayId}`}
                  title={question.name}
                  type={BaseType.ENUM}
                  showIcon
                  description={
                    question.candidateAccountIds.length === 0
                      ? 'Your chart has no bank account yet.'
                      : undefined
                  }>
                  <MappingAccountSelect
                    value={draft.railBanks[question.gatewayId] ?? null}
                    filterTypes={['asset']}
                    subtypePin='bank'
                    disabled={disabled}
                    onChange={(value) =>
                      onChange({
                        railBanks: {
                          ...draft.railBanks,
                          [question.gatewayId]: value === 'inherit' ? null : value,
                        },
                      })
                    }
                  />
                </FieldPanelRow>
              ) : (
                <FieldPanelRow
                  key={`split:${question.name}`}
                  title={question.name}
                  type={BaseType.STRING}
                  showIcon>
                  <p className='py-1.5 text-muted-foreground text-xs'>
                    Split across {question.gatewayIds.length} gateways
                    {question.unclaimedHandles.length > 0
                      ? `; ${question.unclaimedHandles.join(', ')} unrouted`
                      : ''}
                    .{' '}
                    <Link
                      href='/app/accounting/settings/payment-gateways'
                      className='underline underline-offset-2'>
                      Review in payment gateways
                    </Link>
                  </p>
                </FieldPanelRow>
              )
            )}
          </FieldPanel>
        </Section>
      )}

      {bankAccounts.length > 0 && (
        <BankAccountProposals
          proposals={bankAccounts}
          accepted={draft.acceptBankAccounts}
          onChange={(acceptBankAccounts) => onChange({ acceptBankAccounts })}
          providerLabel={providerLabel}
          disabled={disabled}
        />
      )}
    </>
  )
}

/** Proposed bank accounts under one collapsed parent row; ticked ones are created on Finish. */
function BankAccountProposals({
  proposals,
  accepted,
  onChange,
  providerLabel,
  disabled,
}: {
  proposals: BankAccountProposal[]
  accepted: string[]
  onChange: (accepted: string[]) => void
  providerLabel: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const toggle = (key: string, next: boolean) => {
    if (disabled) return
    onChange(next ? [...accepted, key] : accepted.filter((row) => row !== key))
  }

  return (
    <Section
      title='Bank accounts'
      description='Tick the ones to add. Nothing is created until you finish.'
      icon={<Landmark className='size-4 text-muted-foreground' />}
      collapsible={false}>
      <TreeRow
        expandable
        isOpen={open}
        onToggleOpen={() => setOpen((value) => !value)}
        icon={<Landmark className='size-4 text-muted-foreground' />}
        title={<span className='truncate text-sm'>Bank accounts from {providerLabel}</span>}
        secondary={
          <span className='text-muted-foreground text-xs tabular-nums'>
            {accepted.length} of {proposals.length} {pluralize(proposals.length, 'account')} ticked
          </span>
        }>
        <TreeRowList
          items={proposals}
          getKey={(proposal) => proposal.key}
          renderRow={(proposal) => (
            <TreeRow
              depth={1}
              selectable
              selecting
              selected={accepted.includes(proposal.key)}
              onSelectChange={(next) => toggle(proposal.key, next)}
              onRowClick={() => toggle(proposal.key, !accepted.includes(proposal.key))}
              selectLabel={proposalTitle(proposal)}
              title={<span className='truncate text-sm'>{proposalTitle(proposal)}</span>}
              secondaryFill
              secondary={
                <span className='truncate text-muted-foreground text-xs'>
                  {proposalDetail(proposal)}
                </span>
              }
            />
          )}
        />
      </TreeRow>
    </Section>
  )
}

function cutoverNote(source: CutoverSource, providerLabel: string): string {
  if (source === 'current') return 'The cutover already set.'
  if (source === 'lock_date') return `The month your books are closed through in ${providerLabel}.`
  return 'The last full month.'
}

function proposalTitle(proposal: BankAccountProposal): string {
  return proposal.kind === 'create'
    ? `Add ${proposal.name}`
    : `Link ${proposal.bankAccountName ?? 'the connected account'} ····${proposal.last4}`
}

function proposalDetail(proposal: BankAccountProposal): string {
  return proposal.kind === 'create'
    ? `A bank account on ${proposal.glAccountName}${proposal.last4 ? `, ending ${proposal.last4}` : ''}`
    : `Its feed posts to ${proposal.glAccountName}`
}
