// apps/web/src/components/inventory-bridge/ui/inventory-sources-section.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { type FieldReference, isResourceFieldId, parseResourceFieldId } from '@auxx/types/field'
import { ListCard, renderBadgeChips } from '@auxx/ui/components/list-card'
import { Boxes, Package, Trash } from 'lucide-react'
import { SettingsSection } from '~/components/global/settings-page'
import { ResourceFieldPicker } from '~/components/pickers/resource-field-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { useInventorySources } from '../hooks/use-inventory-sources'

/**
 * Org-level inventory sources: the `(def, quantity field)` an inventory-source record exposes,
 * each backed by ONE managed deduction rule (shown, locked, in Record rules). Admins add a
 * source via the resource → field picker (NUMBER fields only); every part on that source links
 * to a record without re-picking the def. Configuring is admin-only; the picker + remove hide
 * for members.
 */
export function InventorySourcesSection() {
  const { isAdminOrOwner } = useUser({})
  const { sources, provision, remove } = useInventorySources()
  const [confirm, ConfirmDialog] = useConfirm()

  const handleSelect = (ref: FieldReference, field: ResourceField) => {
    // A single field selection emits a scoped `${entityDefinitionId}:${fieldId}` ResourceFieldId.
    if (typeof ref !== 'string' || !isResourceFieldId(ref)) return
    const { entityDefinitionId } = parseResourceFieldId(ref)
    provision.mutate({ sourceDefId: entityDefinitionId, quantityFieldId: field.id })
  }

  const handleRemove = async (sourceDefId: string, label: string) => {
    const ok = await confirm({
      title: 'Remove inventory source?',
      description: `Stop deducting linked parts from "${label}" changes. Existing links stay but no longer deduct.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) remove.mutate({ sourceDefId })
  }

  const rows = sources.data ?? []

  return (
    <SettingsSection
      icon={Boxes}
      title='Inventory sources'
      description='A synced NUMBER field whose decrease deducts the linked part (and explodes its BOM).'
      action={
        isAdminOrOwner ? (
          <ResourceFieldPicker
            onSelect={handleSelect}
            entityDefinedOnly
            disableDrillDown
            emptyLabel='Add source'
            resourceSearchPlaceholder='Pick a synced resource…'
            fieldSearchPlaceholder='Pick a quantity field…'
            filterField={(field) => field.fieldType === 'NUMBER'}
          />
        ) : undefined
      }>
      <div className='@container'>
        <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
          {sources.isLoading &&
            [...Array(2)].map((_, i) => (
              <ListCard key={`skeleton-${i}`} loading descriptionLines={0} />
            ))}

          {!sources.isLoading &&
            rows.map((source) => (
              <ListCard
                key={source.sourceDefId}
                title={source.defLabel}
                subtitle='Inventory source'
                description={`Deduct linked part when ${source.fieldLabel} decreases`}
                icon={<Package className='size-4' />}
                headerEnd={renderBadgeChips([{ label: source.fieldLabel }])}
                menuItems={
                  isAdminOrOwner
                    ? [
                        {
                          label: 'Remove',
                          icon: <Trash />,
                          onClick: () => void handleRemove(source.sourceDefId, source.defLabel),
                          destructive: true,
                        },
                      ]
                    : undefined
                }
              />
            ))}

          {!sources.isLoading && rows.length === 0 && (
            <ListCard
              title={isAdminOrOwner ? 'Add an inventory source' : 'No inventory sources'}
              subtitle='Inventory sources'
              description={
                isAdminOrOwner
                  ? 'Point a synced quantity field at your parts to auto-deduct stock.'
                  : 'An admin can configure a synced field to auto-deduct linked parts.'
              }
              icon={<Boxes className='size-4 text-muted-foreground' />}
            />
          )}
        </div>
      </div>

      <ConfirmDialog />
    </SettingsSection>
  )
}
