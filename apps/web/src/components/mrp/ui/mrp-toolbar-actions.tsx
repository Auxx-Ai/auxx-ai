// apps/web/src/components/mrp/ui/mrp-toolbar-actions.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { format, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { ToolbarTitle } from '~/components/global/module-toolbar'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import { Tooltip } from '~/components/global/tooltip'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { type MrpRun, useMrpRun } from '../hooks/use-mrp-run'

const POLL_MS = 3000

/** A run's as-of day, "Sep 24". `asOf` is a day anchor stored at noon UTC; never format it with a time. */
export function formatMrpAsOf(run: { asOfDay: string }): string {
  return format(parseISO(run.asOfDay), 'MMM d')
}

/** When a run started on the org's wall clock, "Sep 24, 08:16": what tells two runs apart. */
export function formatMrpRunStarted(
  run: { startedAt: Date; zone: string },
  pattern = 'MMM d, HH:mm'
): string {
  return formatInTimeZone(run.startedAt, run.zone, pattern)
}

/** "as of Sep 24" for a toolbar hint; undefined while there is no run. */
export function mrpAsOfHint(run: MrpRun | null | undefined): string | undefined {
  return run ? `as of ${formatMrpAsOf(run)}` : undefined
}

/**
 * Starts a plan run and tracks it. `watch` polls `runStatus` while a run is in flight and
 * refreshes the MRP reads when it ends; only one mounted caller (the toolbar) should watch.
 */
export function useMrpRunNow({ watch = false }: { watch?: boolean } = {}) {
  const utils = api.useUtils()
  const { can } = useAccess()
  const canRun = can(PermissionKey.mrpManage)
  const status = api.mrp.runStatus.useQuery(undefined, {
    refetchInterval: (query) => (watch && query.state.data?.active ? POLL_MS : false),
  })
  const active = status.data?.active ?? false

  const runNow = api.mrp.runNow.useMutation({
    // Optimistic so polling starts at once; a run that never went active reads false on the next poll.
    onSuccess: () => utils.mrp.runStatus.setData(undefined, { active: true }),
    onError: (error) =>
      toastError({ title: 'Could not start the plan run', description: error.message }),
  })

  const wasActive = useRef(active)
  useEffect(() => {
    if (!watch) return
    if (wasActive.current && !active) {
      void utils.mrp.summary.invalidate()
      void utils.mrp.list.invalidate()
      void utils.mrp.runs.invalidate()
      void utils.mrp.partItem.invalidate()
    }
    wasActive.current = active
  }, [active, watch, utils])

  return {
    canRun,
    isRunning: active || runNow.isPending,
    start: () => runNow.mutate(),
  }
}

/** "Run now", disabled without `mrp.manage`, loading while a run is in flight. */
export function MrpRunNowButton({
  variant = 'ghost',
  className = 'h-7',
  watch = false,
}: {
  variant?: 'ghost' | 'outline'
  className?: string
  watch?: boolean
}) {
  const { canRun, isRunning, start } = useMrpRunNow({ watch })
  const button = (
    <Button
      variant={variant}
      size='sm'
      className={className}
      disabled={!canRun}
      loading={isRunning}
      loadingText='Planning...'
      onClick={start}>
      <Play />
      Run now
    </Button>
  )
  if (canRun) return button
  // A disabled button swallows pointer events, so the tooltip hangs off a wrapper.
  return (
    <Tooltip content='Running the plan needs the MRP manage permission'>
      <span>{button}</span>
    </Tooltip>
  )
}

/** The pinned-run chip and "Run now": the `right` every MRP page publishes. */
export function MrpToolbarActions() {
  const { run, isPinned, clear } = useMrpRun()
  return (
    <div className='flex items-center gap-1'>
      {isPinned && (
        <Tooltip content='Back to the latest run'>
          <Button variant='ghost' size='sm' className='h-7 text-muted-foreground' onClick={clear}>
            {run ? `Run of ${formatMrpRunStarted(run)}` : 'Pinned run'}
            <X />
          </Button>
        </Tooltip>
      )}
      <MrpRunNowButton watch />
    </div>
  )
}

/** Publishes `ToolbarTitle` and the MRP actions to the module toolbar; one call per page. */
export function useMrpToolbar(title: string, hint?: string): void {
  useRegisterModuleToolbar(
    useMemo(
      () => ({
        left: <ToolbarTitle hint={hint}>{title}</ToolbarTitle>,
        right: <MrpToolbarActions />,
      }),
      [title, hint]
    )
  )
}
