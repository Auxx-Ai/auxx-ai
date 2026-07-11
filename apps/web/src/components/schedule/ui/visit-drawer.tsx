// apps/web/src/components/schedule/ui/visit-drawer.tsx
//
// Desktop visit detail drawer — the 08-worker-surface.md §3 "docked panel later" build call.
// Standard drawer shell (`file-detail-drawer.tsx` pattern): `DockableDrawer` + `DrawerHeader`
// with the dock toggle, hosting the shared `VisitDetailContent`. Reads dock state itself; the
// Schedule page routes it into `MainPageContent`'s `dockedPanels` when docked, or renders it
// as the overlay drawer when not.

'use client'

import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ClipboardList, Expand } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { VisitDetailContent } from './visit-detail-content'

interface VisitDrawerProps {
  visitId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VisitDrawer({ visitId, open, onOpenChange }: VisitDrawerProps) {
  const router = useRouter()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={400}
      maxWidth={800}
      title='Visit'>
      <DrawerHeader
        icon={<ClipboardList className='size-4 text-muted-foreground' />}
        title='Visit'
        onClose={() => onOpenChange(false)}
        actions={
          <>
            {visitId && (
              <Tooltip content='Open full page'>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  className='rounded-full'
                  onClick={() => router.push(`/app/schedule/visit/${visitId}`)}>
                  <Expand />
                </Button>
              </Tooltip>
            )}
            <DockToggleButton />
          </>
        }
      />
      <div className='flex-1 min-h-0'>{visitId && <VisitDetailContent visitId={visitId} />}</div>
    </DockableDrawer>
  )
}
