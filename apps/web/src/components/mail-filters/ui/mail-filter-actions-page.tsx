// apps/web/src/components/mail-filters/ui/mail-filter-actions-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import {
  describeMailFilterAction,
  MAIL_FILTER_ACTION_LABELS,
  type MailFilterAction,
  type MailFilterNameResolver,
} from '@auxx/lib/mail-filters/client'
import { type ActorId, isActorId, toActorId } from '@auxx/types/actor'
import type { SelectOption } from '@auxx/types/custom-field'
import {
  ArrowRightLeft,
  Bot,
  CheckCheck,
  MailOpen,
  Tag,
  TagIcon,
  UserPlus,
  Workflow,
  ZapOff,
} from 'lucide-react'
import { type ComponentType, type ReactNode, useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  firstSelectValue,
  RULE_ACTION_TRIGGER_PROPS,
  type RuleActionCatalogEntry,
  RuleActionsPage,
} from '~/components/rules/ui/rule-actions-page'
import { api } from '~/trpc/react'

type ActionOfType<T extends MailFilterAction['type']> = Extract<MailFilterAction, { type: T }>

/** `set-status` choices, matching the mail views' vocabulary ("done", not "archived"). */
const STATUS_OPTIONS: SelectOption[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ARCHIVED', label: 'Done' },
  { value: 'TRASH', label: 'Trash' },
  { value: 'SPAM', label: 'Spam' },
]

/** `set-read` choices — a two-value select reads better than a bare checkbox here. */
const READ_OPTIONS: SelectOption[] = [
  { value: 'read', label: 'Mark as read' },
  { value: 'unread', label: 'Mark as unread' },
]

/**
 * An inline note inside the shared `FieldPanel`. Used for the two
 * visibility-widening actions (invariant 8 / §5.1), which are stated in the form
 * body rather than in a tooltip: "this hands the conversation to other people"
 * is not a footnote.
 */
function ActionNote({
  children,
  tone = 'muted',
}: {
  children: ReactNode
  tone?: 'muted' | 'warn'
}) {
  return (
    <p
      className={
        tone === 'warn'
          ? 'px-2 py-2 text-xs text-amber-700 dark:text-amber-400'
          : 'px-2 py-2 text-xs text-muted-foreground'
      }>
      {children}
    </p>
  )
}

/**
 * Builds one catalog entry, narrowing the action to its own variant for the
 * callbacks — the shared editor only ever hands an entry an action whose `type`
 * matches it (the `record-rule-actions-page` helper).
 */
function actionEntry<T extends MailFilterAction['type']>(
  type: T,
  config: {
    icon: ComponentType<{ className?: string }>
    description?: string
    makeDefault: () => ActionOfType<T>
    validate: (action: ActionOfType<T>) => boolean
    renderForm: (action: ActionOfType<T>, onChange: (next: ActionOfType<T>) => void) => ReactNode
  },
  resolve: MailFilterNameResolver
): RuleActionCatalogEntry<MailFilterAction> {
  return {
    type,
    label: MAIL_FILTER_ACTION_LABELS[type],
    icon: config.icon,
    description: config.description,
    makeDefault: config.makeDefault,
    validate: (action) => config.validate(action as ActionOfType<T>),
    // One summariser for the list rows, the cards and the run history — the lib
    // helper — so a filter never reads three different ways in three places.
    summarize: (action) => describeMailFilterAction(action, resolve),
    renderForm: (action, onChange) =>
      config.renderForm(action as ActionOfType<T>, onChange as (next: ActionOfType<T>) => void),
  }
}

/** Human label for one of an agent's trigger rows — they carry no name column. */
function agentTriggerLabel(trigger: {
  id: string
  kind: string
  triggerType: string | null
  eventType: string | null
  triggerTopic: string | null
}): string {
  const detail = trigger.triggerType ?? trigger.eventType ?? trigger.triggerTopic
  const kind =
    trigger.kind === 'webhook-endpoint'
      ? 'Webhook'
      : trigger.kind.charAt(0).toUpperCase() + trigger.kind.slice(1)
  return `${kind}${detail ? ` · ${detail}` : ''} · ${trigger.id.slice(-6)}`
}

/**
 * `run-agent` needs an agent AND one of that agent's triggers: the
 * `executeAgentEventTrigger` job payload requires `agentTriggerId`, and that
 * queue has no "just run agent X" entry point (§4.3). A component rather than an
 * inline closure because the trigger list is a dependent query.
 */
function RunAgentActionForm({
  action,
  onChange,
  agentOptions,
}: {
  action: ActionOfType<'run-agent'>
  onChange: (next: ActionOfType<'run-agent'>) => void
  agentOptions: SelectOption[]
}) {
  // An author may hold `automationRules.manage` without `agentsView`; a denial
  // here leaves the trigger list empty rather than breaking the dialog.
  const { data: triggers } = api.agentTrigger.list.useQuery(
    { agentId: action.agentId },
    { enabled: action.agentId !== '', retry: false, staleTime: 60_000 }
  )

  const triggerOptions = useMemo<SelectOption[]>(
    () => (triggers ?? []).map((t) => ({ value: t.id, label: agentTriggerLabel(t) })),
    [triggers]
  )

  return (
    <>
      <FieldPanelRow title='Agent' isRequired>
        <FieldInputAdapter
          fieldType={FieldType.SINGLE_SELECT}
          fieldOptions={{ options: agentOptions }}
          triggerProps={RULE_ACTION_TRIGGER_PROPS}
          value={action.agentId}
          // Switching agent invalidates the trigger — a trigger id belongs to
          // exactly one agent, and keeping it would enqueue a job the agent
          // doesn't own.
          onChange={(v) =>
            onChange({ ...action, agentId: firstSelectValue(v), agentTriggerId: '' })
          }
          placeholder='Select agent'
        />
      </FieldPanelRow>
      <FieldPanelRow title='Trigger' isRequired>
        <FieldInputAdapter
          fieldType={FieldType.SINGLE_SELECT}
          fieldOptions={{ options: triggerOptions }}
          triggerProps={RULE_ACTION_TRIGGER_PROPS}
          value={action.agentTriggerId}
          onChange={(v) => onChange({ ...action, agentTriggerId: firstSelectValue(v) })}
          placeholder={action.agentId ? 'Select trigger' : 'Select an agent first'}
          disabled={action.agentId === ''}
        />
      </FieldPanelRow>
      {action.agentId !== '' && triggerOptions.length === 0 && (
        <ActionNote>
          This agent has no triggers yet. Add one on the agent before a filter can start it.
        </ActionNote>
      )}
    </>
  )
}

interface MailFilterActionsPageProps {
  actions: MailFilterAction[]
  selectedIndex: number
  onSelectedIndexChange: (index: number) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onUpdate: (index: number, action: MailFilterAction) => void
  tagOptions: SelectOption[]
  agentOptions: SelectOption[]
  workflowOptions: SelectOption[]
  /** Inboxes the author may write to — the `move-inbox` destinations (§6.5). */
  inboxOptions: SelectOption[]
  /** True when the filter's own inbox is a personal mailbox. Gates `set-read`. */
  isPersonalInbox: boolean
  /** True ⇒ the author holds `automationRules.manage` (§5.1). */
  canRunAutomation: boolean
  resolveName: MailFilterNameResolver
  isEdit: boolean
  canSave: boolean
  isPending: boolean
  onSave: () => void
  onCancel: () => void
  /** Preview strip, rendered directly above the Cancel/Save row. */
  statusBar?: React.ReactNode
}

/**
 * The mail-filter action catalog (§6.2) — nine entries rendered through the
 * shared {@link RuleActionsPage} master-detail editor.
 *
 * Two entries are conditional, and for different reasons:
 * - **`run-agent` / `run-workflow`** are dropped for an author without
 *   `automationRules.manage`. That is UX only: the router rejects them
 *   server-side regardless of what this UI sends (invariant 15), because those
 *   two enqueue automation that then runs as the org.
 * - **`set-read`** is dropped on a shared inbox. Read state is per-user
 *   (`ThreadReadStatus` is unique on `(threadId, userId)`), so on a shared
 *   mailbox there is no principal to mark it read for — v1 restricts it to
 *   personal inboxes (§4.3) and the executor skips it there anyway.
 */
export function MailFilterActionsPage({
  actions,
  selectedIndex,
  onSelectedIndexChange,
  onAdd,
  onRemove,
  onUpdate,
  tagOptions,
  agentOptions,
  workflowOptions,
  inboxOptions,
  isPersonalInbox,
  canRunAutomation,
  resolveName,
  isEdit,
  canSave,
  isPending,
  onSave,
  onCancel,
  statusBar,
}: MailFilterActionsPageProps) {
  const catalog = useMemo<RuleActionCatalogEntry<MailFilterAction>[]>(() => {
    const entries: RuleActionCatalogEntry<MailFilterAction>[] = [
      actionEntry(
        'set-status',
        {
          icon: CheckCheck,
          description: 'Move the conversation to Open, Done, Trash or Spam.',
          makeDefault: () => ({ type: 'set-status', status: 'ARCHIVED' }),
          validate: (action) => !!action.status,
          renderForm: (action, onChange) => (
            <FieldPanelRow title='Status' isRequired>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: STATUS_OPTIONS }}
                triggerProps={RULE_ACTION_TRIGGER_PROPS}
                value={action.status}
                onChange={(v) =>
                  onChange({
                    ...action,
                    status: (firstSelectValue(v) ||
                      'ARCHIVED') as ActionOfType<'set-status'>['status'],
                  })
                }
              />
            </FieldPanelRow>
          ),
        },
        resolveName
      ),

      actionEntry(
        'add-tag',
        {
          icon: Tag,
          makeDefault: () => ({ type: 'add-tag', tagIds: [] }),
          validate: (action) => action.tagIds.length > 0,
          renderForm: (action, onChange) => (
            <FieldPanelRow title='Tags' isRequired>
              <FieldInputAdapter
                fieldType={FieldType.MULTI_SELECT}
                fieldOptions={{ options: tagOptions }}
                triggerProps={RULE_ACTION_TRIGGER_PROPS}
                value={action.tagIds}
                onChange={(v) => onChange({ ...action, tagIds: (v as string[]) ?? [] })}
                placeholder='Select tags'
              />
            </FieldPanelRow>
          ),
        },
        resolveName
      ),

      actionEntry(
        'remove-tag',
        {
          icon: TagIcon,
          makeDefault: () => ({ type: 'remove-tag', tagIds: [] }),
          validate: (action) => action.tagIds.length > 0,
          renderForm: (action, onChange) => (
            <FieldPanelRow title='Tags' isRequired>
              <FieldInputAdapter
                fieldType={FieldType.MULTI_SELECT}
                fieldOptions={{ options: tagOptions }}
                triggerProps={RULE_ACTION_TRIGGER_PROPS}
                value={action.tagIds}
                onChange={(v) => onChange({ ...action, tagIds: (v as string[]) ?? [] })}
                placeholder='Select tags'
              />
            </FieldPanelRow>
          ),
        },
        resolveName
      ),

      actionEntry(
        'assign',
        {
          icon: UserPlus,
          description: 'Assign the conversation to a member.',
          makeDefault: () => ({ type: 'assign', assigneeId: '' }),
          validate: (action) => action.assigneeId !== '',
          renderForm: (action, onChange) => {
            // ⚠️ USERS ONLY (`target: 'user'`), matching the app's own mail assign
            // picker. `Thread.assigneeId` is `text().references(() => User.id)` and
            // `ThreadMutationService.update` writes `parseActorId(...).id` straight
            // into it with no group expansion — a `group:…` assignee is an FK
            // violation at fire time, i.e. a run row that says `failed` and an
            // assignment that never happened.
            //
            // Stored as an ActorId (`user:…`); a bare user id from an older write is
            // normalised for display, and the executor accepts both.
            const actorIds: ActorId[] = action.assigneeId
              ? [
                  isActorId(action.assigneeId)
                    ? action.assigneeId
                    : toActorId('user', action.assigneeId),
                ]
              : []
            return (
              <>
                <FieldPanelRow title='Assignee' isRequired>
                  <FieldInputAdapter
                    fieldType={FieldType.ACTOR}
                    fieldOptions={{ actor: { target: 'user', multiple: false } }}
                    triggerProps={RULE_ACTION_TRIGGER_PROPS}
                    value={actorIds}
                    onChange={(v) =>
                      onChange({ ...action, assigneeId: ((v as ActorId[])[0] ?? '') as string })
                    }
                    placeholder='Select a member'
                  />
                </FieldPanelRow>
                <ActionNote tone='warn'>
                  Assigning widens visibility: an assignee gets the read lens on this conversation.
                </ActionNote>
              </>
            )
          },
        },
        resolveName
      ),

      ...(isPersonalInbox
        ? [
            actionEntry(
              'set-read',
              {
                icon: MailOpen,
                description: 'Personal mailboxes only. Read state is per person.',
                makeDefault: () => ({ type: 'set-read' as const, read: true }),
                validate: () => true,
                renderForm: (action, onChange) => (
                  <FieldPanelRow title='Read state' isRequired>
                    <FieldInputAdapter
                      fieldType={FieldType.SINGLE_SELECT}
                      fieldOptions={{ options: READ_OPTIONS }}
                      triggerProps={RULE_ACTION_TRIGGER_PROPS}
                      value={action.read ? 'read' : 'unread'}
                      onChange={(v) =>
                        onChange({ ...action, read: firstSelectValue(v) === 'read' })
                      }
                    />
                  </FieldPanelRow>
                ),
              },
              resolveName
            ),
          ]
        : []),

      actionEntry(
        'move-inbox',
        {
          icon: ArrowRightLeft,
          description: 'Hand the conversation to another inbox you can write to.',
          makeDefault: () => ({ type: 'move-inbox', inboxId: '' }),
          validate: (action) => action.inboxId !== '',
          renderForm: (action, onChange) => (
            <>
              <FieldPanelRow title='Destination' isRequired>
                <FieldInputAdapter
                  fieldType={FieldType.SINGLE_SELECT}
                  fieldOptions={{ options: inboxOptions }}
                  triggerProps={RULE_ACTION_TRIGGER_PROPS}
                  value={action.inboxId}
                  onChange={(v) => onChange({ ...action, inboxId: firstSelectValue(v) })}
                  placeholder='Select inbox'
                />
              </FieldPanelRow>
              <ActionNote tone='warn'>
                {isPersonalInbox
                  ? 'Moving mail out of your personal mailbox is a sharing action. Everyone who can see the destination inbox will be able to read the whole conversation.'
                  : 'Moving a conversation hands it to whoever can see the destination inbox, which may be a different set of people than can see it today.'}
              </ActionNote>
            </>
          ),
        },
        resolveName
      ),

      actionEntry(
        'suppress-automations',
        {
          icon: ZapOff,
          description: 'Stop AI replies, agents and message workflows for this message.',
          makeDefault: () => ({ type: 'suppress-automations' }),
          validate: () => true,
          renderForm: () => (
            <ActionNote>
              Nothing to configure. Matching messages skip the AI and automation handlers that would
              normally run when mail arrives. The message itself is still delivered and stored.
            </ActionNote>
          ),
        },
        resolveName
      ),
    ]

    // Invariant 15 — hidden here, REJECTED server-side. The catalog filter is UX;
    // the router is the gate, or personal filters become an unkeyed door into org
    // automation.
    if (canRunAutomation) {
      entries.push(
        actionEntry(
          'run-agent',
          {
            icon: Bot,
            description: 'Start one of an agent’s triggers with this conversation.',
            makeDefault: () => ({ type: 'run-agent', agentId: '', agentTriggerId: '' }),
            validate: (action) => action.agentId !== '' && action.agentTriggerId !== '',
            renderForm: (action, onChange) => (
              <RunAgentActionForm action={action} onChange={onChange} agentOptions={agentOptions} />
            ),
          },
          resolveName
        ),
        actionEntry(
          'run-workflow',
          {
            icon: Workflow,
            description: 'Run one published workflow against this message.',
            makeDefault: () => ({ type: 'run-workflow', workflowAppId: '' }),
            validate: (action) => action.workflowAppId !== '',
            renderForm: (action, onChange) => (
              <FieldPanelRow title='Workflow' isRequired>
                <FieldInputAdapter
                  fieldType={FieldType.SINGLE_SELECT}
                  fieldOptions={{ options: workflowOptions }}
                  triggerProps={RULE_ACTION_TRIGGER_PROPS}
                  value={action.workflowAppId}
                  onChange={(v) => onChange({ ...action, workflowAppId: firstSelectValue(v) })}
                  placeholder='Select workflow'
                />
              </FieldPanelRow>
            ),
          },
          resolveName
        )
      )
    }

    return entries
  }, [
    tagOptions,
    agentOptions,
    workflowOptions,
    inboxOptions,
    isPersonalInbox,
    canRunAutomation,
    resolveName,
  ])

  return (
    <RuleActionsPage
      actions={actions}
      catalog={catalog}
      selectedIndex={selectedIndex}
      onSelectedIndexChange={onSelectedIndexChange}
      onAdd={onAdd}
      onRemove={onRemove}
      onUpdate={onUpdate}
      resizeId='mail-filter'
      canSave={canSave}
      isPending={isPending}
      saveLabel={isEdit ? 'Save changes' : 'Create filter'}
      onSave={onSave}
      onCancel={onCancel}
      statusBar={statusBar}
    />
  )
}
