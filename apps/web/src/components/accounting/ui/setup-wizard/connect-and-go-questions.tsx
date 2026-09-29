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
import { Landmark } from 'lucide-react'
import { useState } from 'react'
import type { ConnectAndGoDraft } from './use-connect-and-go'

interface ConnectAndGoQuestionsProps {
  report: ConnectAndGoPrepareReport
  draft: ConnectAndGoDraft
  onChange: (patch: Partial<ConnectAndGoDraft>) => void
  providerLabel: string
  disabled?: boolean
}

/** Bank accounts prepare could not settle on its own; roles and rail banks have their own pages. */
export function ConnectAndGoQuestions({
  report,
  draft,
  onChange,
  providerLabel,
  disabled,
}: ConnectAndGoQuestionsProps) {
  const { bankAccounts } = report.questions
  if (bankAccounts.length === 0) return null
  return (
    <BankAccountProposals
      proposals={bankAccounts}
      accepted={draft.acceptBankAccounts}
      onChange={(acceptBankAccounts) => onChange({ acceptBankAccounts })}
      providerLabel={providerLabel}
      disabled={disabled}
    />
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
