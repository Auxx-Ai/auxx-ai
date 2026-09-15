// apps/web/src/components/accounting/ui/settings/gateway-settlement-fields.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { PaymentGatewayRow } from '@auxx/lib/payment-gateways/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import Link from 'next/link'
import { BankAccountPicker } from '~/components/accounting/ui/bank-account-picker'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** Edit the gateway's settlement fields while showing independent connector health. */
export function GatewaySettlementFields({ gateway }: { gateway: PaymentGatewayRow }) {
  const { can } = useAccess()
  const query = api.paymentGateway.settlementReadiness.useQuery({ gatewayId: gateway.id })
  const utils = api.useUtils()
  const update = api.paymentGateway.updateSettlementSettings.useMutation({
    onSuccess: async (data) => {
      utils.paymentGateway.settlementReadiness.setData({ gatewayId: gateway.id }, data)
      await utils.paymentGateway.list.invalidate()
    },
    onError: (error) =>
      toastError({ title: 'Could not save settlement settings', description: error.message }),
  })
  const data = query.data
  const sourceAccounts = data?.accounts ?? []
  const selectedAccount = sourceAccounts.find(
    (account) => account.processorAccountId === gateway.processorAccountId
  )
  const options = sourceAccounts.map((account) => ({
    value: account.processorAccountId,
    label: `${account.providerKey} · ${account.externalAccountId}`,
  }))
  const currencyOptions = [
    ...new Set([
      ...(selectedAccount?.currencies ?? []),
      ...(gateway.settlementCurrency ? [gateway.settlementCurrency] : []),
    ]),
  ].map((currency) => ({ value: currency, label: currency }))
  const disabled =
    update.isPending || !can(PermissionKey.ledgerControl) || gateway.status === 'closed'
  if (query.isPending)
    return <p className='text-muted-foreground text-xs'>Loading settlement settings…</p>
  if (query.error)
    return (
      <div className='text-destructive text-sm'>
        {query.error.message}
        <Button variant='ghost' size='sm' onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    )
  if (!data) return null
  const save = (patch: {
    processorAccountId?: string | null
    settlementCurrency?: string | null
    bankAccountId?: string | null
  }) => update.mutate({ gatewayId: gateway.id, patch })
  const selectValue = (value: unknown) =>
    typeof value === 'string'
      ? value
      : Array.isArray(value) && typeof value[0] === 'string'
        ? value[0]
        : null

  return (
    <div className='flex flex-col gap-2'>
      <FieldPanel
        className='shrink-0 grow-0 p-0'
        orientation='responsive'
        resizeId='accounting-payment-gateway'
        defaultLabelWidth={150}>
        {
          <FieldPanelRow
            title='Settlement account'
            type={BaseType.ENUM}
            showIcon
            description='The merchant account identified by imported settlement activity.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options }}
              value={gateway.processorAccountId}
              disabled={disabled}
              placeholder='Select merchant account'
              onChange={(value) => {
                const processorAccountId = selectValue(value)
                const account = sourceAccounts.find(
                  (item) => item.processorAccountId === processorAccountId
                )
                const currency = account?.currencies.length === 1 ? account.currencies[0]! : null
                save({
                  processorAccountId,
                  settlementCurrency: currency,
                  bankAccountId:
                    currency === gateway.settlementCurrency ? gateway.bankAccountId : null,
                })
              }}
            />
          </FieldPanelRow>
        }
        <FieldPanelRow
          title='Settlement currency'
          type={BaseType.STRING}
          showIcon
          description='The currency deposited into the receiving bank account.'>
          {!selectedAccount ? (
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={gateway.settlementCurrency}
              disabled={disabled}
              placeholder='USD'
              onChange={(value) => {
                const currency = typeof value === 'string' ? value.trim().toUpperCase() : ''
                if (/^[A-Z]{3}$/.test(currency))
                  save({
                    settlementCurrency: currency,
                    bankAccountId:
                      currency === gateway.settlementCurrency ? gateway.bankAccountId : null,
                  })
              }}
            />
          ) : (
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: currencyOptions }}
              value={gateway.settlementCurrency}
              disabled={disabled || !selectedAccount}
              placeholder='Select currency'
              onChange={(value) => {
                const settlementCurrency = selectValue(value)
                save({
                  settlementCurrency,
                  bankAccountId:
                    settlementCurrency === gateway.settlementCurrency
                      ? gateway.bankAccountId
                      : null,
                })
              }}
            />
          )}
        </FieldPanelRow>
        <FieldPanelRow title='Receiving bank' type={BaseType.RELATION} showIcon>
          <BankAccountPicker
            value={gateway.bankAccountId}
            disabled={disabled || !gateway.settlementCurrency}
            onChange={(bankAccountId) => save({ bankAccountId })}
          />
        </FieldPanelRow>
      </FieldPanel>
      {selectedAccount?.connections.length ? (
        <div className='flex flex-col gap-1'>
          {selectedAccount.connections.map((connection) => (
            <p key={connection.connectorId} className='text-muted-foreground text-xs'>
              {connection.connectorName}:{' '}
              {connection.requiresReauth
                ? 'Reconnect to acquire new activity.'
                : !connection.verified
                  ? 'Sync to verify the current account.'
                  : connection.connectorStatus}
              .{' '}
              <Link className='underline' href={`/app/connectors/${connection.connectorId}`}>
                Manage connection
              </Link>
            </p>
          ))}
        </div>
      ) : (
        <p className='text-muted-foreground text-xs'>
          {selectedAccount
            ? 'No current connection is linked to this account. Imported activity remains available.'
            : 'Import payout or balance activity to make its merchant account available here.'}{' '}
          <Link className='underline' href='/app/connectors'>
            Open connectors
          </Link>
        </p>
      )}
      <div className='text-muted-foreground text-xs'>
        {update.isPending
          ? 'Saving…'
          : data.configured
            ? 'Settlement mappings configured.'
            : data.issues.map((issue) => <p key={issue}>{issue}</p>)}
      </div>
    </div>
  )
}
