// apps/web/src/components/accounting/ui/chart-account-create-dialog.tsx
'use client'

// "Blank account" - creating one GL account without leaving the page you are on.
//
// 🛑 This exists because the ONLY other door was Accounting > Settings >
// Accounts, which is a `MasterDetailSplit`: adding an account there means a
// phantom draft row plus the detail pane, neither of which fits in a picker
// popover, and getting to it means abandoning the half-typed journal entry or
// vendor bill the picker was sitting in. Discovering the account you need does
// not exist is something that happens mid-entry, so the fix has to be available
// mid-entry.
//
// ⚠️ DELIBERATELY the four fields `chartAccountCreate` takes and no more. The
// editor on the settings page owns the rest (activation, the provider mapping,
// renumbering and its posted-line warnings); a second full editor here would be
// a second place for those rules to drift.
//
// Copies `payment-gateway-add-dialog.tsx`'s shape: a small `FieldPanel` in a
// dialog, with the refusal handled where the write is.

import { FieldType } from '@auxx/database/enums'
import type {
  ChartAccountRow,
  GlAccountSubtypeValue,
  GlAccountTypeValue,
} from '@auxx/lib/accounting/ledger/client'
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
import { GlAccountPicker, useChartAccounts } from './gl-account-picker'
import {
  ACCOUNT_SUBTYPE_OPTIONS,
  ACCOUNT_TYPE_OPTIONS,
  accountTypeLockReason,
  resolveAccountTypeForParent,
} from './settings/accounts-types'

// Re-exported for `chart-account-create-dialog.test.ts`: the pure function now
// lives in `accounts-types.ts` so `chart-account-editor.tsx` can share it too.
export { resolveAccountTypeForParent } from './settings/accounts-types'

/**
 * ⚠️ A `SINGLE_SELECT` hands its value back as an ARRAY - `['expense']` -
 * because the picker underneath is the multi-select one with `multi: false`
 * (`field-input-adapter.tsx` normalises `value` to `[value]` on the way in and
 * never un-wraps it on the way out). Passing that straight to the wire is a Zod
 * refusal reading "Invalid option: expected one of asset|liability|…", which
 * names the right values and gives no hint that the problem is the shape. Same
 * helper `chart-account-editor.tsx:92` keeps for the same reason.
 */
function firstSelected(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) || null
}

/** The dialog's fields, as it holds them before the write. */
interface CreateDraft {
  code: string
  name: string
  accountType: GlAccountTypeValue | null
  subtype: GlAccountSubtypeValue | null
  /** `null` is top level (CHART-HIERARCHY.md §1 D1). */
  parentId: string | null
}

const EMPTY_DRAFT: CreateDraft = {
  code: '',
  name: '',
  accountType: null,
  subtype: null,
  parentId: null,
}

export interface ChartAccountCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-selects the type, for a caller whose picker is already filtered to one. */
  defaultAccountType?: GlAccountTypeValue
  /** Pre-selects the subtype, for a picker pinned to one (`bank`, `clearing`) - without it the new account would not appear in that picker's list. */
  defaultSubtype?: GlAccountSubtypeValue
  /** Pre-selects the parent - the chart list's "Add sub-account" (CHART-HIERARCHY.md §7). Locks Type to the parent's. */
  defaultParentId?: string | null
  /**
   * The account that was just written. `ledger.chartAccounts` is already
   * invalidated by the time this fires, so a caller only has to select it.
   */
  onCreated?: (account: ChartAccountRow) => void
}

/**
 * ChartAccountCreateDialog
 *
 * Collects the two fields `chartAccountCreate` requires - a name and a
 * statement classification - plus the two it accepts. The code is OPTIONAL by
 * design (task 15 §5): a chart imported from a provider that ships with
 * numbering off, or one kept by name alone, has no code at all, and the lib
 * refuses a blank code the same as an absent one.
 */
export function ChartAccountCreateDialog({
  open,
  onOpenChange,
  defaultAccountType,
  defaultSubtype,
  defaultParentId,
  onCreated,
}: ChartAccountCreateDialogProps) {
  const utils = api.useUtils()
  const { accounts } = useChartAccounts()
  const initial = (): CreateDraft => ({
    ...EMPTY_DRAFT,
    accountType: defaultAccountType ?? null,
    subtype: defaultSubtype ?? null,
    parentId: defaultParentId ?? null,
  })
  const [draft, setDraft] = useState<CreateDraft>(initial)

  const reset = () => setDraft(initial())

  // D3: a sub-account shares its parent's statement type, so choosing one
  // locks Type below.
  const typeLockReason = accountTypeLockReason({ parentId: draft.parentId, accounts })

  const create = api.ledger.chartAccountCreate.useMutation({
    onSuccess: async (account) => {
      // 🛑 Awaited before the caller is told. `onCreated` selects the new
      // account, and a picker that re-reads the chart before the invalidation
      // lands would be selecting an id its own option list does not hold yet.
      await utils.ledger.chartAccounts.invalidate()
      onOpenChange(false)
      reset()
      onCreated?.(account as ChartAccountRow)
    },
    onError: (error) => {
      // A duplicate code, a name the org already uses - `createChartAccount`
      // words its own refusals, so they are shown verbatim rather than
      // flattened into "Something went wrong".
      toastError({ title: 'Error adding the account', description: error.message })
    },
  })

  const canSubmit = !!draft.name.trim() && !!draft.accountType && !create.isPending

  const submit = () => {
    if (!canSubmit) return
    create.mutate({
      code: draft.code.trim() || undefined,
      name: draft.name.trim(),
      accountType: draft.accountType as GlAccountTypeValue,
      subtype: draft.subtype,
      parentId: draft.parentId,
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}>
      <DialogContent position='tc' size='sm'>
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            Adds one account to your chart. Activation, the provider link and renumbering are edited
            on the Accounts settings page.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='accounting-chart-account-create'
          defaultLabelWidth={120}
          className='p-0'>
          <FieldPanelRow
            title='Code'
            type={BaseType.STRING}
            showIcon
            description='Optional. A chart kept by name alone has none, and nothing here needs one.'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.code}
              placeholder='6120'
              disabled={create.isPending}
              onChange={(value) => setDraft({ ...draft, code: (value as string) ?? '' })}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.name}
              placeholder='Software subscriptions'
              disabled={create.isPending}
              onChange={(value) => setDraft({ ...draft, name: (value as string) ?? '' })}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Type'
            type={BaseType.ENUM}
            showIcon
            isRequired
            description='The statement classification. A role can only be mapped to an account of the type it declares.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: ACCOUNT_TYPE_OPTIONS }}
              value={draft.accountType}
              disabled={create.isPending || !!typeLockReason}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              placeholder='Select account type'
              onChange={(value) =>
                setDraft({
                  ...draft,
                  accountType: firstSelected(value) as GlAccountTypeValue | null,
                })
              }
            />
            {typeLockReason && (
              <p className='mt-1 text-muted-foreground text-xs'>{typeLockReason}</p>
            )}
          </FieldPanelRow>

          <FieldPanelRow
            title='Parent account'
            type={BaseType.RELATION}
            showIcon
            description='Nests this account under another of the same statement type. Leave it unset for a top-level account.'>
            <GlAccountPicker
              value={draft.parentId}
              onChange={(next) =>
                setDraft({
                  ...draft,
                  parentId: next,
                  accountType: resolveAccountTypeForParent(next, accounts, draft.accountType),
                })
              }
              selectBy='id'
              filterTypes={draft.accountType ? [draft.accountType] : undefined}
              disabled={create.isPending}
              placeholder='No parent - top level'
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Subtype'
            type={BaseType.ENUM}
            showIcon
            description='What puts this account under Cost of goods sold on the P&L, never the code. Most accounts carry none.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: ACCOUNT_SUBTYPE_OPTIONS }}
              value={draft.subtype}
              disabled={create.isPending}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              placeholder='None'
              onChange={(value) =>
                setDraft({
                  ...draft,
                  subtype: firstSelected(value) as GlAccountSubtypeValue | null,
                })
              }
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
            onClick={submit}
            data-dialog-submit>
            Create account <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
