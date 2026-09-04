// packages/lib/src/resources/registry/block-types.ts

/**
 * The block model behind the record layout system
 * (`plans/drawer/record-layout-system.md` §4).
 *
 * Everything placeable on a record surface (drawer or detail view) is a
 * **block**: an id, a kind, and config. Three kinds exist and the difference
 * between them is who authors them:
 *
 * - `card` is a code-registered component. Placeable, never user-creatable.
 * - `fields` is a set of fields rendered as a field panel. `core:details` is the
 *   whole-record instance; a promoted `fieldGroup` is a partial one.
 * - `records` is a list of related records driven entirely by config.
 *
 * These types are **placement only**. They never declare capability: every gate
 * (`permissionKey`, `recordResource`, `featureGate`, restricted-mode) is read
 * from the registry entry for the block id at render time, so moving a block
 * cannot widen who may see it.
 */

/** Which of the three block kinds a block is. */
export type BlockKind = 'card' | 'fields' | 'records'

/**
 * Read the host record's inverse relationship mirror (the `useSystemValues` +
 * `extractRelationshipRecordIds` path every hand-written related card uses).
 *
 * Cheap for a short list and always current, but the mirror array is
 * **unordered and uncapped**: `contact_work_orders` has been measured at 475
 * entries from 5 records, and each rendered row costs its own record/resource/
 * value/field queries. Prefer {@link RecordsQuerySource} wherever the list can
 * grow, and keep `visibleLimit` set here.
 */
export interface RecordsRelationSource {
  kind: 'relation'
  /**
   * System attribute of the inverse relationship on the HOST record, e.g.
   * `company_work_orders` on a company.
   */
  relationAttr: string
}

/**
 * Read the target definition directly with a filter, sort and page size (the
 * `useRecordList` path `contact-tickets-tab` and `company-parts-tab` use).
 *
 * The only option when the list needs an order or a bounded page, because
 * inverse relationship fields are declared `sortable: false`.
 */
export interface RecordsQuerySource {
  kind: 'query'
  /** Target definition the rows come from, e.g. `work_order`. */
  definition: string
  /**
   * Forward field on the TARGET pointing back at the host, in `def:field` slug
   * form, e.g. `work_order:company`. This is the filter's left-hand side.
   */
  hostFieldId: string
  /** Sort applied by the server. Omit for the definition's own default. */
  sort?: { fieldId: string; desc?: boolean }
  /** Page size for the underlying list query. Not a cap on what exists. */
  pageSize?: number
}

/**
 * The two reads are deliberately not interchangeable, so which one a section
 * uses is a per-section decision driven by expected list length.
 */
export type RecordsSource = RecordsRelationSource | RecordsQuerySource

/** Config for a `records` block. */
export interface RecordsBlockConfig {
  source: RecordsSource
  /**
   * System attribute on the TARGET whose value renders as the row's status
   * badge, e.g. `work_order_status`. Omit for rows with no status.
   */
  statusAttr?: string
  /** Muted line shown when the list resolves to nothing. */
  emptyLabel?: string
  /**
   * Rows rendered before a "Show N more" toggle. Bounds the per-row query
   * fan-out, which is the whole reason this is not optional in practice.
   */
  visibleLimit?: number
  /**
   * Escape hatch for a section that carries an action. Actions are NOT config:
   * encoding create rows, guard queries, mutations and dialogs as schema keys
   * would grow a key per feature until it is a worse programming language. This
   * names a component in the actions registry instead; pure-read sections omit
   * it.
   */
  actionsComponent?: string
}

/** Config for a `fields` block. */
export interface FieldsBlockConfig {
  /**
   * Which fields the block renders.
   *
   * Omitted means the whole record, i.e. the Details panel (`core:details`).
   * Set to a `fieldGroups[].id` to render only that group, which is how a group
   * is promoted out of Details into a standalone section elsewhere.
   */
  fieldGroupId?: string
}

/** Gates and chrome every block carries, whatever its kind. */
export interface LayoutBlockBase {
  /**
   * Stable id, and the key the stored layout delta addresses.
   *
   * Registry blocks derive theirs from the registry (`card:customer`,
   * `core:details`); user-created blocks get a generated id, which is why a
   * `records` block may repeat on a definition while a `card` may not.
   */
  id: string
  /** Section header text. */
  label: string
  /** Icon name resolved through `getIconComponent`, never a component. */
  icon?: string
  /** Render order relative to a tab's own built-in content. */
  position?: 'before' | 'after'
  /** Layer-2 capability gate. Hides the whole section, header included. */
  permissionKey?: string
  /** Layer-3 per-definition gate for a block that lists another definition. */
  recordResource?: string
  /** Org feature gate. */
  featureGate?: string
  /** Cancel the wrapping Section's horizontal padding. */
  fullBleed?: boolean
}

/** A code-registered component placed by id. Never user-creatable. */
export interface CardBlock extends LayoutBlockBase {
  kind: 'card'
  /**
   * Card key within the entity type, i.e. the `value` half of the registry's
   * `entityType:value` component key.
   */
  cardValue: string
}

/** A field panel: the whole record, or one promoted group. */
export interface FieldsBlock extends LayoutBlockBase {
  kind: 'fields'
  config?: FieldsBlockConfig
}

/** A config-driven list of related records, one TreeRow per row. */
export interface RecordsBlock extends LayoutBlockBase {
  kind: 'records'
  config: RecordsBlockConfig
}

/** Any placeable block. */
export type LayoutBlock = CardBlock | FieldsBlock | RecordsBlock

/** Block id of the whole-record Details panel, which every definition has. */
export const DETAILS_BLOCK_ID = 'core:details'

/** Prefix for block ids derived from a registry card entry. */
export const CARD_BLOCK_ID_PREFIX = 'card:'

/** Build the layout block id for a registry card. */
export function cardBlockId(cardValue: string): string {
  return `${CARD_BLOCK_ID_PREFIX}${cardValue}`
}
