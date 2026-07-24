// apps/web/src/components/dashboard/ui/create-dashboard-button.tsx
'use client'

// "New dashboard" button owning its own DashboardFormDialog (create mode). Used
// in the page header and the empty state so both entry points share one wiring.

import { Button } from '@auxx/ui/components/button'
import { Kbd } from '@auxx/ui/components/kbd'
import { useHotkey } from '@tanstack/react-hotkeys'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { CommandAction, CommandContext } from '~/components/kbar/contextual'
import { useCommandPaletteStore } from '~/components/kbar/store'
import { useAccess } from '~/providers/capabilities-provider'
import { DashboardFormDialog } from './dashboard-form-dialog'

/**
 * @param registerShortcut - When true, binds the page-local `N` shortcut, shows
 *   the `<Kbd>` hint, and contributes the "New dashboard" cmd+k action. Set only
 *   on the header instance so the empty-state copy doesn't double-register.
 */
export function CreateDashboardButton({
  size = 'sm',
  registerShortcut = false,
}: {
  size?: 'sm' | 'default'
  registerShortcut?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { can } = useAccess()

  useHotkey('N', () => setOpen(true), { enabled: registerShortcut })

  // Creating a dashboard requires the `dashboards` Full rung (`dashboards.manage`);
  // Read members can browse shared dashboards but not create their own.
  if (!can('dashboards.manage')) {
    return null
  }

  return (
    <>
      {registerShortcut && (
        <CommandContext kind='page' label='Dashboards'>
          <CommandAction
            label='New dashboard'
            icon='plus'
            keywords='new dashboard create add'
            shortcut={['N']}
            priority={10}
            perform={() => {
              useCommandPaletteStore.getState().close()
              setOpen(true)
            }}
          />
        </CommandContext>
      )}
      <Button size={size} onClick={() => setOpen(true)}>
        <Plus />
        New dashboard
        {registerShortcut && (
          <Kbd variant='default' size='sm'>
            N
          </Kbd>
        )}
      </Button>
      <DashboardFormDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
