// apps/web/src/components/accounting/ui/settings/bank-account-manual-dialog.tsx
'use client'

// "Add manually" - the second of the two doors that create a `bank_account`
// (the first is `BankAccountConnectDialog`).
//
// Extracted from `bank-accounts-settings-page.tsx` so the picker can open the
// same dialog the settings page opens. Two copies of this form would be two
// places for the field list and the refusal handling to drift, and the fields
// are not obvious - `last4` is text so a leading zero survives, and `type`
// decides whether the account maps to an asset or a liability.

import { FieldType } from '@auxx/database/enums'
import type { BankAccountRow } from '@auxx/lib/banking/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

const TYPE_OPTIONS = [
  { value: 'depository', label: 'Depository', color: 'blue' as const },
  { value: 'credit', label: 'Credit', color: 'amber' as const },
]

/** The dialog's fields, as it holds them before the write. */
interface ManualDraft {
  name: string
  institution: string
  last4: string
  type: 'depository' | 'credit'
  currency: string
}

const EMPTY_DRAFT: ManualDraft = {
  name: '',
  institution: '',
  last4: '',
  type: 'depository',
  currency: 'USD',
}

export interface BankAccountManualDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The account that was just written. `banking.bankAccount.list` is already
   * invalidated by the time this fires, so a caller only has to do what is
   * particular to it - select the new row, or set it as a field's value.
   */
  onCreated?: (account: BankAccountRow) => void
}

/**
 * BankAccountManualDialog
 *
 * Adds a `bank_account` by hand: for an account statements are imported into,
 * or one at an institution the feed does not cover.
 *
 * 🛑 The refusal is surfaced VERBATIM. `createBankAccount` says that the last
 * four is digits only; replacing that with "Could not save" throws away the one
 * sentence that says what to do next.
 */
export function BankAccountManualDialog({
  open,
  onOpenChange,
  onCreated,
}: BankAccountManualDialogProps) {
  const utils = api.useUtils()
  const [draft, setDraft] = useState<ManualDraft>(EMPTY_DRAFT)

  const create = api.banking.bankAccount.create.useMutation({
    onSuccess: async (account) => {
      await utils.banking.bankAccount.list.invalidate()
      onOpenChange(false)
      setDraft(EMPTY_DRAFT)
      onCreated?.(account)
    },
    onError: (error) => {
      toastError({ title: 'Error adding the account', description: error.message })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        // A dialog reopened after a cancel starts empty. Keeping the draft would
        // resurrect half an account somebody had already walked away from.
        if (!next) setDraft(EMPTY_DRAFT)
      }}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Add a bank account</DialogTitle>
          <DialogDescription>
            For an account you will import statements into, or one at an institution the feed does
            not cover. Map it to your chart afterwards.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='accounting-bank-account-add'
          defaultLabelWidth={140}
          className='p-0'>
          <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.name}
              placeholder='Business Adv Relationship'
              disabled={create.isPending}
              onChange={(value) => setDraft({ ...draft, name: (value as string) ?? '' })}
            />
          </FieldPanelRow>
          <FieldPanelRow title='Institution' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.institution}
              placeholder='Bank of America'
              disabled={create.isPending}
              onChange={(value) => setDraft({ ...draft, institution: (value as string) ?? '' })}
            />
          </FieldPanelRow>
          <FieldPanelRow
            title='Last four'
            type={BaseType.STRING}
            showIcon
            description='Digits only. Stored as text, so a leading zero survives.'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.last4}
              placeholder='5381'
              disabled={create.isPending}
              onChange={(value) => setDraft({ ...draft, last4: (value as string) ?? '' })}
            />
          </FieldPanelRow>
          <FieldPanelRow
            title='Type'
            type={BaseType.ENUM}
            showIcon
            description='A credit card is a liability and maps to a liability account.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: TYPE_OPTIONS }}
              value={draft.type}
              disabled={create.isPending}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              placeholder='Select type'
              onChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (next === 'depository' || next === 'credit') setDraft({ ...draft, type: next })
              }}
            />
          </FieldPanelRow>
          <FieldPanelRow title='Currency' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.currency}
              placeholder='USD'
              disabled={create.isPending}
              onChange={(value) => setDraft({ ...draft, currency: (value as string) ?? '' })}
            />
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            loading={create.isPending}
            loadingText='Adding...'
            disabled={!draft.name.trim()}
            onClick={() =>
              create.mutate({
                name: draft.name.trim(),
                institution: draft.institution.trim() || null,
                last4: draft.last4.trim() || null,
                type: draft.type,
                currency: draft.currency.trim() || null,
              })
            }
            data-dialog-submit>
            Add account <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
