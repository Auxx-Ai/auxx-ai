// apps/web/src/components/kbar/contextual/record-command-actions.tsx
'use client'

import { CommandAction } from './command-action'
import { useCommandScope } from './select-contextual'
import { useRecordActions } from './use-record-actions'

interface RecordCommandActionsProps {
  /** Override the scope's record id (defaults to the active `useCommandScope()`). */
  recordId?: string
  /** Override the scope's display name. */
  displayName?: string
}

/**
 * The common record-action row set, packaged so any record surface can drop one
 * component instead of re-declaring rows. Reads the active scope via
 * `useCommandScope()` (record scopes should outrank table scopes by priority);
 * the `perform`s come from the shared {@link useRecordActions} helper so the
 * search-flow page and the mounted-surface flow can't drift.
 *
 * Mount inside a `<CommandContext kind="record" …>` so the rows inherit its
 * group heading.
 */
export function RecordCommandActions({
  recordId: recordIdProp,
  displayName: displayNameProp,
}: RecordCommandActionsProps = {}): React.ReactNode {
  const scope = useCommandScope()
  const recordId = recordIdProp ?? scope?.recordId ?? ''
  const displayName = displayNameProp ?? scope?.label ?? ''

  const handlers = useRecordActions(recordId, displayName)

  if (!recordId) return null

  return (
    <>
      <CommandAction
        label='Open record'
        icon='external-link'
        keywords='open view go'
        priority={10}
        perform={handlers.open}
      />
      {handlers.absoluteHref && (
        <CommandAction
          label='Open in new tab'
          icon='share'
          keywords='open new tab window'
          priority={9}
          perform={handlers.openNewTab}
        />
      )}
      <CommandAction
        label='Create task'
        icon='list-checks'
        keywords='task todo'
        priority={8}
        perform={handlers.createTask}
      />
      <CommandAction
        label='Ask Kopilot about this'
        icon='sparkles'
        keywords='kopilot ai ask summarize'
        priority={7}
        perform={handlers.askKopilot}
      />
      <CommandAction
        label='Copy name'
        icon='copy'
        keywords='copy name clipboard'
        priority={6}
        perform={handlers.copyName}
      />
      {handlers.absoluteHref && (
        <CommandAction
          label='Copy link'
          icon='link-2'
          keywords='copy link url clipboard'
          priority={5}
          perform={handlers.copyLink}
        />
      )}
    </>
  )
}
