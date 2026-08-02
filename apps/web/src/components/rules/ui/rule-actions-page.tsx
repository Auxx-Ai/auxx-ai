// apps/web/src/components/rules/ui/rule-actions-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Plus, Settings2, Trash2, Zap } from 'lucide-react'
import { type ComponentType, type FormEvent, type ReactNode, useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'

/** The flush-in-a-FieldPanelRow trigger sizing shared by every action input. */
export const RULE_ACTION_TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' } as const

/** SINGLE_SELECT/ACTOR adapters emit arrays; take the first value. */
export function firstSelectValue(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : ''
}

/**
 * One action type a rule-shaped feature offers. The catalog is the only thing the
 * shared editor knows about a feature's actions — labels, defaults, validation,
 * summaries and the detail form all arrive through it.
 */
export interface RuleActionCatalogEntry<A> {
  /** Discriminator, matched against the action's own `type`. */
  type: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Optional helper copy under the action-type picker. */
  description?: string
  /** A blank action of this type — used when adding and when switching type. */
  makeDefault: () => A
  /** False ⇒ the action is incomplete; save is blocked and the action is selected. */
  validate: (action: A) => boolean
  /** Secondary line on the action's row in the list. */
  summarize: (action: A) => string
  /** The action's detail form, rendered inside the shared `FieldPanel`. */
  renderForm: (action: A, onChange: (next: A) => void) => ReactNode
}

export interface RuleActionsPageProps<A extends { type: string }> {
  actions: A[]
  catalog: RuleActionCatalogEntry<A>[]
  selectedIndex: number
  onSelectedIndexChange: (index: number) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onUpdate: (index: number, action: A) => void
  /** `FieldPanel` column-resize key — one per feature so widths don't collide. */
  resizeId: string
  /** Whether the rest of the rule is complete enough to save. */
  canSave: boolean
  isPending: boolean
  /** Submit button label, e.g. `'Create rule'` / `'Save changes'`. */
  saveLabel: string
  onSave: () => void
  onCancel: () => void
  /**
   * Persistent strip rendered directly ABOVE the Cancel/Save row — e.g. the mail
   * filter preview count + "also apply" opt-in.
   *
   * It has to live inside the page rather than in the shell's footer slot: the
   * shell renders that slot after the page, which would put it BELOW the submit
   * buttons and leave them stranded mid-dialog.
   */
  statusBar?: ReactNode
}

/**
 * A rule's ordered action list as a master-detail page: a `TreeRow` list of actions
 * with a shared `FieldPanel` editor below for the selected one — mirroring the
 * webhook topics page. Domain-agnostic; everything action-specific comes from the
 * catalog.
 */
export function RuleActionsPage<A extends { type: string }>({
  actions,
  catalog,
  selectedIndex,
  onSelectedIndexChange,
  onAdd,
  onRemove,
  onUpdate,
  resizeId,
  canSave,
  isPending,
  saveLabel,
  onSave,
  onCancel,
  statusBar,
}: RuleActionsPageProps<A>) {
  const selected = actions[selectedIndex] ?? null
  const entryFor = (action: A) => catalog.find((e) => e.type === action.type)
  const selectedEntry = selected ? entryFor(selected) : undefined

  const typeOptions: SelectOption[] = useMemo(
    () => catalog.map((entry) => ({ value: entry.type, label: entry.label })),
    [catalog]
  )

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    // An action type with no catalog entry can't be validated — treat it as complete
    // rather than blocking a save on a shape this editor doesn't understand.
    const invalidIndex = actions.findIndex((action) => {
      const entry = entryFor(action)
      return entry ? !entry.validate(action) : false
    })
    if (invalidIndex >= 0) {
      onSelectedIndexChange(invalidIndex)
      toastError({
        title: 'Incomplete action',
        description: 'Every action needs its target and content filled in.',
      })
      return
    }
    onSave()
  }

  return (
    <form className='flex flex-col p-0' onSubmit={handleSubmit}>
      <Section
        title='Actions'
        icon={<Zap className='size-4' />}
        collapsible={false}
        actions={
          <Button variant='ghost' size='xs' onClick={onAdd}>
            <Plus />
            Add action
          </Button>
        }>
        {actions.length === 0 && (
          <EmptySection
            icon={<Zap className='size-5' />}
            title='No actions yet'
            description='Add an action to run when the rule fires.'
          />
        )}
        <div className='flex flex-col gap-0.5'>
          {actions.map((action, i) => {
            const entry = entryFor(action)
            const Icon = entry?.icon
            return (
              <TreeRow
                key={i}
                icon={Icon ? <Icon className='size-4' /> : undefined}
                isOpen={selectedIndex === i}
                onToggleOpen={() => onSelectedIndexChange(i)}
                rowClassName={
                  selectedIndex === i
                    ? 'bg-primary-100 hover:bg-primary-150'
                    : 'bg-primary-50 hover:bg-primary-100'
                }
                title={<span className='text-sm'>{entry?.label ?? action.type}</span>}
                secondary={
                  <span className='text-xs text-muted-foreground'>
                    {entry?.summarize(action) ?? ''}
                  </span>
                }
                actions={
                  <TreeRowButton
                    variant='destructive'
                    tooltipText='Delete action'
                    onClick={() => onRemove(i)}>
                    <Trash2 />
                  </TreeRowButton>
                }
              />
            )
          })}
        </div>
      </Section>

      <Section
        title={selected ? `Configure · ${selectedEntry?.label ?? selected.type}` : 'Configure'}
        icon={<Settings2 className='size-4' />}
        collapsible={false}>
        {!selected ? (
          <EmptySection
            icon={<Settings2 className='size-5' />}
            title='No action selected'
            description='Select an action to configure it.'
          />
        ) : (
          <FieldPanel className='p-0' breakpoint='md' resizeId={resizeId}>
            <FieldPanelRow title='Action' isRequired description={selectedEntry?.description}>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: typeOptions }}
                triggerProps={RULE_ACTION_TRIGGER_PROPS}
                value={selected.type}
                onChange={(v) => {
                  const next = catalog.find((entry) => entry.type === firstSelectValue(v))
                  if (next) onUpdate(selectedIndex, next.makeDefault())
                }}
              />
            </FieldPanelRow>

            {selectedEntry?.renderForm(selected, (next) => onUpdate(selectedIndex, next))}
          </FieldPanel>
        )}
      </Section>

      {statusBar}

      <DialogFooter className='border-t p-3'>
        <Button variant='ghost' size='sm' type='button' onClick={onCancel}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button
          variant='outline'
          size='sm'
          type='submit'
          disabled={!canSave}
          loading={isPending}
          loadingText='Saving...'>
          {saveLabel} <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </form>
  )
}
