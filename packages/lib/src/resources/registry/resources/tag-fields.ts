// packages/lib/src/resources/registry/resources/tag-fields.ts

import { FieldType } from '@auxx/database/enums'
import { BaseType } from '../../types'
import { toFieldId, type ResourceFieldId } from '@auxx/types/field'

import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Tag resource
 * Defines all fields, their types, capabilities, and validation rules
 *
 * Note: id, createdAt, updatedAt are inherited from EntityInstance automatically
 * and should NOT be seeded as CustomFields (filtered by ENTITY_INSTANCE_COLUMNS).
 */
export const TAG_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'id',
    systemSortOrder: 'a0',
    showInPanel: false,
    dbColumn: 'id',
    nullable: false,
    isIdentifier: true,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique tag identifier',
  },

  title: {
    id: toFieldId('title'),
    key: 'title',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'title',
    systemSortOrder: 'a1',
    dbColumn: 'title',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter tag name',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'description',
    systemSortOrder: 'a2',
    dbColumn: 'description',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  emoji: {
    id: toFieldId('emoji'),
    key: 'emoji',
    label: 'Icon',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'emoji',
    systemSortOrder: 'a3',
    dbColumn: 'emoji',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  color: {
    id: toFieldId('color'),
    key: 'color',
    label: 'Color',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'color',
    systemSortOrder: 'a4',
    dbColumn: 'color',
    nullable: true,
    defaultValue: '#94a3b8',
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  // Self-referential: parent tag
  tag_parent: {
    id: toFieldId('tag_parent'),
    key: 'tag_parent',
    label: 'Parent Tag',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'tag_parent',
    systemSortOrder: 'a5',
    dbColumn: 'parentId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'tag:tag_children' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
      // Self-referential constraints
      constraints: {
        preventCircular: true,
        maxDepth: 10,
        onDeleteWithChildren: 'prevent',
      },
    },
  },

  // Inverse: child tags
  tag_children: {
    id: toFieldId('tag_children'),
    key: 'tag_children',
    label: 'Child Tags',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'tag_children',
    systemSortOrder: 'a6',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'tag:tag_parent' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
  },

  // Inverse: threads with this tag
  tag_threads: {
    id: toFieldId('tag_threads'),
    key: 'tag_threads',
    label: 'Threads',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'tag_threads',
    systemSortOrder: 'a7',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'thread:tags' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
  },

  is_system_tag: {
    id: toFieldId('is_system_tag'),
    key: 'is_system_tag',
    label: 'System Tag',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'is_system_tag',
    systemSortOrder: 'a8',
    showInPanel: false,
    dbColumn: 'isSystemTag',
    nullable: false,
    defaultValue: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a9',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when tag is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'a10',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when tag is modified',
  },
}
