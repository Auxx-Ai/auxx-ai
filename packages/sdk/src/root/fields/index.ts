// packages/sdk/src/root/fields/index.ts

/**
 * @auxx/sdk/fields — author surface for app-registered custom fields.
 *
 * An installed app can own custom fields on the platform's entities: declared
 * here, provisioned on install/connect, optionally hidden, and removed on
 * uninstall. See app-registered custom fields.
 *
 * Usage:
 * ```ts
 * import { defineFields } from '@auxx/sdk/fields'
 *
 * export const fields = defineFields([
 *   defineField({
 *     appFieldKey: 'customerId',
 *     type: 'TEXT',
 *     targetEntity: 'contact',
 *     scope: 'connection',
 *     name: 'Shopify customer ID',
 *     capabilities: { hidden: true, filterable: true, updatable: false },
 *   }),
 * ])
 * ```
 */

export {
  type AppFieldDefinition,
  type AppFieldValues,
  defineField,
  defineFields,
  type FieldValueType,
} from './define-field.js'
export {
  FIELD_TYPES,
  type FieldCapabilities,
  type FieldScope,
  type FieldSelectOption,
  type FieldType,
  type FieldTypeValueMap,
} from './field-types.js'
