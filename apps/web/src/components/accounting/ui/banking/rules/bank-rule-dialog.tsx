// apps/web/src/components/accounting/ui/banking/rules/bank-rule-dialog.tsx

'use client'

import type {
  BankRuleAction,
  BankRuleDirection,
  BankRuleMatchField,
  BankRuleMatchOperator,
  BankRuleRecord,
} from '@auxx/lib/banking/rules/client'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useState } from 'react'
import { RuleDialogShell } from '~/components/rules/ui/rule-dialog-shell'
import { api } from '~/trpc/react'
import { bankAccountLabel, useBankAccounts } from '../../bank-account-picker'
import { useChartAccounts } from '../../gl-account-picker'
import { BankRuleActionPage } from './bank-rule-action-page'
import { BankRuleConfigurePage } from './bank-rule-configure-page'
import { describeActionDetail } from './bank-rule-options'

interface BankRuleDialogProps {
  open: boolean
  onClose: () => void
  /** Null ⇒ create. */
  rule?: BankRuleRecord | null
  /**
   * Opening values for a CREATE, from the analyze panel's previewed pattern.
   *
   * ⚠️ Ignored when `rule` is set. A seed is where a new rule starts; an edit
   * starts from the rule, and letting a seed override stored values would let a
   * drawer quietly rewrite a rule somebody opened to read.
   */
  seed?: Partial<
    Pick<BankRuleRecord, 'name' | 'matchField' | 'matchOperator' | 'matchValue' | 'direction'>
  >
}

/**
 * Create/edit dialog for a bank rule - a two-page `RuleDialogShell` flow:
 * `configure` (name, what it matches, which lines, auto-apply) → `action`
 * (code / transfer / exclude, plus an optional memo).
 *
 * This dialog owns all form state; the shell owns navigation only, exactly like
 * `RecordRuleDialog` and `MailFilterDialog`.
 */
export function BankRuleDialog({ open, onClose, rule, seed }: BankRuleDialogProps) {
  const utils = api.useUtils()

  const [page, setPage] = useState<'configure' | 'action'>('configure')
  const [name, setName] = useState('')
  const [matchField, setMatchField] = useState<BankRuleMatchField>('matchKey')
  const [matchOperator, setMatchOperator] = useState<BankRuleMatchOperator>('contains')
  const [matchValue, setMatchValue] = useState('')
  const [direction, setDirection] = useState<BankRuleDirection>('any')
  const [bankAccountId, setBankAccountId] = useState('')
  const [autoApply, setAutoApply] = useState(false)
  const [action, setAction] = useState<BankRuleAction>('code')
  const [glAccountId, setGlAccountId] = useState('')
  const [counterpartBankAccountId, setCounterpartBankAccountId] = useState('')
  const [memo, setMemo] = useState('')

  // Re-seed form state whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setPage('configure')
    setName(rule?.name ?? seed?.name ?? '')
    setMatchField(rule?.matchField ?? seed?.matchField ?? 'matchKey')
    setMatchOperator(rule?.matchOperator ?? seed?.matchOperator ?? 'contains')
    setMatchValue(rule?.matchValue ?? seed?.matchValue ?? '')
    setDirection(rule?.direction ?? seed?.direction ?? 'any')
    setBankAccountId(rule?.bankAccountId ?? '')
    setAutoApply(rule?.autoApply ?? false)
    setAction(rule?.action ?? 'code')
    setGlAccountId(rule?.glAccountId ?? '')
    setCounterpartBankAccountId(rule?.counterpartBankAccountId ?? '')
    setMemo(rule?.memo ?? '')
  }, [open, rule, seed])

  // Each page owns its own `BankAccountPicker`; the list is read here only to
  // name the chosen counterpart in the action summary row - so archived rows
  // are included, or a rule scoped to an archived account summarises as blank.
  const { accounts: bankAccounts } = useBankAccounts({ includeArchived: true })
  const { accounts: chartAccounts } = useChartAccounts()

  const createRule = api.bankingRules.create.useMutation({
    onSuccess: async () => {
      await utils.bankingRules.list.invalidate()
      onClose()
    },
    onError: (error) => {
      toastError({ title: 'Error creating rule', description: error.message })
    },
  })

  const updateRule = api.bankingRules.update.useMutation({
    onSuccess: async () => {
      await utils.bankingRules.list.invalidate()
      onClose()
    },
    onError: (error) => {
      toastError({ title: 'Error saving rule', description: error.message })
    },
  })

  const isPending = createRule.isPending || updateRule.isPending

  const canSave =
    name.trim().length > 0 &&
    matchValue.trim().length > 0 &&
    (action === 'code'
      ? glAccountId.length > 0
      : action === 'transfer'
        ? counterpartBankAccountId.length > 0
        : true)

  const counterpart = bankAccounts.find((account) => account.id === counterpartBankAccountId)

  const selectedGlAccount = chartAccounts.find((a) => a.id === glAccountId)
  const actionLabel = describeActionDetail({
    action,
    glAccountId,
    glAccount: selectedGlAccount,
    counterpartName: counterpart ? bankAccountLabel(counterpart) : undefined,
  })

  const handleSave = () => {
    const payload = {
      name: name.trim(),
      matchField,
      matchOperator,
      matchValue: matchValue.trim(),
      direction,
      bankAccountId: bankAccountId || null,
      action,
      glAccountId: action === 'code' ? glAccountId : null,
      counterpartBankAccountId: action === 'transfer' ? counterpartBankAccountId : null,
      memo: memo.trim() || null,
      autoApply,
    }
    if (rule) {
      updateRule.mutate({ id: rule.id, ...payload })
    } else {
      createRule.mutate(payload)
    }
  }

  const saveLabel = rule ? 'Save changes' : 'Create rule'

  return (
    <RuleDialogShell
      open={open}
      onClose={onClose}
      title={rule ? 'Edit bank rule' : 'New bank rule'}
      description='Code, transfer or exclude a repeating bank line the next time suggestions run.'
      rootCrumb={name.trim() || (rule ? 'Rule' : 'New rule')}
      page={page}
      onPageChange={(next) => setPage(next as 'configure' | 'action')}
      pages={[
        {
          id: 'configure',
          title: 'Configure',
          size: 'lg',
          content: (
            <BankRuleConfigurePage
              name={name}
              onNameChange={setName}
              matchField={matchField}
              onMatchFieldChange={setMatchField}
              matchOperator={matchOperator}
              onMatchOperatorChange={setMatchOperator}
              matchValue={matchValue}
              onMatchValueChange={setMatchValue}
              direction={direction}
              onDirectionChange={setDirection}
              bankAccountId={bankAccountId}
              onBankAccountChange={setBankAccountId}
              autoApply={autoApply}
              onAutoApplyChange={setAutoApply}
              actionLabel={actionLabel}
              onOpenAction={() => setPage('action')}
              canSave={canSave}
              isPending={isPending}
              saveLabel={saveLabel}
              onSave={handleSave}
              onCancel={onClose}
            />
          ),
        },
        {
          id: 'action',
          title: 'Action',
          size: 'lg',
          content: (
            <BankRuleActionPage
              action={action}
              onActionChange={setAction}
              glAccountId={glAccountId}
              onGlAccountChange={setGlAccountId}
              counterpartBankAccountId={counterpartBankAccountId}
              onCounterpartChange={setCounterpartBankAccountId}
              memo={memo}
              onMemoChange={setMemo}
              canSave={canSave}
              isPending={isPending}
              saveLabel={saveLabel}
              onSave={handleSave}
              onCancel={onClose}
            />
          ),
        },
      ]}
    />
  )
}
