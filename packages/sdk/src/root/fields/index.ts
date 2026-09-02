// packages/sdk/src/root/fields/index.ts

/**
 * @auxx/sdk/fields — author surface for app-registered custom fields.
 *
 * An installed app can own custom fields on the platform's entities: declared
 * here, provisioned on install/connect, optionally hidden, and removed on
 * uninstall. See docs/app-fields-and-entities-guide.md.
 *
 * Usage:
 * ```ts
 * import { defineFields } from '@auxx/sdk/fields'
 *
 * export const fields = defineFields([
 *   {
 *     key: 'customerId',
 *     type: 'TEXT',
 *     targetEntity: 'contact',
 *     scope: 'connection',
 *     name: 'Shopify customer ID',
 *     capabilities: { hidden: true, filterable: true, updatable: false },
 *   },
 * ])
 * ```
 *
 * The same field shape (`FieldDecl`) is reused by `defineEntity`
 * (`@auxx/sdk/entities`) and by a connector mapping's owned fields.
 */

export {
  type AppFieldDefinition,
  type AppFieldValues,
  defineField,
  defineFields,
  type FieldDecl,
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
