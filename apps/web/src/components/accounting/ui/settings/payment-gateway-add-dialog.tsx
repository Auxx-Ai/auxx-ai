// apps/web/src/components/accounting/ui/settings/payment-gateway-add-dialog.tsx
'use client'

// "Add gateway" - the only door that creates a `payment_gateway` record
// (task 13 §5.3). Copies `bank-account-manual-dialog.tsx`'s shape: a small
// `FieldPanel` in a dialog, extracted so the fields and the refusal handling
// live in one place.

import { FieldType } from '@auxx/database/enums'
import type { PaymentGatewayRow } from '@auxx/lib/payment-gateways/client'
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
import { useMemo, useState } from 'react'
import { GlAccountPicker } from '~/components/accounting/ui/gl-account-picker'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

/** The dialog's fields, as it holds them before the write. */
interface AddDraft {
  name: string
  handles: string[]
  clearingAccountId: string | null
}

const EMPTY_DRAFT: AddDraft = { name: '', handles: [], clearingAccountId: null }

export interface PaymentGatewayAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The gateway that was just written. `paymentGateway.list` is already
   * invalidated by the time this fires, so a caller only has to select it.
   */
  onCreated?: (gateway: PaymentGatewayRow) => void
}

/**
 * PaymentGatewayAddDialog
 *
 * Collects the three fields `createPaymentGateway` requires - name, at least
 * one handle, and an active asset clearing account - before enabling Add.
 * Fee account and settlement source are left to the editor, since they are
 * optional and `manual`/null are already correct defaults for most rails.
 */
export function PaymentGatewayAddDialog({
  open,
  onOpenChange,
  onCreated,
}: PaymentGatewayAddDialogProps) {
  const utils = api.useUtils()
  const [draft, setDraft] = useState<AddDraft>(EMPTY_DRAFT)

  const create = api.paymentGateway.create.useMutation({
    onSuccess: async (gateway) => {
      await utils.paymentGateway.list.invalidate()
      onOpenChange(false)
      setDraft(EMPTY_DRAFT)
      onCreated?.(gateway)
    },
    onError: (error) => {
      toastError({ title: 'Error adding the gateway', description: error.message })
    },
  })

  // 🛑 The option set is DERIVED from the values. `payment_gateway_handles` is an
  // OPEN, value-keyed TAGS field - the registry declares `options: { options: [] }`
  // and the write stores the raw string - so a stored handle matches no option row.
  // Handing the picker a literal `[]` made every handle resolve `unknown`: the
  // trigger rendered it italic-grey as "not in this field's option set", and it
  // never appeared in the popover at all, so it could not be unchecked. Nothing is
  // wrong with what is stored; the input has to be told the values ARE the options.
  // The `useMemo` is load-bearing too - a fresh `[]` each render re-fired
  // `MultiSelectPicker`'s options sync and wiped the tag being typed.
  const handleOptions = useMemo(
    () => draft.handles.map((handle) => ({ label: handle, value: handle })),
    [draft.handles]
  )

  const canSubmit = draft.name.trim() && draft.handles.length > 0 && draft.clearingAccountId

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setDraft(EMPTY_DRAFT)
      }}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Add a payment gateway</DialogTitle>
          <DialogDescription>
            A record carrying its own clearing account - never a role. Two rails can share one
            account; this only says which account, it never mints a new one.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='accounting-payment-gateway-add'
          defaultLabelWidth={140}
          className='p-0'>
          <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.name}
              placeholder='Authorize.Net'
              disabled={create.isPending}
              onChange={(value) => setDraft({ ...draft, name: (value as string) ?? '' })}
            />
          </FieldPanelRow>
          <FieldPanelRow
            title='Gateway handles'
            type={BaseType.STRING}
            showIcon
            isRequired
            description='Every stored value this rail is seen under.'>
            <FieldInputAdapter
              fieldType={FieldType.TAGS}
              fieldOptions={{ options: handleOptions }}
              useValueAsLabel
              value={draft.handles}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              placeholder='Add a handle'
              disabled={create.isPending}
              onChange={(value) =>
                setDraft({ ...draft, handles: Array.isArray(value) ? (value as string[]) : [] })
              }
            />
          </FieldPanelRow>
          <FieldPanelRow title='Clearing account' type={BaseType.STRING} showIcon isRequired>
            <GlAccountPicker
              value={draft.clearingAccountId}
              selectBy='id'
              filterTypes={['asset']}
              placeholder='Select account…'
              disabled={create.isPending}
              onChange={(id) => setDraft({ ...draft, clearingAccountId: id })}
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
            disabled={!canSubmit}
            onClick={() =>
              create.mutate({
                name: draft.name.trim(),
                handles: draft.handles,
                clearingAccountId: draft.clearingAccountId as string,
              })
            }
            data-dialog-submit>
            Add gateway <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
