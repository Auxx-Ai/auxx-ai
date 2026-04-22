// packages/lib/src/resources/registry/resources/dataset-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { DatasetStatusEnum, VectorDbTypeEnum } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Dataset resource
 * Exposes curated subset: id, name, description, status, documentCount,
 * embeddingModel, vectorDimension, createdAt, updatedAt, vectorDbType, searchConfig
 */
export const DATASET_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    dbColumn: 'id',
    nullable: false,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique dataset identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    dbColumn: 'name',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter dataset name',
    description: 'Name of the dataset',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    dbColumn: 'description',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter description',
    description: 'Description of the dataset',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    dbColumn: 'status',
    nullable: false,
    options: { options: DatasetStatusEnum.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'Current status of the dataset',
    defaultValue: 'ACTIVE',
  },

  documentCount: {
    id: toFieldId('documentCount'),
    key: 'documentCount',
    label: 'Document Count',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    dbColumn: 'documentCount',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Number of documents in the dataset',
  },

  embeddingModel: {
    id: toFieldId('embeddingModel'),
    key: 'embeddingModel',
    label: 'Embedding Model',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    dbColumn: 'embeddingModel',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'e.g., openai:text-embedding-3-large',
    description: 'Embedding model in "provider:model" format',
  },

  vectorDimension: {
    id: toFieldId('vectorDimension'),
    key: 'vectorDimension',
    label: 'Vector Dimension',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    dbColumn: 'vectorDimension',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Dimension of the embedding vectors',
  },

  vectorDbType: {
    id: toFieldId('vectorDbType'),
    key: 'vectorDbType',
    label: 'Vector DB Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    dbColumn: 'vectorDbType',
    nullable: false,
    options: { options: VectorDbTypeEnum.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description: 'Type of vector database used for storage',
    defaultValue: 'POSTGRESQL',
  },

  searchConfig: {
    id: toFieldId('searchConfig'),
    key: 'searchConfig',
    label: 'Search Config',
    type: BaseType.JSON,
    fieldType: FieldType.JSON,
    dbColumn: 'searchConfig',
    nullable: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Search configuration (e.g., search type)',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'When the dataset was created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'When the dataset was last updated',
  },
}
