// packages/lib/src/resources/registry/resources/product-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { ProductStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Product resource (plans/products/01-product-family.md §1).
 * A product is the family above `part` — a title, a description, an image, a brand,
 * a grouping. Nothing Shopify-shaped lives here: provenance and store-specific
 * columns arrive as app fields via the connector, never as system fields.
 *
 * Deliberately no option axis (§3) — the variant grid is a Shopify artifact with
 * no native consumer in v1.
 */
export const PRODUCT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique product identifier',
  },

  title: {
    id: toFieldId('title'),
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'product_title',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Enter product title',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'product_description',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter description',
  },

  image: {
    id: toFieldId('image'),
    key: 'image',
    label: 'Image',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'product_image',
    systemSortOrder: 'a3',
    nullable: true,
    options: {
      file: { allowMultiple: false, maxFiles: 1, allowedFileTypes: ['image'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Product image used as the avatar',
  },

  // A relation, not a string (01 §2): a supplier is already a `company` —
  // `vendor_part.contact` says so. The Shopify `vendor` brand string is a
  // different fact and lands in an app field; a human links this relation,
  // or it stays null.
  vendor: {
    id: toFieldId('vendor'),
    key: 'vendor',
    label: 'Vendor',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'product_vendor',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'company:products' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'company',
      relationshipType: 'belongs_to',
      inverseName: 'Products',
      inverseSystemAttribute: 'company_products',
    },
    placeholder: 'Select vendor',
    description: 'The company behind this product family',
  },

  productType: {
    id: toFieldId('productType'),
    key: 'productType',
    label: 'Product Type',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'product_type',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter product type',
    description: 'Native category string for this product',
  },

  handle: {
    id: toFieldId('handle'),
    key: 'handle',
    label: 'Handle',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'product_handle',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter handle',
    description: 'URL-safe slug — the match key connectors use under contribute mode',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'product_status',
    systemSortOrder: 'a7',
    nullable: true,
    options: { options: ProductStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    description: 'Draft, active, or archived',
  },

  // Same inline TAGS convention as `part.category` — the shared open-tag
  // `category` systemAttribute, NOT a new `product_tags` vocabulary. Values
  // live in FieldValue.optionId; options grow dynamically as users add tags.
  tags: {
    id: toFieldId('tags'),
    key: 'tags',
    label: 'Tags',
    type: BaseType.TAGS,
    fieldType: FieldType.TAGS,
    isSystem: true,
    systemAttribute: 'category',
    systemSortOrder: 'a8',
    nullable: true,
    options: { options: [] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Add tags',
    description: 'Tags for this product',
  },

  // Reverse relationship: parts (one-to-many from part.product). The single
  // family edge (01 §5) — the same edge whether a part arrived from a connector
  // or was typed by hand.
  parts: {
    id: toFieldId('parts'),
    key: 'parts',
    label: 'Parts',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'product_parts',
    systemSortOrder: 'a9',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'part:product' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'Parts that belong to this product family',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'b0',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the product is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'b1',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the product is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
