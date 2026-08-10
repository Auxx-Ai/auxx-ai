// packages/lib/src/resources/registry/resources/tag-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { TagScope } from '../enum-values'

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
    operatorOverrides: ['is', 'is not', 'in', 'not in'],
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
    systemAttribute: 'tag_description',
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

  /**
   * Mail-classification eligibility (plans/mail-filter/05-mail-classification-plan.md C2).
   *
   * When true, this tag is offered to the inbound-mail classifier as a label it may apply,
   * and `tag_description` stops being decorative: it becomes the label's DEFINITION in the
   * prompt (C3). Opt-in per tag, because the eligible set *is* the prompt — "every tag"
   * classifies badly and "system tags only" would mean we pick the taxonomy.
   *
   * Deliberately NOT guarded by `rejectIfSystemTag` (§2.2): eligibility is a routing
   * decision about our classifier, not a mutation of the tag's identity, so it stays
   * togglable on any tag including a system one.
   */
  tag_ai_classify: {
    id: toFieldId('tag_ai_classify'),
    key: 'tag_ai_classify',
    label: 'AI Classification',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'tag_ai_classify',
    systemSortOrder: 'a14',
    showInPanel: false,
    nullable: false,
    defaultValue: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'When true, the AI mail classifier may apply this tag to inbound mail.',
  },

  /**
   * Shipped identity of a seeded mail category
   * (plans/mail-filter/06-mail-categories-rework-plan.md §3.1) — `category:sales`,
   * `category:order-status`, … Null for every user-created tag.
   *
   * A **provenance marker, not a lock**. Unlike `is_system_tag` it freezes nothing:
   * title, emoji, colour, parent and above all `tag_description` stay editable, which
   * is the entire point (D4/D5) — the description IS the classifier's instruction, so a
   * category the business cannot re-word is a category it cannot use. What the marker
   * buys is (a) an undeletable seeded category, via `rejectDeleteIfTemplateTag`, and
   * (b) a shipped default to reset back to.
   *
   * ⚠️ **Not user-writable** (invariant 2): a user who can stamp this on their own tag
   * makes it undeletable. `creatable`/`updatable: false` is documentation only — the
   * write path does not read capabilities — so the enforcement is
   * `dropUnauthorizedTemplateKey` on the field pre-hook chain, exactly as
   * `is_system_tag` is enforced today. Only the seeder writes it, through
   * `bypassFieldGuards`.
   */
  tag_template_key: {
    id: toFieldId('tag_template_key'),
    key: 'tag_template_key',
    label: 'Template Key',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'tag_template_key',
    systemSortOrder: 'a15',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description:
      'Shipped identity of a seeded mail category. Set by the seeder only; makes the tag undeletable and resettable to its shipped default.',
  },

  emoji: {
    id: toFieldId('emoji'),
    key: 'emoji',
    label: 'Icon',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'tag_emoji',
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
    systemAttribute: 'tag_color',
    systemSortOrder: 'a4',
    dbColumn: 'color',
    nullable: true,
    defaultValue: 'gray',
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

  // Inverse: articles with this tag
  tag_articles: {
    id: toFieldId('tag_articles'),
    key: 'tag_articles',
    label: 'Articles',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'tag_articles',
    systemSortOrder: 'a11',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'article:tags' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
  },

  // Resource-type scope (filters the picker pool — thread tags vs article tags)
  tag_scope: {
    id: toFieldId('tag_scope'),
    key: 'tag_scope',
    label: 'Scope',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'tag_scope',
    systemSortOrder: 'a13',
    showInPanel: false,
    nullable: false,
    defaultValue: 'thread',
    options: { options: TagScope.values },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      // Scope is decided at create time; re-scoping a tag would silently break
      // inverse links. If we ever need to move tags, do it via an explicit admin op.
      updatable: false,
      configurable: false,
    },
    description: 'Which resource type this tag is meant for. Filters the picker pool.',
  },

  // Public-vs-private flag for future KB visibility
  is_public: {
    id: toFieldId('is_public'),
    key: 'is_public',
    label: 'Public',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'tag_is_public',
    systemSortOrder: 'a12',
    showInPanel: false,
    nullable: false,
    defaultValue: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'When true, the tag is exposed on the public KB. Internal by default.',
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
