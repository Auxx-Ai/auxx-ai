// apps/web/src/components/records/layout-editor/first-selected.ts

/**
 * The chosen option id, from whatever the select handed back.
 *
 * Single-select still reports an array (`select-input-field.tsx` calls
 * `onChange(selected: string[])` for both modes), and an empty array is a
 * cleared selection.
 */
export function firstSelected(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}
