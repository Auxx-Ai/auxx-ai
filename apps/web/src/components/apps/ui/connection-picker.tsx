// apps/web/src/components/apps/ui/connection-picker.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Check, Plus, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import type { RouterOutputs } from '~/trpc/react'
import { AppWithStatusIcon } from './app-with-status-icon'
import { resolveConnectionDisplay } from './connection-display'

/** A single bindable connection as projected by `connections.list`. */
export type PickerConnection = RouterOutputs['connections']['list'][number]

/**
 * Credential families this picker can bind. `mcp` is intentionally excluded —
 * MCP creds are server-bound, not a fetch credential.
 */
export type PickerKind = 'app' | 'integration' | 'workflow'

interface ConnectionPickerProps {
  /** Currently-bound credentialId. */
  value: string | undefined
  /** Fires once per pick with the credentialId and the whole row (carries `appInstallationId`). */
  onPick: (credentialId: string, connection: PickerConnection) => void
  /** Connections to list (already fetched + filtered by the host/popover). */
  connections: PickerConnection[]
  /** When set, renders a "+ New connection" footer row. */
  onCreateNew?: () => void
  /**
   * Per-row action (reconnect OR edit) for app + platform rows; the host routes by
   * `connectionType`. Channel/integration rows get no action (managed in channel settings).
   */
  onAction?: (connection: PickerConnection) => void
  /** Platform provider catalog keyed by `providerKey` (= `Credential.type`) for label/routing. */
  providerByKey?: Map<string, { connectionType: string }>
  /** Empty-state hint shown when there are no connections to list. */
  emptyHint?: string
  /**
   * Connection ids the host considers a match for this context (e.g. a data
   * connector's expected app/provider). Matching rows lift into a "Recommended"
   * group at the top. The host derives these from its own domain hint — the
   * picker stays credential-agnostic.
   */
  preferredCredentialIds?: string[]
  /**
   * Display name of the preferred provider/app (e.g. "Gmail"). Drives the
   * recommend-but-none-exists nudge and a tailored empty state.
   */
  preferredLabel?: string
}

/**
 * Generic, credential-agnostic connection picker. Lists *any* bindable org
 * connection (app OAuth, integration, workflow API-key) grouped by family and
 * binds its `credentialId`. The cross-feature superset of `AppAccountPicker` —
 * see plans/data-connectors/claude/05b-connection-picker.md.
 */
export function ConnectionPicker({
  value,
  onPick,
  connections,
  onCreateNew,
  onAction,
  providerByKey,
  emptyHint,
  preferredCredentialIds,
  preferredLabel,
}: ConnectionPickerProps) {
  const { appInstallations } = useAppsContext()

  // Recommended rows lift to the top; the rest keep their family grouping. A
  // preferred row is excluded from Apps/keys so it never renders twice.
  const { preferred, apps, keys } = useMemo(() => {
    const preferredSet = new Set(preferredCredentialIds)
    const preferred = connections.filter((c) => preferredSet.has(c.id))
    const rest = connections.filter((c) => !preferredSet.has(c.id))
    return {
      preferred,
      apps: rest.filter((c) => c.kind === 'app'),
      keys: rest.filter((c) => c.kind === 'integration' || c.kind === 'workflow'),
    }
  }, [connections, preferredCredentialIds])

  const resolve = (c: PickerConnection) => resolveConnectionDisplay(c, appInstallations)

  const isEmpty = connections.length === 0
  // Hint exists but nothing matches it yet → point the user at "+ New connection".
  const showNoPreferredNudge = !isEmpty && !!preferredLabel && preferred.length === 0

  return (
    <Command className='w-full'>
      {!isEmpty && <CommandInput placeholder='Search connections...' />}
      <CommandList scrollAreaClassName='max-h-none'>
        {isEmpty && (
          <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
            {preferredLabel
              ? `No ${preferredLabel} connection yet — add one to authorize this connector.`
              : (emptyHint ?? 'No connections yet — add one to authorize this connector.')}
          </div>
        )}

        {showNoPreferredNudge && (
          <div className='px-3 py-2 text-xs text-muted-foreground'>
            No {preferredLabel} connection yet — add one below, or pick another.
          </div>
        )}

        {!isEmpty && <CommandEmpty>No connections found.</CommandEmpty>}

        {preferred.length > 0 && (
          <CommandGroup heading='Recommended'>
            {preferred.map((c) => (
              <ConnectionItem
                key={c.id}
                connection={c}
                selected={value === c.id}
                onSelect={() => onPick(c.id, c)}
                onAction={onAction}
                providerByKey={providerByKey}
                {...resolve(c)}
              />
            ))}
          </CommandGroup>
        )}

        {apps.length > 0 && (
          <CommandGroup heading='Apps'>
            {apps.map((c) => (
              <ConnectionItem
                key={c.id}
                connection={c}
                selected={value === c.id}
                onSelect={() => onPick(c.id, c)}
                onAction={onAction}
                providerByKey={providerByKey}
                {...resolve(c)}
              />
            ))}
          </CommandGroup>
        )}

        {keys.length > 0 && (
          <CommandGroup heading='API keys & integrations'>
            {keys.map((c) => (
              <ConnectionItem
                key={c.id}
                connection={c}
                selected={value === c.id}
                onSelect={() => onPick(c.id, c)}
                onAction={onAction}
                providerByKey={providerByKey}
                {...resolve(c)}
              />
            ))}
          </CommandGroup>
        )}

        {onCreateNew && (
          <>
            {!isEmpty && <CommandSeparator alwaysRender />}
            <CommandGroup forceMount>
              <CommandItem forceMount onSelect={onCreateNew} className='cursor-pointer h-7.5'>
                <Plus className='text-muted-foreground' />
                <span>New connection</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  )
}

function ConnectionItem({
  connection,
  selected,
  iconId,
  title,
  onSelect,
  onAction,
  providerByKey,
}: {
  connection: PickerConnection
  selected: boolean
  iconId: string
  title: string
  onSelect: () => void
  onAction?: (connection: PickerConnection) => void
  providerByKey?: Map<string, { connectionType: string }>
}) {
  const isApp = connection.kind === 'app'
  const expired = connection.status === 'expired'
  // Option A: only app + platform (workflow) rows act; channel/integration rows are bind-only.
  const actionable = !!onAction && (isApp || connection.kind === 'workflow')
  // App rows + platform OAuth rows re-authorize ("Reconnect"); platform secrets re-enter ("Edit").
  const isReconnect = isApp || providerByKey?.get(connection.type)?.connectionType === 'oauth2-code'
  const actionLabel = isReconnect ? 'Reconnect' : 'Edit'
  return (
    <CommandItem
      value={title}
      keywords={connection.type ? [connection.type] : undefined}
      onSelect={onSelect}
      className='cursor-pointer h-7.5'>
      {/* `status` ('connected' | 'expired') is a subset of AppConnectionStatus. */}
      <AppWithStatusIcon iconId={iconId} size='sm' status={connection.status} />
      <span className='truncate'>{title}</span>
      {connection.type && (
        <span className='truncate text-xs text-muted-foreground'>{connection.type}</span>
      )}
      {actionable && expired && <TriangleAlert className='size-3.5 shrink-0 text-amber-600' />}
      <div className='ml-auto flex items-center gap-1.5'>
        {selected && (
          <div className='flex size-4 items-center justify-center rounded-full border border-blue-800 bg-info'>
            <Check className='size-2.5! text-white' strokeWidth={4} />
          </div>
        )}
        {actionable && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className={
              isReconnect && expired
                ? 'h-6 px-2 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-400/10 hover:text-amber-700'
                : 'h-6 px-2'
            }
            onClick={(e) => {
              e.stopPropagation()
              onAction?.(connection)
            }}>
            {actionLabel}
          </Button>
        )}
      </div>
    </CommandItem>
  )
}
