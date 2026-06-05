// apps/web/src/components/agents/procedures/ui/procedure-trigger-header.tsx
'use client'

import type { LocalAttribute, TriggerExample } from '@auxx/lib/agents/procedures/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { Section } from '@auxx/ui/components/section'
import { Textarea } from '@auxx/ui/components/textarea'
import { Filter, Info, Tags } from 'lucide-react'
import { useMemo, useState } from 'react'
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

  // `whenToUse` is a continuously-typed field, so it keeps LOCAL state rather
  // than binding to the async optimistic store value — a server response (or a
  // background refetch) settling mid-keystroke can never clobber the textarea.
  // The store overlay still updates via `onPatch` (the detail-bar's Publish gate
  // reads it). Seeded once per procedure via the `key` the editor sets, so a
  // procedure switch remounts this header with the new value.
  const [whenToUseDraft, setWhenToUseDraft] = useState(whenToUse)
  const handleWhenToUse = (value: string) => {
    setWhenToUseDraft(value)
    onPatch({ whenToUse: value })
  }

  const groups = useMemo(() => (ruleset.length > 0 ? ruleset : []), [ruleset])
  const allConditions = useMemo(() => groups.flatMap((g) => g.conditions ?? []), [groups])
  const whenToUseEmpty = whenToUseDraft.trim() === ''

  // Rules are opt-in — off by default, enabled only when a saved ruleset exists.
  // Seeded once per procedure (this header is keyed by `procedureId`). Toggling
  // off clears the ruleset so selection falls back to the description + examples.
  const [rulesEnabled, setRulesEnabled] = useState(ruleset.length > 0)
  const handleRulesEnable = (checked: boolean) => {
    setRulesEnabled(checked)
    if (!checked) onPatch({ ruleset: [] })
  }

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
          value={whenToUseDraft}
          onChange={(e) => handleWhenToUse(e.target.value)}
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
        initialOpen={false}>
        <TriggerExamplesEditor
          value={triggerExamples}
          onChange={(triggerExamples) => onPatch({ triggerExamples })}
        />
      </Section>

      <Section
        title='Rules'
        icon={<Filter className='size-4' />}
        description='Structured conditions that must hold for this procedure to run.'
        showEnable
        enabled={rulesEnabled}
        onEnableChange={handleRulesEnable}
        initialOpen={false}>
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
