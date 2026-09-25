// packages/lib/src/resources/registry/resources/mrp-plan-item-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import {
  MRP_FLAG_LABELS,
  MRP_FLAGS,
  MRP_ORDER_MODE_LABELS,
  MRP_ORDER_MODES,
  MRP_SUGGESTION_KIND_LABELS,
  MRP_SUGGESTION_KINDS,
  MRP_SUPPLY_TYPE_LABELS,
  MRP_SUPPLY_TYPES,
} from '../../../mrp/client'
import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'
import type { FieldOptionItem } from '../option-helpers'

/** Read-only column-backed field on `MrpPlanRunItem`; no `systemAttribute`, as no CustomField row ever materializes one. */
function planField(
  key: string,
  label: string,
  sortOrder: string,
  type: BaseType,
  fieldType: ResourceField['fieldType'],
  extra: Partial<ResourceField> = {}
): ResourceField {
  return {
    id: toFieldId(key),
    key,
    label,
    type,
    fieldType,
    isSystem: true,
    systemSortOrder: sortOrder,
    dbColumn: key,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    ...extra,
  }
}

function options<T extends string>(values: readonly T[], labels: Record<T, string>) {
  return {
    options: values.map((value): FieldOptionItem => ({ value, label: labels[value] })),
  }
}

/**
 * The plan output rows of MRP runs. Relationship columns are ids of `EntityInstance` rows, so
 * group labels resolve to part and company names; only the left half of each inverse ref is
 * load-bearing (no inverse field exists, the `thread.inbox` precedent).
 */
export const MRP_PLAN_ITEM_FIELDS: Record<string, ResourceField> = {
  partId: planField('partId', 'Part', 'a0', BaseType.RELATION, FieldType.RELATIONSHIP, {
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'part:part_mrp_plan_items' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
  }),
  supplyType: planField('supplyType', 'Supply type', 'a1', BaseType.ENUM, FieldType.SINGLE_SELECT, {
    nullable: false,
    options: options(MRP_SUPPLY_TYPES, MRP_SUPPLY_TYPE_LABELS),
  }),
  buffered: planField('buffered', 'Buffered', 'a2', BaseType.BOOLEAN, FieldType.CHECKBOX, {
    nullable: false,
  }),
  orderMode: planField('orderMode', 'Order mode', 'a3', BaseType.ENUM, FieldType.SINGLE_SELECT, {
    nullable: false,
    options: options(MRP_ORDER_MODES, MRP_ORDER_MODE_LABELS),
  }),
  suggestionKind: planField(
    'suggestionKind',
    'Suggestion',
    'a4',
    BaseType.ENUM,
    FieldType.SINGLE_SELECT,
    { options: options(MRP_SUGGESTION_KINDS, MRP_SUGGESTION_KIND_LABELS) }
  ),
  onHand: planField('onHand', 'On hand', 'a5', BaseType.NUMBER, FieldType.NUMBER, {
    nullable: false,
  }),
  netFlow: planField('netFlow', 'Net flow', 'a6', BaseType.NUMBER, FieldType.NUMBER, {
    nullable: false,
  }),
  adu: planField('adu', 'Average daily usage', 'a7', BaseType.NUMBER, FieldType.NUMBER),
  stockoutDate: planField('stockoutDate', 'Stockout date', 'a8', BaseType.DATE, FieldType.DATE),
  orderByDate: planField('orderByDate', 'Order by', 'a9', BaseType.DATE, FieldType.DATE),
  priority: planField('priority', 'Priority', 'b0', BaseType.NUMBER, FieldType.NUMBER),
  suggestedQty: planField(
    'suggestedQty',
    'Suggested quantity',
    'b1',
    BaseType.NUMBER,
    FieldType.NUMBER
  ),
  suggestedSupplierId: planField(
    'suggestedSupplierId',
    'Suggested supplier',
    'b2',
    BaseType.RELATION,
    FieldType.RELATIONSHIP,
    {
      capabilities: {
        filterable: true,
        sortable: false,
        creatable: false,
        updatable: false,
        configurable: false,
      },
      relationship: {
        inverseResourceFieldId: 'company:company_mrp_plan_items' as ResourceFieldId,
        relationshipType: 'belongs_to',
        isInverse: false,
      },
    }
  ),
  // A text[] column: group-bys unnest it; the condition builder has no array operators, so unfilterable.
  flags: planField('flags', 'Flags', 'b3', BaseType.ARRAY, FieldType.MULTI_SELECT, {
    nullable: false,
    options: options(MRP_FLAGS, MRP_FLAG_LABELS),
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  }),
  runAsOf: planField('runAsOf', 'Run date', 'b4', BaseType.DATETIME, FieldType.DATETIME, {
    nullable: false,
  }),
  isLatest: planField('isLatest', 'Latest run', 'b5', BaseType.BOOLEAN, FieldType.CHECKBOX, {
    nullable: false,
  }),
  isOverdue: planField('isOverdue', 'Overdue', 'b6', BaseType.BOOLEAN, FieldType.CHECKBOX, {
    nullable: false,
  }),
}
