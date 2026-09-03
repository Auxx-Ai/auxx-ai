// apps/web/src/components/data-connectors/ui/connector-catalog-update-dialog.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { ToggleGroup, ToggleGroupItem } from '@auxx/ui/components/toggle-group'
import { useEffect, useMemo, useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'

type CatalogUpdate = RouterOutputs['dataConnector']['catalogUpdate']
type Entry = CatalogUpdate['entries'][number]
type Change = Entry['change']
type BindingSummary = Extract<Change, { kind: 'binding' }>['before']

/** `v1.3.0` for a production deployment, the build date for a development one. */
export function catalogDeploymentLabel(
  deployment: CatalogUpdate['to'] | CatalogUpdate['from']
): string {
  if (!deployment) return 'unknown version'
  if (deployment.version) return `v${deployment.version}`
  return `dev build ${new Date(deployment.createdAt).toLocaleDateString()}`
}

function roleWord(role: NonNullable<BindingSummary>['role']): string | null {
  if (role === 'match') return 'match on'
  if (role === 'match-exclusive') return 'exclusive match on'
  if (role === 'externalId') return 'external id'
  return null
}

/** One line, in words, for what a binding change does (plan section 6). */
function describeBinding(change: Extract<Change, { kind: 'binding' }>): string {
  const { targetLabel, before, after } = change
  if (change.op === 'add' && after) {
    const parts = [
      after.connectionMetaKey
        ? `new binding from connection ${after.connectionMetaKey}`
        : `new binding from ${after.sourcePath ?? 'source'}`,
    ]
    const role = roleWord(after.role)
    if (role) parts.push(role)
    if (after.mergeStrategy !== 'overwrite') parts.push(after.mergeStrategy)
    return `${targetLabel}: ${parts.join(', ')}`
  }
  if (change.op === 'remove') return `${targetLabel}: binding removed`
  if (!before || !after) return `${targetLabel}: updated`
  const parts: string[] = []
  if (before.role !== after.role) {
    const role = roleWord(after.role)
    parts.push(role ?? `${roleWord(before.role) ?? 'match'} off`)
  }
  if (before.mergeStrategy !== after.mergeStrategy) {
    parts.push(`${before.mergeStrategy} to ${after.mergeStrategy}`)
  }
  if (before.sourcePath !== after.sourcePath) {
    parts.push(`from ${before.sourcePath ?? 'connection'} to ${after.sourcePath ?? 'connection'}`)
  }
  if (before.connectionMetaKey !== after.connectionMetaKey) parts.push('connection value changed')
  return `${targetLabel}: ${parts.length > 0 ? parts.join(', ') : 'updated'}`
}

function describeChange(change: Change): string {
  switch (change.kind) {
    case 'stream':
      if (change.op === 'add') {
        return `new stream with ${change.mappingCount} ${change.mappingCount === 1 ? 'mapping' : 'mappings'}`
      }
      if (change.op === 'remove') return 'stream removed'
      return change.fields
        .map((f) =>
          f === 'syncMode'
            ? `${change.before.syncMode} to ${change.after.syncMode}`
            : f === 'webhookTrigger'
              ? 'webhook steering updated'
              : 'source schema refreshed'
        )
        .join(', ')
    case 'mapping':
      if (change.op === 'add') {
        return `${change.target}: new mapping${change.rootPath ? ` at ${change.rootPath}` : ''}`
      }
      if (change.op === 'remove') return `${change.target}: mapping removed`
      return `${change.target}: relationship edge updated`
    case 'binding':
      return describeBinding(change)
  }
}

function impactLabel(entry: Entry): string | null {
  const stream = entry.change.streamKey
  if (entry.impact.level === 'rebind') return `re-links ${stream}`
  if (entry.impact.level === 'rebackfill') return `re-backfills ${stream}`
  return null
}

interface ConnectorCatalogUpdateDialogProps {
  connectorId: string
  connectorName: string
  update: CatalogUpdate
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful apply, before the dialog closes. */
  onApplied: () => void
}

/**
 * The "Update available" diff (plans/money/tasks/41 section 6): what the app's new
 * connector definition changes, grouped by stream, each line in words with its
 * re-sync impact. A line the merchant edited by hand is a conflict with a keep-mine /
 * use-the-app's toggle, defaulting to keep mine. Apply runs the accepted lines through
 * the existing mapping mutations; the re-sync banner then takes over on the page.
 */
export function ConnectorCatalogUpdateDialog({
  connectorId,
  connectorName,
  update,
  open,
  onOpenChange,
  onApplied,
}: ConnectorCatalogUpdateDialogProps) {
  // Conflicts the merchant flipped to the app's version. Reset on every open so a
  // reopened dialog starts from keep-mine again.
  const [takeApp, setTakeApp] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (open) setTakeApp(new Set())
  }, [open])

  const apply = api.dataConnector.applyCatalogUpdate.useMutation()

  const groups = useMemo(() => {
    const byStream = new Map<string, Entry[]>()
    for (const entry of update.entries) {
      const list = byStream.get(entry.change.streamKey) ?? []
      list.push(entry)
      byStream.set(entry.change.streamKey, list)
    }
    return [...byStream.entries()]
  }, [update.entries])

  const conflictCount = update.entries.filter((e) => e.conflict).length
  const toLabel = catalogDeploymentLabel(update.to)

  const handleApply = async () => {
    const entryIds = update.entries.filter((e) => !e.conflict || takeApp.has(e.id)).map((e) => e.id)
    try {
      await apply.mutateAsync({ id: connectorId, entryIds })
      onApplied()
      onOpenChange(false)
    } catch (error) {
      toastError({
        title: 'Could not update the connector',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Update connector'
          description='Apply the changes the app made to this connector definition.'
          crumbs={[{ label: connectorName }, { label: `Update to ${toLabel}` }]}
        />
        <DialogNavPages value='diff'>
          <DialogNavPage value='diff' size='lg'>
            <div className='flex flex-col gap-4 p-4'>
              <p className='text-muted-foreground text-sm'>
                {update.entries.length === 0
                  ? `The app changed its connector definition in ways your streams and mappings do not carry. Marking the connector up to date records ${toLabel} as its definition.`
                  : `The app's ${toLabel} changes the streams and mappings below. Your own edits are kept unless you choose the app's version.`}
              </p>
              {conflictCount > 0 && (
                <p className='text-muted-foreground text-xs'>
                  {conflictCount === 1
                    ? 'One line you edited by hand also changed in the app. It keeps your version unless you switch it.'
                    : `${conflictCount} lines you edited by hand also changed in the app. They keep your version unless you switch them.`}
                </p>
              )}
              {groups.map(([streamKey, entries]) => (
                <section key={streamKey} className='flex flex-col gap-1'>
                  <h3 className='font-medium text-sm'>{streamKey}</h3>
                  <ul className='flex flex-col divide-y rounded-md border'>
                    {entries.map((entry) => {
                      const impact = impactLabel(entry)
                      const takingApp = takeApp.has(entry.id)
                      return (
                        <li
                          key={entry.id}
                          className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'>
                          <span className='min-w-0 flex-1'>
                            {entry.change.kind === 'binding' && (
                              <span className='text-muted-foreground'>
                                {entry.change.mappingTarget}
                                {' / '}
                              </span>
                            )}
                            {describeChange(entry.change)}
                          </span>
                          {impact && (
                            <Badge
                              variant={entry.impact.level === 'rebind' ? 'amber' : 'blue'}
                              size='sm'
                              className='shrink-0'>
                              {impact}
                            </Badge>
                          )}
                          {entry.conflict && (
                            <ToggleGroup
                              type='single'
                              size='sm'
                              value={takingApp ? 'app' : 'mine'}
                              onValueChange={(value) => {
                                if (!value) return
                                setTakeApp((prev) => {
                                  const next = new Set(prev)
                                  if (value === 'app') next.add(entry.id)
                                  else next.delete(entry.id)
                                  return next
                                })
                              }}
                              aria-label='Which version to keep'
                              className='shrink-0'>
                              <ToggleGroupItem value='mine'>Keep mine</ToggleGroupItem>
                              <ToggleGroupItem value='app'>Use the app&apos;s</ToggleGroupItem>
                            </ToggleGroup>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
            <DialogFooter className='border-t px-4 py-3'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => onOpenChange(false)}
                disabled={apply.isPending}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button
                onClick={() => void handleApply()}
                variant='outline'
                size='sm'
                loading={apply.isPending}
                loadingText='Updating...'
                data-dialog-submit>
                {update.entries.length === 0 ? 'Mark up to date' : 'Apply update'}{' '}
                <KbdSubmit variant='outline' size='sm' />
              </Button>
            </DialogFooter>
          </DialogNavPage>
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}
