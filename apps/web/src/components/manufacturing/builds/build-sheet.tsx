// apps/web/src/components/manufacturing/builds/build-sheet.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Hammer, Layers } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { LedgerCard } from '~/components/accounting/ui/ledger-card'
import { StockMovementTreeRow } from '~/components/drawers/cards/part-inventory-card'
import { DrawerCardActionsProvider } from '~/components/drawers/drawer-card-actions'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api, type RouterOutputs } from '~/trpc/react'
import { BatchRunBuilds, BatchRunSummary } from './batch-run-section'
import { BUILD_SOURCE_LABEL } from './build-format'
import { BuildRunSection } from './build-run-section'
import { type BuildSheetFrame, useBuildSheetStore } from './build-sheet-store'

/** What `builds.get` answers for an existing build. */
export type BuildSheetData = NonNullable<RouterOutputs['builds']['get']>

/** The build sheet's drawer and frames; `BuildSheetRoot` loads it on first open. */
export function BuildSheet() {
  const frames = useBuildSheetStore((state) => state.frames)
  const back = useBuildSheetStore((state) => state.back)
  const close = useBuildSheetStore((state) => state.close)
  const [width, setWidth] = useState(560)
  // The last frame stays rendered while the drawer animates closed.
  const lastTop = useRef<BuildSheetFrame | null>(null)
  const top = frames[frames.length - 1] ?? lastTop.current
  lastTop.current = top

  return (
    <DockableDrawer
      open={frames.length > 0}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      isDocked={false}
      width={width}
      onWidthChange={setWidth}
      minWidth={400}
      maxWidth={800}
      title='Build'>
      {top && (
        <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
          <DrawerHeader
            icon={
              top.kind === 'build' ? (
                <Hammer className='size-4 text-muted-foreground' />
              ) : (
                <Layers className='size-4 text-muted-foreground' />
              )
            }
            title={<FrameTitle frame={top} />}
            onBack={frames.length > 1 ? back : undefined}
            onClose={close}
          />
          {top.kind === 'build' ? (
            <BuildFrame key={top.buildId} buildId={top.buildId} />
          ) : (
            <RunFrame key={top.runNumber} runNumber={top.runNumber} />
          )}
        </div>
      )}
    </DockableDrawer>
  )
}

function FrameTitle({ frame }: { frame: BuildSheetFrame }) {
  const build = api.builds.get.useQuery(
    { buildId: frame.kind === 'build' ? frame.buildId : '' },
    { enabled: frame.kind === 'build', retry: false }
  )
  const label = frame.kind === 'run' ? `Run ${frame.runNumber}` : (build.data?.number ?? 'Build')
  return <span className='font-medium'>{label}</span>
}

function BuildFrame({ buildId }: { buildId: string }) {
  const build = api.builds.get.useQuery({ buildId }, { retry: false })
  const { can } = useAccess()

  if (build.isPending) {
    return (
      <div className='space-y-3 p-4'>
        <Skeleton className='h-6 w-40' />
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }
  if (!build.data) {
    return <EmptySection title='This build could not be found' className='m-4' />
  }

  const data = build.data
  return (
    <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
      <BuildRunSection build={data} canManage={can(PermissionKey.mrpManage)} />
      <BuildDetailsSection build={data} canManage={can(PermissionKey.mrpManage)} />
      <BuildMovementsSection build={data} />
      {data.batchRun != null && (
        <Section title='Batch run' icon={<Layers className='size-4' />}>
          <BatchRunSummary runNumber={data.batchRun} showBuildsLink />
        </Section>
      )}
      {can(PermissionKey.ledgerView) && (
        <CardSection title='Ledger'>
          <LedgerCard entityInstanceId={data.buildId} sourceKind='build' />
        </CardSection>
      )}
    </ScrollArea>
  )
}

function RunFrame({ runNumber }: { runNumber: number }) {
  return (
    <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
      <Section title='Run' icon={<Layers className='size-4' />} collapsible={false}>
        <BatchRunSummary runNumber={runNumber} />
      </Section>
      <Section title='Builds' icon={<Hammer className='size-4' />} collapsible={false}>
        <BatchRunBuilds runNumber={runNumber} />
      </Section>
    </ScrollArea>
  )
}

/** A `Section` whose header slot a drawer card can portal its actions into. */
function CardSection({ title, children }: { title: string; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <Section title={title} actions={<div ref={setSlot} className='flex items-center' />}>
      <DrawerCardActionsProvider value={slot}>{children}</DrawerCardActionsProvider>
    </Section>
  )
}

function BuildDetailsSection({ build, canManage }: { build: BuildSheetData; canManage: boolean }) {
  const partDefId = useResourceProperty('part', 'id')
  const orderDefId = useResourceProperty('order', 'id')
  const { getSetting } = useSettings({})
  const timeZone = (getSetting('accounting.bookTimeZone') as string | null) ?? undefined
  const close = useBuildSheetStore((state) => state.close)

  const day = (value: Date | null) =>
    value ? value.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone }) : '—'

  return (
    <Section title='Details'>
      <FieldPanel className='p-0' orientation='horizontal' defaultLabelWidth={140}>
        <FieldPanelRow title='Part' type={BaseType.RELATION} showIcon>
          {/* Navigating to the part leaves the sheet behind; close it with the click. */}
          <span onClickCapture={close} className='flex min-w-0 px-2 py-1'>
            <RecordBadge
              recordId={partDefId ? toRecordId(partDefId, build.partId) : null}
              label={build.partName ?? undefined}
              link
            />
          </span>
        </FieldPanelRow>
        <FieldPanelRow title='Source' type={BaseType.ENUM} showIcon>
          <DetailText>{BUILD_SOURCE_LABEL[build.source]}</DetailText>
        </FieldPanelRow>
        {build.orderId && (
          <FieldPanelRow title='Order' type={BaseType.RELATION} showIcon>
            <span onClickCapture={close} className='flex min-w-0 px-2 py-1'>
              <RecordBadge
                recordId={orderDefId ? toRecordId(orderDefId, build.orderId) : null}
                label={build.orderName ?? undefined}
                link
              />
            </span>
          </FieldPanelRow>
        )}
        <FieldPanelRow title='Started' type={BaseType.DATE} showIcon>
          <DetailText>{day(build.startedAt)}</DetailText>
        </FieldPanelRow>
        <FieldPanelRow title='Completed' type={BaseType.DATE} showIcon>
          <DetailText>{day(build.completedAt)}</DetailText>
        </FieldPanelRow>
        <FieldPanelRow title='Posted' type={BaseType.DATE} showIcon>
          <DetailText>{day(build.postedAt)}</DetailText>
        </FieldPanelRow>
        {(build.periodStart || build.periodEnd) && (
          <FieldPanelRow title='Period' type={BaseType.DATE} showIcon>
            {/* `periodEnd` is exclusive. */}
            <DetailText>
              {day(build.periodStart)} to before {day(build.periodEnd)}
            </DetailText>
          </FieldPanelRow>
        )}
        <BuildNotesRow build={build} canManage={canManage} />
      </FieldPanel>
    </Section>
  )
}

function DetailText({ children }: { children: ReactNode }) {
  return <span className='block truncate px-2 py-1 text-sm'>{children}</span>
}

function BuildNotesRow({ build, canManage }: { build: BuildSheetData; canManage: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const utils = api.useUtils()
  const updateNotes = api.builds.updateNotes.useMutation({
    onSuccess: async () => {
      setDraft(null)
      await utils.builds.get.invalidate({ buildId: build.buildId })
    },
  })
  const value = draft ?? build.notes ?? ''
  const dirty = draft !== null && draft !== (build.notes ?? '')

  const save = () => {
    if (!dirty) return
    updateNotes.mutate({ buildId: build.buildId, notes: draft || null })
  }

  return (
    <FieldPanelRow
      title='Notes'
      type={BaseType.STRING}
      showIcon
      validationError={updateNotes.error?.message}>
      {canManage ? (
        <div
          className='w-full'
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) save()
          }}>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={value}
            onChange={(next) => setDraft((next as string) ?? '')}
            placeholder='Add a note'
            disabled={updateNotes.isPending}
          />
        </div>
      ) : (
        <DetailText>{build.notes || '—'}</DetailText>
      )}
    </FieldPanelRow>
  )
}

function BuildMovementsSection({ build }: { build: BuildSheetData }) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  return (
    <Section title={`Movements (${build.movements.length})`}>
      {build.movements.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          title={
            build.status === 'completed' ? 'No stock movements' : 'Nothing moves until completion'
          }
        />
      ) : (
        <TreeRowList
          items={build.movements}
          getKey={(movement) => movement.id}
          renderRow={(movement) => (
            <StockMovementTreeRow
              movement={movement}
              currencyCode={currencyCode}
              depth={0}
              note={movement.partName ?? movement.partId}
            />
          )}
        />
      )}
    </Section>
  )
}
