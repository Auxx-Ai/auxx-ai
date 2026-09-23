// apps/web/src/components/accounting/ui/settings/payment-gateways-settings-page.tsx
'use client'

// Accounting > Settings > Payment gateways (task 13 §5.3). The only NEW
// screen in the whole payments story - everything else in `18` is an
// addition to a surface that already exists.
//
// Shape B, master-detail: `SettingsPage` + `MasterDetailSplit`, the same
// `bank-accounts-settings-page.tsx` shape minus the tab strip and the feed
// actions (a gateway has no connector to sync or disconnect).
//
// 🛑 Every write here is `ledgerControl` - a gateway's clearing account
// decides where card and BNPL money lands on the balance sheet, the same rung
// `bank-accounts-settings-page.tsx` argues for its own mapping.

import { normaliseGatewayHandle } from '@auxx/lib/accounting/rails/client'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { toastError } from '@auxx/ui/components/toast'
import { Lock } from 'lucide-react'
import { parseAsBoolean, useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import SettingsPage from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { PaymentGatewayAddDialog } from './payment-gateway-add-dialog'
import { PaymentGatewayEditor, type PaymentGatewayPatch } from './payment-gateway-editor'
import { PaymentGatewaysList } from './payment-gateways-list'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Payment gateways' },
]

const PAGE_DESCRIPTION =
  'The rails that take money for an order. Each rail maps its clearing, fee and bank accounts on the Mapping tab or here.'

export function PaymentGatewaysSettingsPage() {
  // 🛑 `ledgerControl`, not `ledgerView`. Every control on this page is a
  // WRITE - the mapping, the add, the close - and the page has no read-only
  // rendering, so a lower gate handed a viewer live controls the server then
  // refused one by one. Same rung `bank-accounts-settings-page.tsx` argues.
  useRequireCapability(PermissionKey.ledgerControl)
  const { hasAccess } = useFeatureFlags()
  const utils = api.useUtils()

  // 🛑 The row selection lives in the URL, like the bank accounts screen's
  // does. This is the screen people are sent to ("map Authorize.Net to
  // 1200"), and a pane that vanishes on refresh cannot be linked to.
  const [gatewayParam, setSelectedId] = useQueryState('gateway')
  const [addOpen, setAddOpen] = useState(false)
  // `?handle=`: a link from a Blocked row naming the handle to route.
  const [handleParam, setHandleParam] = useQueryState('handle')
  const [addHandle, setAddHandle] = useState<string | undefined>()
  const [showClosed, setShowClosed] = useQueryState('closed', parseAsBoolean.withDefault(false))
  const [confirm, ConfirmDialog] = useConfirm()

  const gateways = api.paymentGateway.list.useQuery({ includeArchived: true })
  const rows = useMemo(() => gateways.data ?? [], [gateways.data])
  const visibleRows = useMemo(
    () => (showClosed ? rows : rows.filter((row) => row.status !== 'closed')),
    [rows, showClosed]
  )

  // An already-routed handle opens its gateway; an unrouted one opens the add dialog seeded with it.
  useEffect(() => {
    if (!handleParam || gateways.isPending) return
    const key = normaliseGatewayHandle(handleParam)
    const routed = rows.find((row) => row.handles.some((h) => normaliseGatewayHandle(h) === key))
    if (routed) setSelectedId(routed.id)
    else {
      setAddHandle(handleParam)
      setAddOpen(true)
    }
    void setHandleParam(null)
  }, [handleParam, gateways.isPending, rows, setSelectedId, setHandleParam])

  const selectedId =
    gatewayParam && (gateways.isPending || rows.some((row) => row.id === gatewayParam))
      ? gatewayParam
      : null
  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId]
  )

  const invalidate = useCallback(async () => {
    // `observedHandles` too: a handle this gateway just claimed stops being offered.
    await Promise.all([
      utils.paymentGateway.list.invalidate(),
      utils.paymentGateway.observedHandles.invalidate(),
    ])
  }, [utils])

  // 🛑 Refusals are surfaced VERBATIM. `updatePaymentGateway` says which
  // account or handle is wrong; "Could not save" throws that away.
  const update = api.paymentGateway.update.useMutation({
    onSuccess: invalidate,
    onError: (error) => {
      toastError({ title: 'Error saving the gateway', description: error.message })
    },
  })

  const archive = api.paymentGateway.archive.useMutation({
    onSuccess: invalidate,
    onError: (error) => {
      toastError({ title: 'Error closing the gateway', description: error.message })
    },
  })

  const handlePatch = useCallback(
    (patch: PaymentGatewayPatch) => {
      if (!selectedId) return
      update.mutate({ id: selectedId, ...patch })
    },
    [selectedId, update]
  )

  const handleClose = useCallback(async () => {
    if (!selected) return
    const confirmed = await confirm({
      title: `Close ${selected.name?.trim() || 'this gateway'}?`,
      description:
        'Every shipment that ever routed here keeps posting to this same clearing account, so its balance still winds down correctly. It just stops being offered for a new order. You are not deleting anything.',
      confirmText: 'Close',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    archive.mutate({ id: selected.id })
  }, [selected, confirm, archive])

  if (!hasAccess(FeatureKey.accounting)) {
    return (
      <SettingsPage
        title='Payment gateways'
        description={PAGE_DESCRIPTION}
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Accounting Not Available'
          description='Upgrade your plan to keep books in Auxx.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage title='Payment gateways' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
      <MasterDetailSplit
        id='accounting-payment-gateways'
        pane={
          <PaymentGatewayEditor
            gateway={selected}
            pending={update.isPending}
            closing={archive.isPending}
            onPatch={handlePatch}
            onClose={handleClose}
            // The page itself requires `ledgerControl` (above) to render at all -
            // there is no read-only rendering of this screen to gate further.
            canControl
          />
        }
        paneTitle='Payment gateway'
        paneOpen={!!selected}
        onPaneClose={() => setSelectedId(null)}>
        <PaymentGatewaysList
          gateways={visibleRows}
          isLoading={gateways.isPending}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={(handle) => {
            setAddHandle(handle)
            setAddOpen(true)
          }}
          showArchived={showClosed}
          onShowArchivedChange={setShowClosed}
          closedCount={rows.filter((row) => row.status === 'closed').length}
        />
      </MasterDetailSplit>

      <PaymentGatewayAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(gateway) => setSelectedId(gateway.id)}
        initialHandle={addHandle}
      />

      <ConfirmDialog />
    </SettingsPage>
  )
}
