// apps/web/src/components/record-rules/ui/record-rule-configure-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import {
  FIELD_TRANSITIONS,
  LIFECYCLE_TRANSITIONS,
  type RecordRuleOn,
} from '@auxx/lib/record-rules/client'
import { getFieldOperators, type ResourceField } from '@auxx/lib/resources/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Section } from '@auxx/ui/components/section'
import { ListFilter, Plus, Zap } from 'lucide-react'
import { useMemo } from 'react'
import {
  type Condition,
  ConditionContainer,
  ConditionProvider,
  type ConditionSystemConfig,
  useConditionActions,
} from '~/components/conditions'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { ResourcePicker } from '~/components/pickers/resource-picker/resource-picker'
import { RecordRuleFieldRefInput } from './record-rule-field-ref-input'

const EMPTY_CONDITIONS: Condition[] = []

/** Human labels for every trigger the rule engine supports. */
export const ON_LABELS: Record<RecordRuleOn, string> = {
  changed: 'Field changed',
  increased: 'Field increased',
  decreased: 'Field decreased',
  set: 'Field set (was empty)',
  cleared: 'Field cleared',
  created: 'Record created',
  deleted: 'Record deleted',
}

const TRIGGER_OPTIONS: SelectOption[] = [...FIELD_TRANSITIONS, ...LIFECYCLE_TRANSITIONS].map(
  (value) => ({ value, label: ON_LABELS[value] })
)

interface RecordRuleConfigurePageProps {
  name: string
  onNameChange: (value: string) => void
  entityDefinitionId: string
  /** Selecting a record type resets the watched field + conditions (both are def-scoped). */
  onDefinitionChange: (entityDefinitionId: string) => void
  on: RecordRuleOn
  onTriggerChange: (on: RecordRuleOn) => void
  fieldRef: string
  onFieldRefChange: (ref: string) => void
  groups: ConditionGroup[]
  onGroupsChange: (groups: ConditionGroup[]) => void
  /** Fields of the selected record type (for the watched-field picker + condition columns). */
  fields: ResourceField[]
  isLifecycle: boolean
  /** Whether the definition is complete enough to move to the actions page. */
  canContinue: boolean
  onContinue: () => void
  onCancel: () => void
}

/**
 * The record-rule definition form: name, record type, trigger, watched field, and the
 * shared condition builder — laid out with the app's `FieldPanel` primitives.
 */
export function RecordRuleConfigurePage({
  name,
  onNameChange,
  entityDefinitionId,
  onDefinitionChange,
  on,
  onTriggerChange,
  fieldRef,
  onFieldRefChange,
  groups,
  onGroupsChange,
  fields,
  isLifecycle,
  canContinue,
  onContinue,
  onCancel,
}: RecordRuleConfigurePageProps) {
  // Condition builder wiring — mirrors the table filter builder.
  const fieldDefinitions = useMemo(
    () =>
      fields.map((field) => ({
        id: field.resourceFieldId ?? String(field.id),
        label: field.label,
        type: field.type,
        fieldType: field.fieldType,
        fieldKey: field.key,
        operators: field.operatorOverrides || getFieldOperators(field),
        options: field.options,
      })),
    [fields]
  )

  const conditionConfig: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      entityDefinitionId,
      fields: fieldDefinitions,
      allowNesting: false,
      allowReordering: true,
      showLogicalOperators: true,
      showGrouping: true,
      allowGroupNaming: false,
      allowGroupCollapse: false,
      allowGroupReordering: true,
      showGroupSubtext: false,
      // defaultGroupName: 'Condition',
      allowVarEditor: false,
      allowConstantToggle: false,
      allowCurrentUserPlaceholder: true,
    }),
    [entityDefinitionId, fieldDefinitions]
  )

  return (
    <form
      className='flex flex-col'
      onSubmit={(e) => {
        e.preventDefault()
        if (canContinue) onContinue()
      }}>
      <Section title='Rule' icon={<Zap className='size-4' />} collapsible={false}>
        <FieldPanel className='p-0' breakpoint='md' resizeId='record-rule'>
          <FieldPanelRow title='Name' isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={name}
              onChange={(v) => onNameChange(String(v ?? ''))}
              placeholder='e.g. Notify on urgent tickets'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Record type' isRequired>
            <ResourcePicker
              value={entityDefinitionId ? [entityDefinitionId] : []}
              onChange={() => {}}
              entityDefinedOnly
              emptyLabel='Select record type…'
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              onSelectSingle={onDefinitionChange}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Trigger' isRequired description='When the rule fires.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: TRIGGER_OPTIONS }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={on}
              onChange={(v) => onTriggerChange((Array.isArray(v) ? v[0] : v) as RecordRuleOn)}
            />
          </FieldPanelRow>

          {!isLifecycle && (
            <FieldPanelRow
              title='Watched field'
              isRequired
              description='The field whose change fires the rule.'>
              <RecordRuleFieldRefInput
                entityDefinitionId={entityDefinitionId}
                fields={fields}
                value={fieldRef}
                onChange={onFieldRefChange}
                placeholder={entityDefinitionId ? 'Select field…' : 'Select a record type first'}
              />
            </FieldPanelRow>
          )}
        </FieldPanel>
      </Section>

      {entityDefinitionId ? (
        <ConditionProvider
          conditions={EMPTY_CONDITIONS}
          groups={groups}
          config={conditionConfig}
          onConditionsChange={() => {}}
          onGroupsChange={onGroupsChange}
          getAvailableFields={() => fieldDefinitions}
          getFieldDefinition={(id) => fieldDefinitions.find((f) => f.id === id)}>
          <Section
            title='Conditions'
            icon={<ListFilter className='size-4' />}
            collapsible={false}
            actions={<AddGroupButton />}>
            <ConditionContainer
              emptyStateText='No conditions — the rule always runs'
              showAddButton={false}
              showGrouping
            />
          </Section>
        </ConditionProvider>
      ) : (
        <Section title='Conditions' icon={<ListFilter className='size-4' />} collapsible={false}>
          <p className='text-sm text-muted-foreground'>Select a record type first.</p>
        </Section>
      )}

      <DialogFooter className='p-3'>
        <Button variant='ghost' size='sm' type='button' onClick={onCancel}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button variant='outline' size='sm' type='submit' disabled={!canContinue}>
          Continue <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </form>
  )
}

/** "Add group" trigger for the conditions section header — lives inside the ConditionProvider. */
function AddGroupButton() {
  const { addGroup } = useConditionActions()
  if (!addGroup) return null
  return (
    <Button variant='ghost' size='xs' type='button' onClick={() => addGroup()}>
      <Plus />
      Add group
    </Button>
  )
}
