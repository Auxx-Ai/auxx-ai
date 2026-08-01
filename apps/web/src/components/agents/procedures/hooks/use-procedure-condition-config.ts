// apps/web/src/components/agents/procedures/hooks/use-procedure-condition-config.ts
'use client'

import type { LocalAttribute } from '@auxx/lib/agents/procedures/client'
import type { Operator } from '@auxx/lib/conditions/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { BaseType } from '@auxx/lib/workflow-engine/client'
import { toResourceFieldId } from '@auxx/types/field'
import { useCallback, useMemo } from 'react'
import type {
  ConditionRootEntity,
  ConditionSystemConfig,
  FieldDefinition,
} from '~/components/conditions'
import { STANDARD_OPERATORS } from '~/components/conditions/types'
import { useResourceProperty } from '~/components/resources'
import { useResourceFields } from '~/components/resources/hooks/use-resource-fields'

// CRM entity keys whose fields back the STRUCTURED condition mode. These are the
// singular `entityType` values (`packages/database/enums.ts` SystemEntityTypes),
// which the resource store indexes alongside id / apiSlug — confirmed valid
// `resourceMap` lookup keys for the system contact + thread resources.
const CONTACT_SLUG = 'contact'
const THREAD_SLUG = 'thread'

/**
 * ResourceField[] → FieldDefinition[] for the ConditionProvider.
 *
 * `id` is the entity-scoped `resourceFieldId` (`contact:email`), NOT the bare field
 * key (`email`): bare keys collide across entities (contact + thread both expose
 * `email`/`name`), and at runtime the selection resolver
 * (`agents/procedures/context.ts` `toVarRef`) needs the `entityDef:` prefix to root
 * the ref at a subject anchor — a bare key resolves to `undefined` and the rule never
 * matches.
 */
/** `ResourceField.operatorOverrides` is `string[]` in lib — keep only names the condition system knows. */
function isOperator(name: string): name is Operator {
  return Object.hasOwn(STANDARD_OPERATORS, name)
}

function toConditionFields(
  fields: ResourceField[],
  entityDefinitionId: string | undefined
): FieldDefinition[] {
  const out: FieldDefinition[] = []
  for (const f of fields) {
    if (!f.capabilities?.filterable || f.capabilities?.hidden) continue
    // `resourceFieldId` is optional on `ResourceField`; recompose it from the
    // resource's entityDefinitionId when absent. Without the `entityDef:` prefix
    // the runtime resolver can't root the ref, so such a field is unusable.
    const id =
      f.resourceFieldId ?? (entityDefinitionId ? toResourceFieldId(entityDefinitionId, f.id) : null)
    if (!id) continue
    out.push({
      id,
      label: f.label,
      type: f.type,
      fieldType: f.fieldType,
      options: f.options,
      operators: f.operatorOverrides?.filter(isOperator),
    })
  }
  return out
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
  const contactMeta = useResourceProperty(CONTACT_SLUG, ['entityDefinitionId', 'label'])
  const threadMeta = useResourceProperty(THREAD_SLUG, ['entityDefinitionId', 'label'])

  const fields = useMemo<FieldDefinition[]>(
    () => [
      ...toConditionFields(contact.filterableFields, contactMeta?.entityDefinitionId),
      ...toConditionFields(thread.filterableFields, threadMeta?.entityDefinitionId),
      ...localAttributes.map(localToField),
    ],
    [
      contact.filterableFields,
      thread.filterableFields,
      localAttributes,
      contactMeta?.entityDefinitionId,
      threadMeta?.entityDefinitionId,
    ]
  )

  // The drill-down roots: Contact + Thread (whichever resolve from the store). The
  // multi-root `ProcedureFieldSelector` lists these, then drills into each entity's
  // fields — instead of one flat concatenated list with duplicate labels.
  const rootEntities = useMemo<ConditionRootEntity[]>(() => {
    const out: ConditionRootEntity[] = []
    if (contactMeta?.entityDefinitionId) {
      out.push({ entityDefinitionId: contactMeta.entityDefinitionId, label: contactMeta.label })
    }
    if (threadMeta?.entityDefinitionId) {
      out.push({ entityDefinitionId: threadMeta.entityDefinitionId, label: threadMeta.label })
    }
    return out
  }, [contactMeta, threadMeta])

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
      rootEntities,
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
    [fields, rootEntities, singleGroup]
  )

  return { config, getAvailableFields, getFieldDefinition }
}
