// packages/sdk/src/root/schema/struct-node.ts

import { BaseSchemaNode, type BaseSchemaOptions } from './base-node.js'

/**
 * Options for struct schema fields
 */
export interface StructSchemaOptions<TValue = Record<string, any>>
  extends BaseSchemaOptions<TValue> {
  /** Nested fields */
  fields: Record<string, BaseSchemaNode>
}

/**
 * Struct schema field node (for nested objects)
 */
export class SchemaStructNode<
  TFields extends Record<string, BaseSchemaNode> = Record<string, BaseSchemaNode>,
> extends BaseSchemaNode<'struct', Record<string, any>, StructSchemaOptions<Record<string, any>>> {
  constructor(fields: TFields, options?: Omit<StructSchemaOptions, 'fields'>) {
    super({
      ...options,
      fields,
    } as StructSchemaOptions)
  }

  get type(): 'struct' {
    return 'struct'
  }

  /**
   * Mark this struct field as optional
   */
  optional(): SchemaStructNode<TFields> {
    return new SchemaStructNode<TFields>(this._options.fields as TFields, {
      ...this._options,
      isOptional: true,
    })
  }

  /**
   * Get the nested fields for this struct
   */
  get fields(): TFields {
    return this._options.fields as TFields
  }

  /**
   * Override toJSON to include nested field definitions
   */
  toJSON() {
    const base = super.toJSON()

    // Serialize nested fields
    const serializedFields: Record<string, any> = {}
    for (const [key, field] of Object.entries(this._options.fields)) {
      serializedFields[key] = field.toJSON()
    }

    return {
      ...base,
      fields: serializedFields,
    }
  }
}

/**
 * Create a new struct schema field for nested objects
 *
 * @example
 * ```typescript
 * import { struct, string, number, boolean } from '@auxx/sdk/schema'
 *
 * const addressField = struct(
 *   {
 *     street: string({ label: 'Street' }),
 *     city: string({ label: 'City' }),
 *     zipCode: string({ label: 'ZIP Code' }),
 *     country: string({ label: 'Country', default: 'US' })
 *   },
 *   {
 *     label: 'Address',
 *     description: 'Mailing address'
 *   }
 * )
 *
 * // Optional nested struct
 * const shippingField = struct(
 *   {
 *     sameAsBilling: boolean({ label: 'Same as billing', default: true }),
 *     address: addressField
 *   },
 *   {
 *     label: 'Shipping Information'
 *   }
 * ).optional()
 * ```
 */
export function struct<TFields extends Record<string, BaseSchemaNode>>(
  fields: TFields,
  options?: Omit<StructSchemaOptions, 'fields'>
): SchemaStructNode<TFields> {
  return new SchemaStructNode<TFields>(fields, options)
}
