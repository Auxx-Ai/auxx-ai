// apps/web/src/components/mrp/ui/mrp-drawer-host.tsx

'use client'

import { parseRecordId } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { EntityIcon } from '@auxx/ui/components/icons'
import { NavStack, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { DrawerRecordFrame } from '~/components/drawers/base-entity-drawer'
import { Tooltip } from '~/components/global/tooltip'
import {
  DrawerTabParamProvider,
  RecordStackProvider,
  useRecordPeekStack,
} from '~/components/records/record-drill-panels'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { toRecordId, useResource, useResourceProperty } from '~/components/resources'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import {
  MRP_RECORD_TAB_PARAM,
  type MrpDrawerDock,
  useMrpDrawer,
  useMrpDrawerDock,
  useRegisterMrpDrawer,
} from '../hooks/use-mrp-drawer'

/** The MRP segment's one docked drawer (07 D32): the `?part=` record at its Planning tab. Render once per list page. */
export function MrpDrawerHost() {
  const { partId, close } = useMrpDrawer()
  const dock = useMrpDrawerDock()
  const partDefId = useResourceProperty('part', 'id')
  const baseFrame = partId && partDefId ? (toRecordId(partDefId, partId) as RecordId) : null
  const { isDocked } = dock

  const drawer = useMemo(
    () => (
      <DrawerTabParamProvider value={MRP_RECORD_TAB_PARAM}>
        <MrpDrawerFrames baseFrame={baseFrame} onClose={close} dock={dock} />
      </DrawerTabParamProvider>
    ),
    [baseFrame, close, dock]
  )

  useRegisterMrpDrawer(drawer, !!baseFrame, dock)

  return !isDocked && baseFrame ? drawer : null
}

function MrpDrawerFrames({
  baseFrame,
  onClose,
  dock,
}: {
  baseFrame: RecordId | null
  onClose: () => void
  dock: MrpDrawerDock
}) {
  const peek = useRecordPeekStack<RecordId>(baseFrame)
  const { frames, top, depth, push } = peek
  const router = useRouter()
  const { resource } = useResource(top ? parseRecordId(top).entityDefinitionId : null)
  const recordLink = useRecordLink(top)

  const handleClose = useCallback(() => {
    peek.clear()
    onClose()
  }, [onClose, peek.clear])

  // The drawer's own close paths (outside click, swipe, Escape) bypass `handleClose`.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) handleClose()
    },
    [handleClose]
  )

  const handleFrameStackChange = useCallback(
    (next: string[]) => {
      if (next.length < frames.length) peek.pop()
    },
    [frames.length, peek.pop]
  )

  const stackCtx = useMemo(() => ({ push, depth }), [push, depth])

  return (
    <DockableDrawer
      open={!!baseFrame}
      onOpenChange={handleOpenChange}
      isDocked={dock.isDocked}
      width={dock.width}
      onWidthChange={dock.onWidthChange}
      minWidth={380}
      maxWidth={800}
      title={resource?.label ?? 'Part'}>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={
            <EntityIcon
              iconId={resource?.icon || 'circle'}
              color={resource?.color || 'gray'}
              className='size-6'
            />
          }
          title={<span className='font-medium'>{resource?.label ?? 'Part'}</span>}
          actions={
            recordLink && (
              <Tooltip content='Open full page'>
                <Button variant='ghost' size='icon-xs' onClick={() => router.push(recordLink)}>
                  <ExternalLink />
                </Button>
              </Tooltip>
            )
          }
          onBack={depth <= 1 ? undefined : peek.pop}
          onClose={handleClose}
        />

        {/* The base panel is keyed by position, so a row click swaps the part in place. */}
        <RecordStackProvider value={stackCtx}>
          <NavStack
            stack={frames.map((frame, i) => (i === 0 ? '0:base' : `${i}:${frame}`))}
            onStackChange={handleFrameStackChange}
            className='flex min-h-0 flex-1 flex-col'>
            <NavStackPanels className='min-h-0 flex-1'>
              {frames.map((frame, i) => {
                const value = i === 0 ? '0:base' : `${i}:${frame}`
                return (
                  <NavStackPanel key={value} value={value} className='flex h-full flex-col'>
                    <MrpRecordFrame recordId={frame} isBase={i === 0} />
                  </NavStackPanel>
                )
              })}
            </NavStackPanels>
          </NavStack>
        </RecordStackProvider>
      </div>
    </DockableDrawer>
  )
}

function MrpRecordFrame({ recordId, isBase }: { recordId: RecordId; isBase: boolean }) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const readOnly = useRecordDrawerReadOnly(entityDefinitionId, entityInstanceId)
  return <DrawerRecordFrame recordId={recordId} isBase={isBase} readOnly={readOnly} />
}
