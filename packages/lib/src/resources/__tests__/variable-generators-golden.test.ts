// packages/lib/src/resources/__tests__/variable-generators-golden.test.ts

import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { BaseType } from '../../workflow-engine/core/types'
import type { ResourceField } from '../registry/field-types'
import {
  generateCrudNodeVariablesFromFields,
  generateFindNodeVariablesFromFields,
  generateResourceTriggerVariablesFromFields,
  type ResourceMeta,
  type VariableGeneratorOptions,
} from '../variable-generators'

/**
 * FROZEN golden snapshots for the resource variable generators, captured
 * BEFORE the hygiene refactor (typing, `createNestedVariable` unification,
 * shared context adapter, dead-code deletion) described in the task. These
 * assert byte-identical generated variable trees across the refactor — if a
 * later step changes any of these snapshots, the step introduced a behavior
 * change and is wrong, not the snapshot.
 *
 * The fixture exercises every payload path in `convertFieldToVariableProperty`
 * + `createNestedVariable`:
 * - a plain STRING field (no extras)
 * - a field with `systemAttribute` set (key != systemAttribute, proving
 *   `getFieldOutputKey` picks the systemAttribute)
 * - a hidden field (`capabilities.hidden`) — filtered out before generation
 * - an ENUM field with `options.options` (the select-options payload path)
 * - an ACTOR field (the `fieldReference` payload path)
 * - a `belongs_to` RELATION field whose `relationship.inverseResourceFieldId`
 *   points at a custom entity ('entity_vendors', not in the static registry)
 *   present in `resourcesMap` — exercises the resourcesMap fallback +
 *   relation expansion path
 */

const HIDDEN_SYSTEM_ATTRIBUTE = 'ticket_internal_note' as SystemAttribute
const STATUS_SYSTEM_ATTRIBUTE = 'ticket_status' as SystemAttribute

const titleField: ResourceField = {
  id: toFieldId('title'),
  key: 'title',
  label: 'Title',
  type: BaseType.STRING,
  capabilities: {
    filterable: true,
    sortable: true,
    creatable: true,
    updatable: true,
    configurable: true,
  },
}

const statusField: ResourceField = {
  id: toFieldId('status'),
  // key deliberately differs from systemAttribute to prove getFieldOutputKey
  // prefers systemAttribute
  key: 'status_internal_key',
  label: 'Status',
  type: BaseType.ENUM,
  systemAttribute: STATUS_SYSTEM_ATTRIBUTE,
  options: {
    options: [
      { value: 'open', label: 'Open' },
      { value: 'closed', label: 'Closed' },
    ],
  },
  capabilities: {
    filterable: true,
    sortable: true,
    creatable: true,
    updatable: true,
    configurable: true,
  },
}

const hiddenField: ResourceField = {
  id: toFieldId('internal_note'),
  key: 'internal_note',
  label: 'Internal Note',
  type: BaseType.STRING,
  systemAttribute: HIDDEN_SYSTEM_ATTRIBUTE,
  capabilities: {
    filterable: false,
    sortable: false,
    creatable: false,
    updatable: false,
    configurable: false,
    hidden: true,
  },
}

const assigneeField: ResourceField = {
  id: toFieldId('assignee'),
  key: 'assignee',
  label: 'Assignee',
  type: BaseType.ACTOR,
  options: {
    actor: { target: 'user', multiple: false },
  },
  capabilities: {
    filterable: true,
    sortable: false,
    creatable: true,
    updatable: true,
    configurable: true,
  },
}

const vendorField: ResourceField = {
  id: toFieldId('vendor'),
  key: 'vendor',
  label: 'Vendor',
  type: BaseType.RELATION,
  relationship: {
    inverseResourceFieldId: toResourceFieldId('entity_vendors', 'tickets'),
    relationshipType: 'belongs_to',
    isInverse: false,
  },
  capabilities: {
    filterable: true,
    sortable: false,
    creatable: true,
    updatable: true,
    configurable: true,
  },
}

const vendorNameField: ResourceField = {
  id: toFieldId('name'),
  key: 'name',
  label: 'Name',
  type: BaseType.STRING,
  capabilities: {
    filterable: true,
    sortable: true,
    creatable: true,
    updatable: true,
    configurable: true,
  },
}

const fields: ResourceField[] = [titleField, statusField, hiddenField, assigneeField, vendorField]

const resourceMeta: ResourceMeta = {
  id: 'ticket',
  label: 'Ticket',
  plural: 'Tickets',
}

const options: VariableGeneratorOptions = {
  resourcesMap: new Map([
    [
      'entity_vendors',
      {
        id: 'entity_vendors',
        label: 'Vendor',
        plural: 'Vendors',
        fields: [vendorNameField],
      },
    ],
  ]),
  maxDepth: 2,
}

describe('variable-generators golden snapshots (FROZEN — pre-refactor baseline)', () => {
  it('generateFindNodeVariablesFromFields — findOne', () => {
    const result = generateFindNodeVariablesFromFields(
      fields,
      resourceMeta,
      'node-1',
      'findOne',
      options
    )
    expect(result).toMatchSnapshot()
  })

  // SANCTIONED snapshot change (§10/§10b step 5,
  // plans/kopilot/workflow/10-variable-resolution-deep-dive.md): the findMany
  // array/item variable ids now key on `resourceMeta.id` ("node-2.ticket…")
  // instead of `resourceMeta.plural.toLowerCase()` ("node-2.tickets…") — the
  // plural is a user-editable string, so keying on it silently broke every
  // `{{node.<plural>…}}` ref on rename. `label` still reports the plural
  // ("Tickets") — only the id segment changed. Any OTHER snapshot in this
  // file changing means something else broke.
  it('generateFindNodeVariablesFromFields — findMany', () => {
    const result = generateFindNodeVariablesFromFields(
      fields,
      resourceMeta,
      'node-2',
      'findMany',
      options
    )
    expect(result).toMatchSnapshot()
  })

  it('generateCrudNodeVariablesFromFields — create', () => {
    const result = generateCrudNodeVariablesFromFields(
      fields,
      resourceMeta,
      'node-3',
      'create',
      options
    )
    expect(result).toMatchSnapshot()
  })

  it('generateCrudNodeVariablesFromFields — delete', () => {
    const result = generateCrudNodeVariablesFromFields(
      fields,
      resourceMeta,
      'node-4',
      'delete',
      options
    )
    expect(result).toMatchSnapshot()
  })

  it('generateResourceTriggerVariablesFromFields — created', () => {
    const result = generateResourceTriggerVariablesFromFields(
      fields,
      resourceMeta,
      'node-5',
      'created',
      options
    )
    expect(result).toMatchSnapshot()
  })
})
