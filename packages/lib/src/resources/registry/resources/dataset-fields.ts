// packages/lib/src/resources/registry/resources/dataset-fields.ts

import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'
import { DatasetStatusEnum, VectorDbTypeEnum } from '../enum-values'

/**
 * Field definitions for the Dataset resource
 * Exposes curated subset: id, name, description, status, documentCount,
 * embeddingModel, vectorDimension, createdAt, updatedAt, vectorDbType, searchConfig
 */
export const DATASET_FIELDS: Record<string, ResourceField> = {
  id: {
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    dbColumn: 'id',
    nullable: false,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    description: 'Unique dataset identifier',
  },

  name: {
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    dbColumn: 'name',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
    },
    placeholder: 'Enter dataset name',
    description: 'Name of the dataset',
  },

  description: {
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    dbColumn: 'description',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    placeholder: 'Enter description',
    description: 'Description of the dataset',
  },

  status: {
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    dbColumn: 'status',
    nullable: false,
    enumValues: DatasetStatusEnum.values,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
    },
    description: 'Current status of the dataset',
    defaultValue: 'ACTIVE',
  },

  documentCount: {
    key: 'documentCount',
    label: 'Document Count',
    type: BaseType.NUMBER,
    dbColumn: 'documentCount',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Number of documents in the dataset',
  },

  embeddingModel: {
    key: 'embeddingModel',
    label: 'Embedding Model',
    type: BaseType.STRING,
    dbColumn: 'embeddingModel',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
    },
    placeholder: 'e.g., openai:text-embedding-3-large',
    description: 'Embedding model in "provider:model" format',
  },

  vectorDimension: {
    key: 'vectorDimension',
    label: 'Vector Dimension',
    type: BaseType.NUMBER,
    dbColumn: 'vectorDimension',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Dimension of the embedding vectors',
  },

  vectorDbType: {
    key: 'vectorDbType',
    label: 'Vector DB Type',
    type: BaseType.ENUM,
    dbColumn: 'vectorDbType',
    nullable: false,
    enumValues: VectorDbTypeEnum.values,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
    },
    description: 'Type of vector database used for storage',
    defaultValue: 'POSTGRESQL',
  },

  searchConfig: {
    key: 'searchConfig',
    label: 'Search Config',
    type: BaseType.JSON,
    dbColumn: 'searchConfig',
    nullable: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
    },
    description: 'Search configuration (e.g., search type)',
  },

  createdAt: {
    key: 'createdAt',
    label: 'Created At',
    type: BaseType.DATETIME,
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'When the dataset was created',
  },

  updatedAt: {
    key: 'updatedAt',
    label: 'Updated At',
    type: BaseType.DATETIME,
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'When the dataset was last updated',
  },
}
