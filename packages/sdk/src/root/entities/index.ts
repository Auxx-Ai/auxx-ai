// packages/sdk/src/root/entities/index.ts

/**
 * @auxx/sdk/entities — author surface for definitions an installed app owns
 * end to end.
 *
 * `defineFields` (`@auxx/sdk/fields`) adds fields to an EXISTING platform
 * entity (contact, order, ticket, ...). `defineEntity` instead declares a
 * whole new entity the app owns — its own fields, display fields, and
 * relationships to other entities (same-app via `{ entityKey }`, or platform
 * kinds via `{ entityKind }`). See docs/app-fields-and-entities-guide.md.
 *
 * Usage:
 * ```ts
 * import { defineEntity } from '@auxx/sdk/entities'
 *
 * export const orders = defineEntity({
 *   key: 'orders',
 *   apiSlug: 'shopify_orders',
 *   singular: 'Shopify Order',
 *   plural: 'Shopify Orders',
 *   primaryDisplayField: 'name',
 *   fields: [
 *     { key: 'shopifyId', type: 'TEXT', name: 'Shopify Order ID', identity: true },
 *     { key: 'name', type: 'TEXT', name: 'Order Name' },
 *   ],
 * })
 * ```
 *
 * Register it on the app export: `app.entities = [orders]`.
 */

export { defineEntity, type EntityDecl } from './define-entity.js'
