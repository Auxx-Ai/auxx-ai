// apps/web/src/components/accounting/ui/banking/rules/bank-rule-action-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { BANK_RULE_ACTIONS, type BankRuleAction } from '@auxx/lib/banking/rules/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Section } from '@auxx/ui/components/section'
import { Zap } from 'lucide-react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { GlAccountPicker } from '../../gl-account-picker'
import { ACTION_OPTIONS } from './bank-rule-options'

/** Flush-in-a-FieldPanelRow trigger sizing, the same one the rule editors share. */
const TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' } as const

/** SINGLE_SELECT adapters emit arrays; take the first value. */
function firstValue(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : ''
}

interface BankRuleActionPageProps {
  action: BankRuleAction
  onActionChange: (value: BankRuleAction) => void
  /** GL account CODE, never an id - what a posting line names an account by. */
  glAccountCode: string
  onGlAccountChange: (code: string) => void
  counterpartBankAccountId: string
  onCounterpartChange: (id: string) => void
  /** The org's bank accounts, for the transfer counterpart. */
  accountOptions: SelectOption[]
  memo: string
  onMemoChange: (value: string) => void
  canSave: boolean
  isPending: boolean
  saveLabel: string
  onSave: () => void
  onCancel: () => void
}

/**
 * What a matching line becomes: coded to a GL account, treated as a transfer
 * between two of our own accounts, or excluded from the books entirely.
 */
export function BankRuleActionPage({
  action,
  onActionChange,
  glAccountCode,
  onGlAccountChange,
  counterpartBankAccountId,
  onCounterpartChange,
  accountOptions,
  memo,
  onMemoChange,
  canSave,
  isPending,
  saveLabel,
  onSave,
  onCancel,
}: BankRuleActionPageProps) {
  return (
    <form
      className='flex flex-col'
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) onSave()
      }}>
      <Section title='Action' icon={<Zap className='size-4' />} collapsible={false}>
        <FieldPanel className='p-0' breakpoint='md' resizeId='bank-rule'>
          <FieldPanelRow title='Action' isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: ACTION_OPTIONS }}
              triggerProps={TRIGGER_PROPS}
              value={action}
              disabled={isPending}
              onChange={(v) => {
                const next = firstValue(v)
                if (BANK_RULE_ACTIONS.includes(next as BankRuleAction)) {
                  onActionChange(next as BankRuleAction)
                }
              }}
            />
          </FieldPanelRow>

          {action === 'code' && (
            <FieldPanelRow title='GL account' isRequired>
              <GlAccountPicker
                value={glAccountCode || null}
                disabled={isPending}
                placeholder='Select account…'
                triggerProps={{ variant: 'transparent', className: 'w-full ps-0 pe-1' }}
                onChange={(code) => onGlAccountChange(code ?? '')}
              />
            </FieldPanelRow>
          )}

          {action === 'transfer' && (
            <FieldPanelRow
              title='Counterpart account'
              isRequired
              description='The other one of your accounts this money moved to or from.'>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: accountOptions }}
                triggerProps={TRIGGER_PROPS}
                value={counterpartBankAccountId}
                placeholder='Select account…'
                disabled={isPending}
                onChange={(v) => onCounterpartChange(firstValue(v))}
              />
            </FieldPanelRow>
          )}

          <FieldPanelRow
            title='Memo'
            isLastRow
            description='Optional. Carried onto what the rule posts.'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={memo}
              placeholder='Bank service charge'
              disabled={isPending}
              onChange={(v) => onMemoChange(String(v ?? ''))}
            />
          </FieldPanelRow>
        </FieldPanel>
      </Section>

      <DialogFooter className='border-t p-3'>
        <Button variant='ghost' size='sm' type='button' onClick={onCancel}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button
          variant='outline'
          size='sm'
          type='submit'
          disabled={!canSave}
          loading={isPending}
          loadingText='Saving...'>
          {saveLabel} <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </form>
  )
}
