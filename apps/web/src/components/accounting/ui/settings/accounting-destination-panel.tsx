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

/** Choose the company and first accounting date, or restore an existing company's authorization. */
export function AccountingDestinationPanel() {
  const { can } = useAccess()
  const canControl = can(PermissionKey.ledgerControl)
  const providerName =
    useAccountingProviderStatus().providerEntry?.shortLabel ?? UNKNOWN_PROVIDER_LABEL
  const status = api.ledger.bookConnectionStatus.useQuery(undefined, { enabled: canControl })
  const utils = api.useUtils()
  const [editing, setEditing] = useState(false)
  const [repairId, setRepairId] = useState<string | null>(null)
  const [credentialId, setCredentialId] = useState('')
  const [exportFromDate, setExportFromDate] = useState('')
  const [reason, setReason] = useState('')
  const saved = async () => {
    setEditing(false)
    setRepairId(null)
    setReason('')
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
  if (!canControl) return null
  if (status.isPending)
    return <p className='text-muted-foreground text-sm'>Loading accounting company.</p>
  if (status.error)
    return (
      <div className='flex items-center justify-between gap-2 text-sm'>
        <span>{status.error.message}</span>
        <Button variant='outline' size='sm' onClick={() => void status.refetch()}>
          Retry
        </Button>
      </div>
    )
  const data = status.data
  if (!data) return null
  const current = data.connections.find((connection) => connection.id === data.activeConnectionId)
  const repairing = data.connections.find((connection) => connection.id === repairId)
  const credentials = data.credentials.filter(
    (credential) =>
      credential.companyId && (!repairing || credential.companyId === repairing.companyId)
  )
  const pending = activate.isPending || repair.isPending
  const open = (id: string | null = null) => {
    setRepairId(id)
    setEditing(true)
    setCredentialId('')
    setReason('')
    setExportFromDate('')
  }
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
      <FieldPanel className='p-0' resizeId='accounting-destination' orientation='responsive'>
        <FieldPanelRow
          title='Accounting company'
          description='New fulfillment journals keep the company assigned when they are posted.'>
          <div className='flex w-full flex-wrap items-center justify-between gap-2 text-sm'>
            <span>
              {current
                ? `Company ${current.companyId}, from ${current.exportFromDate}`
                : 'Choose a company and export start date.'}
            </span>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => void status.refetch()}
              disabled={pending}>
              Refresh
            </Button>
            <Button variant='outline' size='sm' onClick={() => open()} disabled={pending}>
              {current ? 'Change' : 'Set up'}
            </Button>
          </div>
        </FieldPanelRow>
        {data.connections
          .filter((connection) => connection.state !== 'active' || connection.id === current?.id)
          .map((connection) => (
            <FieldPanelRow
              key={connection.id}
              title={`Company ${connection.companyId}`}
              description={`From ${connection.exportFromDate}`}>
              <div className='flex w-full items-center justify-between gap-2'>
                <Badge variant='outline' size='xs'>
                  {connection.state === 'active'
                    ? 'Current'
                    : connection.state === 'disconnected'
                      ? 'Disconnected'
                      : 'Previous'}
                </Badge>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={pending || (!!current && current.bookId !== connection.bookId)}
                  onClick={() => open(connection.id)}>
                  Restore connection
                </Button>
              </div>
            </FieldPanelRow>
          ))}
      </FieldPanel>
      {editing && (
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
              Authorize this {providerName} company for the organization using Manage, then refresh
              this section.
            </p>
          )}
          <div className='flex flex-wrap justify-end gap-2'>
            <Button variant='ghost' size='sm' disabled={pending} onClick={() => setEditing(false)}>
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
      )}
    </div>
  )
}
