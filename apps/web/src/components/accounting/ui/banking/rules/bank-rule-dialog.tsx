// apps/web/src/components/accounting/ui/banking/rules/bank-rule-dialog.tsx

'use client'

import type {
  BankRuleAction,
  BankRuleDirection,
  BankRuleMatchField,
  BankRuleMatchOperator,
  BankRuleRecord,
} from '@auxx/lib/banking/rules/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useState } from 'react'
import { RuleDialogShell } from '~/components/rules/ui/rule-dialog-shell'
import { api } from '~/trpc/react'
import { useChartAccounts } from '../../gl-account-picker'
import { BankRuleActionPage } from './bank-rule-action-page'
import { BankRuleConfigurePage } from './bank-rule-configure-page'
import { describeActionDetail } from './bank-rule-options'

interface BankRuleDialogProps {
  open: boolean
  onClose: () => void
  /** Null ⇒ create. */
  rule?: BankRuleRecord | null
}

/**
 * Create/edit dialog for a bank rule - a two-page `RuleDialogShell` flow:
 * `configure` (name, what it matches, which lines, auto-apply) → `action`
 * (code / transfer / exclude, plus an optional memo).
 *
 * This dialog owns all form state; the shell owns navigation only, exactly like
 * `RecordRuleDialog` and `MailFilterDialog`.
 */
export function BankRuleDialog({ open, onClose, rule }: BankRuleDialogProps) {
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
  const [glAccountCode, setGlAccountCode] = useState('')
  const [counterpartBankAccountId, setCounterpartBankAccountId] = useState('')
  const [memo, setMemo] = useState('')

  // Re-seed form state whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setPage('configure')
    setName(rule?.name ?? '')
    setMatchField(rule?.matchField ?? 'matchKey')
    setMatchOperator(rule?.matchOperator ?? 'contains')
    setMatchValue(rule?.matchValue ?? '')
    setDirection(rule?.direction ?? 'any')
    setBankAccountId(rule?.bankAccountId ?? '')
    setAutoApply(rule?.autoApply ?? false)
    setAction(rule?.action ?? 'code')
    setGlAccountCode(rule?.glAccountCode ?? '')
    setCounterpartBankAccountId(rule?.counterpartBankAccountId ?? '')
    setMemo(rule?.memo ?? '')
  }, [open, rule])

  const accountsQuery = api.banking.bankAccount.list.useQuery(undefined, { enabled: open })
  const accountOptions: SelectOption[] = useMemo(
    () =>
      (accountsQuery.data ?? []).map((account) => ({
        value: account.id,
        label: account.name ?? account.id,
      })),
    [accountsQuery.data]
  )

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
      ? glAccountCode.length > 0
      : action === 'transfer'
        ? counterpartBankAccountId.length > 0
        : true)

  const actionLabel = describeActionDetail({
    action,
    glAccountCode,
    glAccountName: chartAccounts.find((a) => a.code === glAccountCode)?.name,
    counterpartName: accountOptions.find((a) => a.value === counterpartBankAccountId)?.label,
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
      glAccountCode: action === 'code' ? glAccountCode : null,
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
              accountOptions={accountOptions}
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
              glAccountCode={glAccountCode}
              onGlAccountChange={setGlAccountCode}
              counterpartBankAccountId={counterpartBankAccountId}
              onCounterpartChange={setCounterpartBankAccountId}
              accountOptions={accountOptions}
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
