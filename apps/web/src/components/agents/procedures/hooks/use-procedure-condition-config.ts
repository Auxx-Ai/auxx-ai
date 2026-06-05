// apps/web/src/components/agents/procedures/hooks/use-procedure-condition-config.ts
'use client'

import type { LocalAttribute } from '@auxx/lib/agents/procedures/client'
import type { Operator } from '@auxx/lib/conditions/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { BaseType } from '@auxx/lib/workflow-engine/client'
import { useCallback, useMemo } from 'react'
import type { ConditionSystemConfig, FieldDefinition } from '~/components/conditions'
import { useResourceFields } from '~/components/resources/hooks/use-resource-fields'

// CRM entity keys whose fields back the STRUCTURED condition mode. These are the
// singular `entityType` values (`packages/database/enums.ts` SystemEntityTypes),
// which the resource store indexes alongside id / apiSlug — confirmed valid
// `resourceMap` lookup keys for the system contact + thread resources.
const CONTACT_SLUG = 'contact'
const THREAD_SLUG = 'thread'

/** ResourceField[] → FieldDefinition[] for the ConditionProvider (records-searchbar pattern). */
function toConditionFields(fields: ResourceField[]): FieldDefinition[] {
  return fields
    .filter((f) => f.capabilities?.filterable && !f.capabilities?.hidden)
    .map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      fieldType: f.fieldType,
      options: f.options,
      operators: f.operators as Operator[] | undefined,
    }))
}

/** Declared local attribute → a `var:*` FieldDefinition (the "Temporary" group). */
function localToField(attr: LocalAttribute): FieldDefinition {
  return {
    id: `var:${attr.name}`,
    label: attr.name,
    type: BaseType.STRING,
    fieldType: attr.dataType,
    options: attr.options,
  }
}

/**
 * Builds the `ConditionSystemConfig` + field resolvers for the STRUCTURED
 * predicate mode — the trigger ruleset (multi-group: `singleGroup=false`) and
 * each `conditionCase` arm (single group: `singleGroup=true`). Fields are the CRM
 * contact/thread resource fields plus the procedure's declared `localAttributes`
 * (the `var:*` "Temporary" group). CRM resolution follows the records-searchbar
 * `toConditionFields` pattern; the contact/thread keys are the system
 * `entityType` values the resource store indexes (confirmed valid lookup keys).
 */
export function useProcedureConditionConfig(
  localAttributes: LocalAttribute[],
  singleGroup: boolean
) {
  const contact = useResourceFields(CONTACT_SLUG)
  const thread = useResourceFields(THREAD_SLUG)

  const fields = useMemo<FieldDefinition[]>(
    () => [
      ...toConditionFields(contact.filterableFields),
      ...toConditionFields(thread.filterableFields),
      ...localAttributes.map(localToField),
    ],
    [contact.filterableFields, thread.filterableFields, localAttributes]
  )

  const getAvailableFields = useCallback(() => fields, [fields])

  const getFieldDefinition = useCallback(
    (fieldId: string | string[]) => {
      const id = Array.isArray(fieldId) ? fieldId[0] : fieldId
      return fields.find((f) => f.id === id)
    },
    [fields]
  )

  const config = useMemo<ConditionSystemConfig>(
    () => ({
      mode: 'resource',
      fields,
      showLogicalOperators: true,
      showGrouping: !singleGroup,
      allowGroupNaming: false,
      allowGroupCollapse: !singleGroup,
      allowGroupReordering: false,
      showGroupSubtext: false,
      allowVarEditor: false,
      allowConstantToggle: false,
      display: 'inline',
    }),
    [fields, singleGroup]
  )

  return { config, getAvailableFields, getFieldDefinition }
}
