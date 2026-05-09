// packages/lib/src/resources/registry/resources/article-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { ArticleKind, ArticleStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Article resource.
 *
 * Articles are backed by the dedicated `Article` table (not EntityInstance), so
 * scalar fields use `dbColumn` while the `tags` relationship is FieldValue-backed.
 */
export const ARTICLE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique article identifier',
  },

  title: {
    id: toFieldId('title'),
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'article_title',
    systemSortOrder: 'a1',
    // Title lives on the article's revision row, not the Article table itself.
    // Treated as virtual at the registry level; readers resolve it from the
    // draft/published revision in kb-service.
    dbColumn: undefined,
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Article title (sourced from the published or draft revision)',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'article_status',
    systemSortOrder: 'a2',
    dbColumn: 'status',
    nullable: false,
    options: { options: ArticleStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    defaultValue: 'DRAFT',
    description: 'Publishing status of the article',
  },

  kind: {
    id: toFieldId('kind'),
    key: 'kind',
    label: 'Kind',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'article_kind',
    systemSortOrder: 'a3',
    dbColumn: 'articleKind',
    nullable: false,
    options: { options: ArticleKind.values },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    defaultValue: 'page',
    description: 'Article kind (page, category, header, tab, link)',
  },

  knowledgeBase: {
    id: toFieldId('knowledgeBase'),
    key: 'knowledgeBase',
    label: 'Knowledge Base',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'article_kb',
    systemSortOrder: 'a4',
    dbColumn: 'knowledgeBaseId',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    // No registered inverse — KB isn't an EntityDefinition-backed type yet.
    description: 'Knowledge base this article belongs to',
  },

  parent: {
    id: toFieldId('parent'),
    key: 'parent',
    label: 'Parent',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'article_parent',
    systemSortOrder: 'a5',
    dbColumn: 'parentId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Parent article (self-referential)',
  },

  publishedAt: {
    id: toFieldId('publishedAt'),
    key: 'publishedAt',
    label: 'Published At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'article_published_at',
    systemSortOrder: 'a6',
    dbColumn: 'publishedAt',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Timestamp when the article was first published',
  },

  viewsCount: {
    id: toFieldId('viewsCount'),
    key: 'viewsCount',
    label: 'Views',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'article_views_count',
    systemSortOrder: 'a7',
    dbColumn: 'viewsCount',
    nullable: false,
    defaultValue: 0,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Number of times this article has been viewed',
  },

  tags: {
    id: toFieldId('tags'),
    key: 'tags',
    label: 'Tags',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'article_tags',
    systemSortOrder: 'a8',
    dbColumn: undefined, // FieldValue-backed
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'tag:tag_articles' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: false,
    },
    description: 'Tags assigned to this article',
    placeholder: 'Select tags',
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
    description: 'Automatically set when article is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'aA',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when article is modified',
  },
}
