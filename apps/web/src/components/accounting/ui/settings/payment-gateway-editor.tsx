// apps/web/src/components/accounting/ui/settings/payment-gateway-editor.tsx
'use client'

// The right pane of Accounting > Settings > Payment gateways (task 13 §5.3).
//
// 🛑 Copies `bank-account-editor.tsx`'s ONE SAVE MODEL: every row commits on
// change, no `Save` button, no dirty guard. See that file's header for why -
// the same argument holds here unchanged (a record editor beside a master
// list, not a section-shaped settings form).
//
// 🛑 Handles is a TAG input, not a text field (§5.1's census: two rails arrive
// under two spellings each, and a single-string field re-creates the exact
// problem this record exists to solve). Rendered through `FieldInputAdapter`
// with `FieldType.TAGS`, the same idiom `order_payment_gateways` uses.
//
// 🛑 Clearing account is filtered to `asset`, fee account to `expense` - the
// picker is a convenience; `writes.ts`'s refusal sentence is the actual
// defence, and it is surfaced verbatim on save.

import { FieldType } from '@auxx/database/enums'
import type { PaymentGatewayRow } from '@auxx/lib/payment-gateways/client'
import {
  PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS,
  PAYMENT_GATEWAY_SETTLEMENT_SOURCES,
} from '@auxx/lib/payment-gateways/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { CreditCard } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { GlAccountPicker } from '~/components/accounting/ui/gl-account-picker'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'

const SETTLEMENT_SOURCE_OPTIONS = PAYMENT_GATEWAY_SETTLEMENT_SOURCES.map((value) => ({
  value,
  label: PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS[value],
  color: value === 'manual' ? ('gray' as const) : ('green' as const),
}))

/** How long a text row waits after the last keystroke before it writes. */
const TEXT_COMMIT_DELAY_MS = 500

export interface PaymentGatewayPatch {
  name?: string
  handles?: string[]
  clearingAccountId?: string
  feeAccountId?: string | null
  settlementSource?: PaymentGatewayRow['settlementSource']
  lastSettlementAt?: string | null
}

/**
 * Cancels the scroll container's `p-3` so a `Section` sits FLUSH with the
 * panel. See `bank-account-editor.tsx`'s `SECTION_BLEED` for the full reason.
 */
const SECTION_BLEED = '-mx-3'

interface PaymentGatewayEditorProps {
  gateway: PaymentGatewayRow | null
  /** True while an `update` is in flight. */
  pending: boolean
  /** True while the close is in flight. */
  closing?: boolean
  onPatch: (patch: PaymentGatewayPatch) => void
  /** Mark the gateway closed. Disabled while it already is. */
  onClose: () => void
}

export function PaymentGatewayEditor({ gateway, ...rest }: PaymentGatewayEditorProps) {
  if (!gateway) {
    return (
      <div className='p-4 text-muted-foreground text-sm'>
        Select a gateway to map it to your chart, or add one.
      </div>
    )
  }
  // Keyed on the gateway: the name row holds local state so an in-flight
  // write cannot flicker a half-typed field back to its stored value, and
  // selecting a different gateway has to reseed that state rather than carry
  // it across.
  return <PaymentGatewayForm key={gateway.id} gateway={gateway} {...rest} />
}

function PaymentGatewayForm({
  gateway,
  pending,
  closing = false,
  onPatch,
  onClose,
}: PaymentGatewayEditorProps & { gateway: PaymentGatewayRow }) {
  const [name, setName] = useState(gateway.name)
  const nameRef = useRef(name)

  const commitName = useDebouncedCallback((value: string) => {
    if (value.trim()) onPatch({ name: value })
  }, TEXT_COMMIT_DELAY_MS)

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
    () => gateway.handles.map((handle) => ({ label: handle, value: handle })),
    [gateway.handles]
  )

  const isClosed = gateway.status === 'closed'

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3'>
      <div className='flex min-w-0 flex-col gap-1'>
        <span className='flex items-center gap-2 truncate font-medium text-sm'>
          <CreditCard className='size-4 text-muted-foreground' />
          {gateway.name || 'Untitled gateway'}
        </span>
        <span className='text-muted-foreground text-xs'>
          {isClosed
            ? 'Closed. Its history still routes to this clearing account, but a merchant would add a new gateway for a new rail.'
            : 'A record carrying its own clearing account, never a role - two rails can share one account.'}
        </span>
      </div>

      <FieldPanel
        className='shrink-0 grow-0 p-0'
        resizeId='accounting-payment-gateway'
        defaultLabelWidth={150}>
        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={name}
            placeholder='Authorize.Net'
            onChange={(value) => {
              const next = (value as string) ?? ''
              nameRef.current = next
              setName(next)
              commitName(next)
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Gateway handles'
          type={BaseType.STRING}
          showIcon
          isRequired
          description='Every stored value this rail is seen under. Two spellings of the same rail (authorize_net / authorize.net) both belong here.'>
          <FieldInputAdapter
            fieldType={FieldType.TAGS}
            fieldOptions={{ options: handleOptions }}
            useValueAsLabel
            value={gateway.handles}
            // 🛑 `showClear: false` - the trigger's X is a CLEAR ALL, and a
            // gateway with no handle is refused by `updatePaymentGateway`
            // ("at least one handle"), so the button could only ever be a
            // silent no-op: the guard below drops the write and the next
            // render puts every tag straight back. A control that cannot
            // succeed does not belong on the row.
            triggerProps={{ className: 'w-full ps-0 pe-1', showClear: false }}
            placeholder='Add a handle'
            onChange={(value) => {
              const handles = Array.isArray(value) ? (value as string[]) : []
              if (handles.length > 0) onPatch({ handles })
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Clearing account'
          type={BaseType.STRING}
          showIcon
          isRequired
          description='Where this gateway settles. Two gateways sharing one account is fine - this only says which account, it never mints a new one.'>
          {/* 🛑 `showClear: false`, same argument as Gateway handles above: the
              clearing account is REQUIRED - it is where this rail's money lands
              on the balance sheet - so `onChange(null)` is dropped by the guard
              and the X could only ever be a no-op. The fee account below keeps
              its X, because null there is a real answer (fall back to the
              default merchant-fees account). */}
          <GlAccountPicker
            value={gateway.clearingGlAccountId}
            selectBy='id'
            filterTypes={['asset']}
            placeholder='Select account…'
            triggerProps={{ showClear: false }}
            onChange={(id) => id && onPatch({ clearingAccountId: id })}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Fee account'
          type={BaseType.STRING}
          showIcon
          description='Where the processor’s withheld fee lands. Falls back to your default merchant-fees account until you set one.'>
          <GlAccountPicker
            value={gateway.feeGlAccountId}
            selectBy='id'
            filterTypes={['expense']}
            placeholder='Select account…'
            onChange={(id) => onPatch({ feeAccountId: id })}
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Settlement source'
          type={BaseType.ENUM}
          showIcon
          description='Automatic reads a real payout feed. By hand is what Affirm and every historical rail correctly are.'>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: SETTLEMENT_SOURCE_OPTIONS }}
            value={gateway.settlementSource}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            placeholder='Select settlement source'
            onChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value
              if (next === 'stripe' || next === 'shopify_payments' || next === 'manual') {
                onPatch({ settlementSource: next })
              }
            }}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Status' type={BaseType.ENUM} showIcon>
          <div className='flex min-h-8 items-center'>
            <Badge variant={isClosed ? 'secondary' : 'outline'} size='sm'>
              {isClosed ? 'Closed' : 'Active'}
            </Badge>
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Last settlement'
          type={BaseType.DATE}
          showIcon
          description='Informational only - nothing in posting reads this.'>
          <FieldInputAdapter
            fieldType={FieldType.DATE}
            value={gateway.lastSettlementAt ? `${gateway.lastSettlementAt}T00:00:00.000Z` : null}
            onChange={(value) => {
              const iso = value as string | null
              onPatch({ lastSettlementAt: iso ? iso.slice(0, 10) : null })
            }}
          />
        </FieldPanelRow>
      </FieldPanel>

      <div className='min-h-4 text-muted-foreground text-xs'>{pending ? 'Saving…' : null}</div>

      {!isClosed && (
        <Section title='Danger zone' initialOpen={false} className={SECTION_BLEED}>
          <div className='flex flex-col gap-2 p-1'>
            <p className='text-muted-foreground text-xs'>
              Closing keeps every shipment that ever routed here posting to this same clearing
              account, so its balance still winds down correctly. It just stops offering this
              gateway as the answer for a new order.
            </p>
            <div>
              <Button variant='destructive' size='sm' loading={closing} onClick={onClose}>
                Close gateway
              </Button>
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}
