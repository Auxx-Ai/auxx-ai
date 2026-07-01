// apps/web/src/components/drawers/actions/link-inventory-source-action.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { PackagePlus } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { LinkInventorySourceDialog } from '~/components/manufacturing/parts/link-inventory-source-dialog'
import { api } from '~/trpc/react'
import type { DrawerActionProps } from '../drawer-action-registry'

/**
 * Part header action: open the "Link inventory source" dialog. Hidden unless the org has at
 * least one configured inventory source (e.g. a Shopify connector) — no point offering it
 * otherwise.
 */
export function LinkInventorySourceAction({ entityInstanceId }: DrawerActionProps) {
  const { data: sources } = api.inventoryBridge.sources.useQuery()
  if (!sources || sources.length === 0) return null

  return (
    <LinkInventorySourceDialog partId={entityInstanceId}>
      <Tooltip content='Link inventory source' allowInteraction>
        <Button variant='ghost' size='icon-xs'>
          <PackagePlus />
        </Button>
      </Tooltip>
    </LinkInventorySourceDialog>
  )
}
