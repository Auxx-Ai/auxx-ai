// apps/web/src/components/accounting/ui/settings/accounting-destination-panel.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '../../hooks/use-accounting-provider-status'

/** The accounting company exports go to, its history, and the open edit form. `ledgerControl` only. */
export function useAccountingDestination() {
  const { can } = useAccess()
  const canControl = can(PermissionKey.ledgerControl)
  const status = api.ledger.bookConnectionStatus.useQuery(undefined, { enabled: canControl })
  const [editing, setEditing] = useState(false)
  const [repairId, setRepairId] = useState<string | null>(null)

  const data = status.data
  const current = data?.connections.find((c) => c.id === data.activeConnectionId)
  const previous =
    data?.connections.filter((c) => c.state !== 'active' && c.id !== data.activeConnectionId) ?? []

  const open = (id: string | null = null) => {
    // Picks up an authorization made in Manage since the page loaded.
    void status.refetch()
    setRepairId(id)
    setEditing(true)
  }
  const close = () => {
    setEditing(false)
    setRepairId(null)
  }

  return { canControl, status, data, current, previous, editing, repairId, open, close }
}

export type AccountingDestination = ReturnType<typeof useAccountingDestination>

/** "Exporting from" row: the active company's export start, with Change / Set up. */
export function DestinationRow({ destination }: { destination: AccountingDestination }) {
  const { canControl, status, current, open } = destination
  if (!canControl) return null

  return (
    <FieldPanelRow
      title='Exporting from'
      description='The first accounting date exported to this company. Journals already posted keep the company they were assigned.'>
      <div className='flex min-h-8 w-full items-center justify-between gap-2 text-sm'>
        {status.isPending ? (
          <span className='text-muted-foreground'>Loading…</span>
        ) : status.error ? (
          <span className='text-destructive'>{status.error.message}</span>
        ) : (
          <span className='tabular-nums'>
            {current?.exportFromDate ?? 'Choose a company and export start date.'}
          </span>
        )}
        <Button variant='outline' size='sm' disabled={status.isPending} onClick={() => open()}>
          {current ? 'Change' : 'Set up'}
        </Button>
      </div>
    </FieldPanelRow>
  )
}

/** One row per previous or disconnected company, each restorable. */
export function PreviousCompanyRows({ destination }: { destination: AccountingDestination }) {
  const { current, previous, open, repairId, editing } = destination
  const busy = editing && !!repairId

  return previous.map((connection) => (
    <FieldPanelRow
      key={connection.id}
      title={`Company ${connection.companyId}`}
      description={`Exported from ${connection.exportFromDate}`}>
      <div className='flex w-full items-center justify-between gap-2'>
        <Badge variant='outline' size='xs'>
          {connection.state === 'disconnected' ? 'Disconnected' : 'Previous'}
        </Badge>
        <Button
          variant='outline'
          size='sm'
          disabled={busy || (!!current && current.bookId !== connection.bookId)}
          onClick={() => open(connection.id)}>
          Restore connection
        </Button>
      </div>
    </FieldPanelRow>
  ))
}

/** The Change / Restore form, rendered under whichever panel opened it. */
export function DestinationEditor({ destination }: { destination: AccountingDestination }) {
  const { data, repairId, editing, close } = destination
  const providerName =
    useAccountingProviderStatus().providerEntry?.shortLabel ?? UNKNOWN_PROVIDER_LABEL
  const utils = api.useUtils()
  const [credentialId, setCredentialId] = useState('')
  const [exportFromDate, setExportFromDate] = useState('')
  const [reason, setReason] = useState('')

  const reset = () => {
    close()
    setCredentialId('')
    setExportFromDate('')
    setReason('')
  }
  const saved = async () => {
    reset()
    await utils.ledger.bookConnectionStatus.invalidate()
  }
  const activate = api.ledger.activateBookConnection.useMutation({
    onSuccess: saved,
    onError: (error) =>
      toastError({ title: 'Could not set accounting company', description: error.message }),
  })
  const repair = api.ledger.repairBookConnection.useMutation({
    onSuccess: saved,
    onError: (error) =>
      toastError({ title: 'Could not restore accounting connection', description: error.message }),
  })

  if (!editing || !data) return null

  const repairing = data.connections.find((connection) => connection.id === repairId)
  const credentials = data.credentials.filter(
    (credential) =>
      credential.companyId && (!repairing || credential.companyId === repairing.companyId)
  )
  const pending = activate.isPending || repair.isPending

  const submit = () => {
    if (repairId) {
      repair.mutate({
        connectionId: repairId,
        credentialId,
        expectedActiveConnectionId: data.activeConnectionId,
        reason,
      })
      return
    }
    activate.mutate({
      credentialId,
      expectedActiveConnectionId: data.activeConnectionId,
      openingPolicy: { version: 1, kind: 'explicit_cutover', exportFromDate, reason },
    })
  }

  return (
    <div className='space-y-3'>
      <p className='text-sm'>
        {repairing
          ? `Restore authorization for company ${repairing.companyId}. Its original accounting dates and assigned journals are retained.`
          : 'Choose the first accounting date to export to this company. Previously posted journals retain their assigned company.'}
      </p>
      <FieldPanel className='p-0' resizeId='accounting-destination' orientation='responsive'>
        <FieldPanelRow title='Authorization' isRequired>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            value={credentialId}
            onChange={(value) => setCredentialId(String(value ?? ''))}
            disabled={pending}
            placeholder={`Choose ${providerName} authorization`}
            fieldOptions={{
              options: credentials.map((credential) => ({
                id: credential.id,
                value: credential.id,
                label: `${credential.label} (${credential.companyId})`,
              })),
            }}
          />
        </FieldPanelRow>
        {!repairing && (
          <FieldPanelRow
            title='Export from'
            isRequired
            description='First accounting date eligible for new exports.'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={exportFromDate}
              onChange={(value) => setExportFromDate(String(value ?? ''))}
              placeholder='YYYY-MM-DD'
              disabled={pending}
            />
          </FieldPanelRow>
        )}
        <FieldPanelRow title='Reason' isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={reason}
            onChange={(value) => setReason(String(value ?? ''))}
            placeholder={
              repairing
                ? 'Why this connection is being restored'
                : 'Why this export start date was chosen'
            }
            disabled={pending}
          />
        </FieldPanelRow>
      </FieldPanel>
      {credentials.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          Authorize this {providerName} company for the organization using Manage, then open this
          form again.
        </p>
      )}
      <div className='flex flex-wrap justify-end gap-2'>
        <Button variant='ghost' size='sm' disabled={pending} onClick={reset}>
          Cancel
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={
            !credentialId ||
            !reason.trim() ||
            (!repairing && !/^\d{4}-\d{2}-\d{2}$/.test(exportFromDate))
          }
          loading={pending}
          loadingText='Saving...'
          onClick={submit}>
          {repairing ? 'Restore connection' : 'Save accounting company'}
        </Button>
      </div>
    </div>
  )
}
