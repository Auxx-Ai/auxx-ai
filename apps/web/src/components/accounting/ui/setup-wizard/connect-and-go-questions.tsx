// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-questions.tsx
'use client'

import type {
  BankAccountProposal,
  ConnectAndGoPrepareReport,
} from '@auxx/lib/accounting/connect-and-go/client'
import { Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { pluralize } from '@auxx/utils'
import { CreditCard, Landmark } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { MappingAccountSelect } from '../settings/mapping-account-select'
import type { ConnectAndGoDraft } from './use-connect-and-go'

interface ConnectAndGoQuestionsProps {
  report: ConnectAndGoPrepareReport
  draft: ConnectAndGoDraft
  onChange: (patch: Partial<ConnectAndGoDraft>) => void
  providerLabel: string
  disabled?: boolean
}

/** Rail banks and bank accounts prepare could not settle on its own; roles are the Mapping page. */
export function ConnectAndGoQuestions({
  report,
  draft,
  onChange,
  providerLabel,
  disabled,
}: ConnectAndGoQuestionsProps) {
  const { rails, bankAccounts } = report.questions

  return (
    <>
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
                    triggerClassName='w-full ps-0 pe-1'
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
      className='[&_[data-slot=section]]:border-b-0'
      description='Tick the ones to add. Nothing is created until you finish.'
      icon={<Landmark className='size-4 text-muted-foreground' />}
      collapsible={false}>
      <TreeRow
        expandable
        isOpen={open}
        rowClassName='bg-primary-100/50 hover:bg-primary-100'
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
              rowClassName='hover:bg-primary-100'
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
