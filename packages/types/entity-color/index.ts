// packages/types/entity-color/index.ts

/**
 * The one palette. Twelve ids, each simultaneously an `ICON_COLORS` id
 * (`@auxx/ui/components/icons`), an `OPTION_COLORS` id (`@auxx/lib/custom-fields/client`)
 * and a `Badge` variant — see `plans/icons/entity-def-palette.md` §1.3 for why that was
 * only true of five of them before.
 *
 * 🛑 Order is load-bearing: both colour pickers render down it, so an id inserted in the
 * middle moves every swatch after it.
 */
export const ENTITY_COLORS = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'forest',
  'emerald',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const

export type EntityColor = (typeof ENTITY_COLORS)[number]

/** Fallback for a stored id that is not in {@link ENTITY_COLORS}. */
export const DEFAULT_ENTITY_COLOR: EntityColor = 'gray'

/** Narrows an unvalidated stored string — the DB column is `text`. */
export function isEntityColor(value: string): value is EntityColor {
  return (ENTITY_COLORS as readonly string[]).includes(value)
}

/**
 * Coerce an unvalidated colour to a palette id, falling back to {@link DEFAULT_ENTITY_COLOR}.
 *
 * The boundary helper: `EntityDefinition.color` is a `text` column and `ModelTypeMeta.color`
 * is a plain `string` (`@auxx/database` sits below this package and cannot import the type),
 * so every read of a stored colour has to narrow somewhere. Doing it here means one fallback
 * instead of each renderer inventing its own.
 */
export function toEntityColor(value: string | null | undefined): EntityColor {
  return value != null && isEntityColor(value) ? value : DEFAULT_ENTITY_COLOR
}
