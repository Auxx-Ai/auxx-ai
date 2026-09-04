// apps/web/src/components/accounting/ui/banking/rules/bank-rule-configure-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import {
  BANK_RULE_DIRECTIONS,
  BANK_RULE_MATCH_FIELDS,
  BANK_RULE_MATCH_OPERATORS,
  type BankRuleDirection,
  type BankRuleMatchField,
  type BankRuleMatchOperator,
} from '@auxx/lib/banking/rules/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Section } from '@auxx/ui/components/section'
import { ListChecks } from 'lucide-react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { RuleActionsSummaryRow } from '~/components/rules/ui/rule-actions-summary-row'
import { DIRECTION_OPTIONS, MATCH_FIELD_OPTIONS, MATCH_OPERATOR_OPTIONS } from './bank-rule-options'

/** Flush-in-a-FieldPanelRow trigger sizing, the same one the rule editors share. */
const TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' } as const

/** SINGLE_SELECT adapters emit arrays; take the first value. */
function firstValue(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : ''
}

interface BankRuleConfigurePageProps {
  name: string
  onNameChange: (value: string) => void
  matchField: BankRuleMatchField
  onMatchFieldChange: (value: BankRuleMatchField) => void
  matchOperator: BankRuleMatchOperator
  onMatchOperatorChange: (value: BankRuleMatchOperator) => void
  matchValue: string
  onMatchValueChange: (value: string) => void
  direction: BankRuleDirection
  onDirectionChange: (value: BankRuleDirection) => void
  bankAccountId: string
  onBankAccountChange: (value: string) => void
  /** The org's bank accounts, for the "which account" scope row. */
  accountOptions: SelectOption[]
  autoApply: boolean
  onAutoApplyChange: (value: boolean) => void
  /** One-line summary of the configured action, for the drill-in row. */
  actionLabel: string
  onOpenAction: () => void
  canSave: boolean
  isPending: boolean
  saveLabel: string
  onSave: () => void
  onCancel: () => void
}

/**
 * The bank rule's definition form: what it matches and how, which lines it is
 * limited to, and whether it posts without review. The action itself lives on
 * its own page, reached through the drill-in row at the bottom.
 */
export function BankRuleConfigurePage({
  name,
  onNameChange,
  matchField,
  onMatchFieldChange,
  matchOperator,
  onMatchOperatorChange,
  matchValue,
  onMatchValueChange,
  direction,
  onDirectionChange,
  bankAccountId,
  onBankAccountChange,
  accountOptions,
  autoApply,
  onAutoApplyChange,
  actionLabel,
  onOpenAction,
  canSave,
  isPending,
  saveLabel,
  onSave,
  onCancel,
}: BankRuleConfigurePageProps) {
  return (
    <form
      className='flex flex-col'
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) onSave()
      }}>
      <Section title='Rule' icon={<ListChecks className='size-4' />} collapsible={false}>
        <FieldPanel className='p-0' breakpoint='md' resizeId='bank-rule'>
          <FieldPanelRow title='Name' isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={name}
              placeholder='e.g. Monthly bank fee'
              disabled={isPending}
              onChange={(v) => onNameChange(String(v ?? ''))}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Match field'
            description='The match key is the description with dates, reference numbers and card digits stripped out.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: MATCH_FIELD_OPTIONS }}
              triggerProps={TRIGGER_PROPS}
              value={matchField}
              disabled={isPending}
              onChange={(v) => {
                const next = firstValue(v)
                if (BANK_RULE_MATCH_FIELDS.includes(next as BankRuleMatchField)) {
                  onMatchFieldChange(next as BankRuleMatchField)
                }
              }}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Operator'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: MATCH_OPERATOR_OPTIONS }}
              triggerProps={TRIGGER_PROPS}
              value={matchOperator}
              disabled={isPending}
              onChange={(v) => {
                const next = firstValue(v)
                if (BANK_RULE_MATCH_OPERATORS.includes(next as BankRuleMatchOperator)) {
                  onMatchOperatorChange(next as BankRuleMatchOperator)
                }
              }}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Match value'
            isRequired
            description='A regex over 200 characters or with a nested quantifier (e.g. "(a+)+") is refused.'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={matchValue}
              placeholder='MONTHLY SVC FEE'
              disabled={isPending}
              onChange={(v) => onMatchValueChange(String(v ?? ''))}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Direction' description='Limit the rule to money in or money out.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: DIRECTION_OPTIONS }}
              triggerProps={TRIGGER_PROPS}
              value={direction}
              disabled={isPending}
              onChange={(v) => {
                const next = firstValue(v)
                if (BANK_RULE_DIRECTIONS.includes(next as BankRuleDirection)) {
                  onDirectionChange(next as BankRuleDirection)
                }
              }}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Bank account' description='Leave blank to match any account.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: accountOptions }}
              triggerProps={TRIGGER_PROPS}
              value={bankAccountId}
              placeholder='Any account'
              disabled={isPending}
              onChange={(v) => onBankAccountChange(firstValue(v))}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Auto-apply'
            isLastRow
            description='Posts the category or transfer WITHOUT review the next time suggestions run. Off by default: an auto-applied rule that is wrong posts a wrong entry, and once the period is locked that is a reversal, not an edit.'>
            <FieldInputAdapter
              fieldType={FieldType.CHECKBOX}
              fieldOptions={{ variant: 'switch' }}
              value={autoApply}
              disabled={isPending}
              onChange={(v) => onAutoApplyChange(Boolean(v))}
            />
          </FieldPanelRow>
        </FieldPanel>
      </Section>

      <RuleActionsSummaryRow
        labels={[actionLabel]}
        onOpen={onOpenAction}
        emptyText='No action set yet'
      />

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
