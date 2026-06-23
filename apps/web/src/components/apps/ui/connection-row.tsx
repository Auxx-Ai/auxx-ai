// apps/web/src/components/apps/ui/connection-row.tsx

'use client'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import { Check, CheckCircle, Clock, X, XCircle } from 'lucide-react'
import { type ReactNode, useState } from 'react'

/** Drives the default leading status icon. */
export type ConnectionStatus = 'connected' | 'expired' | 'disconnected'

export interface ConnectionRowActionControls {
  /** Put the row into inline-rename mode. Wire this to the caller's "Rename" menu item. */
  beginRename: () => void
}

interface ConnectionRowProps {
  /** Primary line (account/connection name, or any node). */
  title: ReactNode
  /** Secondary line under the title (status text, owner, expiry…). */
  subtitle?: ReactNode
  /** Status for the default leading icon. Ignored when `statusIcon` is provided. */
  status?: ConnectionStatus
  /** Override the leading icon entirely (e.g. an app avatar). */
  statusIcon?: ReactNode
  /**
   * Right-hand slot — settings-dialog passes its dropdown, picker passes nothing
   * (uses `onSelect`). Receives `{ beginRename }` so the caller's menu can flip
   * the row into edit mode without owning any rename state.
   */
  actions?: (controls: ConnectionRowActionControls) => ReactNode
  /** When provided, the row becomes selectable (button) and shows a check when `selected`. */
  onSelect?: () => void
  selected?: boolean
  /**
   * Commit handler for the inline rename form. Return `false` (or a Promise
   * resolving to `false`) to keep the row in edit mode — e.g. on validation
   * failure. Anything else closes the editor.
   */
  onRename?: (label: string) => boolean | Promise<boolean>
  /** Seed value for the inline rename editor (the current label). */
  renameValue?: string
}

/**
 * One row in a connection list. Generic over its content: pass `title`/`subtitle`
 * and either a `status` (default icon) or a custom `statusIcon`. Used by
 * `AppConnections` (workflow / installed-apps) and the MCP server detail.
 * Owns its inline-rename UI; the caller only provides the commit handler.
 * See plans/kopilot/apps/app-settings-dialog-refactor.md §5.1.
 */
export function ConnectionRow({
  title,
  subtitle,
  status,
  statusIcon,
  actions,
  onSelect,
  selected,
  onRename,
  renameValue = '',
}: ConnectionRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState('')

  const beginRename = () => {
    setEditLabel(renameValue)
    setIsEditing(true)
  }

  const commitRename = async () => {
    if (!onRename) {
      setIsEditing(false)
      return
    }
    const ok = await onRename(editLabel)
    if (ok !== false) setIsEditing(false)
  }

  const body = (
    <>
      <div className='flex items-center gap-3 min-w-0'>
        {statusIcon ?? <StatusIcon status={status ?? 'disconnected'} />}
        <div className='min-w-0'>
          {isEditing ? (
            <InlineRenameForm
              value={editLabel}
              onChange={setEditLabel}
              onCommit={commitRename}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <div className='text-sm font-medium truncate'>{title}</div>
          )}
          {subtitle && <div className='text-xs text-muted-foreground truncate'>{subtitle}</div>}
        </div>
      </div>
      <div className='flex items-center gap-2 shrink-0'>
        {selected && <Check className='size-4 text-foreground' />}
        {actions?.({ beginRename })}
      </div>
    </>
  )

  if (onSelect) {
    return (
      <button
        type='button'
        onClick={onSelect}
        className={cn(
          'flex w-full items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 text-left',
          selected && 'bg-primary-50'
        )}>
        {body}
      </button>
    )
  }

  return (
    <div className='flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0'>{body}</div>
  )
}

function StatusIcon({ status }: { status: ConnectionStatus }) {
  if (status === 'connected') return <CheckCircle className='h-4 w-4 text-green-500 shrink-0' />
  if (status === 'expired') return <Clock className='h-4 w-4 text-yellow-500 shrink-0' />
  return <XCircle className='h-4 w-4 text-gray-400 shrink-0' />
}

function InlineRenameForm({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onCommit()
      }}>
      <InputGroup size='sm'>
        <InputGroupInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className='h-7 w-48 text-sm'
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
        <InputGroupAddon align='inline-end' className='gap-0.5'>
          <InputGroupButton
            type='submit'
            size='icon-xs'
            aria-label='Save'
            title='Save'
            disabled={!value.trim()}>
            <Check />
          </InputGroupButton>
          <InputGroupButton
            type='button'
            size='icon-xs'
            aria-label='Cancel'
            title='Cancel'
            onClick={onCancel}>
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
