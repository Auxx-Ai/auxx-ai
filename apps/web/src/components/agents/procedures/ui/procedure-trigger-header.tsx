// apps/web/src/components/agents/procedures/ui/procedure-trigger-header.tsx
'use client'

import type { LocalAttribute, TriggerExample } from '@auxx/lib/agents/procedures/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { Section } from '@auxx/ui/components/section'
import { Textarea } from '@auxx/ui/components/textarea'
import { Filter, Info, Tags } from 'lucide-react'
import { useMemo } from 'react'
import { ConditionContainer, ConditionProvider } from '~/components/conditions'
import { useProcedureConditionConfig } from '../hooks/use-procedure-condition-config'
import { TriggerExamplesEditor } from './trigger-examples-editor'

interface ProcedureTriggerHeaderProps {
  whenToUse: string
  triggerExamples: TriggerExample[]
  ruleset: ConditionGroup[]
  localAttributes: LocalAttribute[]
  onPatch: (patch: {
    whenToUse?: string
    triggerExamples?: TriggerExample[]
    ruleset?: ConditionGroup[]
  }) => void
}

/**
 * The selection-trigger defaults above the procedure canvas, rendered as the
 * same full-bleed `<Section>` stack as the agent-detail tabs: a `whenToUse`
 * description, the use/avoid examples, and the structured ruleset (the SAME
 * conditions builder as the `conditionCase` arms, but multi-group). All three
 * write through the same debounced autosave patch.
 */
export function ProcedureTriggerHeader({
  whenToUse,
  triggerExamples,
  ruleset,
  localAttributes,
  onPatch,
}: ProcedureTriggerHeaderProps) {
  const { config, getAvailableFields, getFieldDefinition } = useProcedureConditionConfig(
    localAttributes,
    false
  )

  const groups = useMemo(() => (ruleset.length > 0 ? ruleset : []), [ruleset])
  const allConditions = useMemo(() => groups.flatMap((g) => g.conditions ?? []), [groups])
  const whenToUseEmpty = whenToUse.trim() === ''

  return (
    <>
      <Section
        title='When to use'
        icon={<Info className='size-4' />}
        description='Describe the situation that should select this procedure.'
        isRequired={whenToUseEmpty}
        initialOpen
        collapsible={false}>
        <Textarea
          value={whenToUse}
          onChange={(e) => onPatch({ whenToUse: e.target.value })}
          placeholder='Describe when this procedure should run…'
          className='min-h-16 text-sm'
        />
        {whenToUseEmpty && (
          <span className='mt-1.5 text-xs text-amber-600'>Required to publish.</span>
        )}
      </Section>

      <Section
        title='Trigger examples'
        icon={<Tags className='size-4' />}
        description='Use / avoid examples that sharpen selection. Aim for 10 or more.'
        initialOpen
        collapsible={false}>
        <TriggerExamplesEditor
          value={triggerExamples}
          onChange={(triggerExamples) => onPatch({ triggerExamples })}
        />
      </Section>

      <Section
        title='Rules'
        icon={<Filter className='size-4' />}
        description='Structured conditions that must hold for this procedure to run.'
        initialOpen
        collapsible={false}>
        <ConditionProvider
          conditions={allConditions}
          groups={groups}
          config={config}
          onConditionsChange={() => {}}
          onGroupsChange={(ruleset) => onPatch({ ruleset })}
          getAvailableFields={getAvailableFields}
          getFieldDefinition={getFieldDefinition}>
          <ConditionContainer
            showGrouping
            showAddButton
            emptyStateText='No rules — selection relies on the description + examples.'
          />
        </ConditionProvider>
      </Section>
    </>
  )
}
