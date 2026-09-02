// apps/web/src/components/apps/ui/app-install-entities-action.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Database } from 'lucide-react'
import { useState } from 'react'
import { EntityTemplateDialog } from '~/components/custom-fields/ui/entity-template-dialog'
import { api } from '~/trpc/react'

interface AppInstallEntitiesActionProps {
  appSlug: string
}

/**
 * "Install entities" action for an installed app's detail page
 * (app-fields-and-entities-plan §4.1 item 3). The marketplace install button
 * (`AppInstallButton`) is a one-click mutation with no consent step, so an app's
 * declared entities (`catalog.entities`, `defineEntity`) otherwise only install
 * lazily at connector setup. This reuses the same `EntityTemplateDialog` a
 * connector wizard uses, preselected to this app's projected entity templates
 * (`app:<slug>:<key>`) and stamped with this app's `installContext` so created
 * defs/fields are app-owned. Renders nothing once the app declares no entities.
 */
export function AppInstallEntitiesAction({ appSlug }: AppInstallEntitiesActionProps) {
  const [open, setOpen] = useState(false)
  const { data } = api.apps.listInstallableEntities.useQuery({ appSlug })

  if (!data || data.templateIds.length === 0) return null

  return (
    <>
      <Button variant='outline' size='sm' className='h-6 text-xs' onClick={() => setOpen(true)}>
        <Database className='size-3' />
        Install entities
      </Button>
      <EntityTemplateDialog
        open={open}
        onOpenChange={setOpen}
        preSelectedTemplateIds={data.templateIds}
        installContext={{ appInstallationId: data.appInstallationId, appSlug: data.appSlug }}
      />
    </>
  )
}
