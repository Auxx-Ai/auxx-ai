// packages/lib/src/import/fields/resolution-type-labels.ts

import type { ResolutionType } from '../types/resolution'

/** How one resolution type is presented in the column-mapping picker. */
export interface ResolutionTypeLabel {
  /** Short name for the option row */
  label: string
  /**
   * The disambiguator. It carries a WORKED EXAMPLE wherever two types accept
   * the same-looking cell and read it differently — that is the only thing
   * standing between a user and a 100× import error, so it is not decoration.
   */
  hint: string
}

/**
 * Display strings for every {@link ResolutionType}, for the mapping picker.
 *
 * 🛑 `currency:major` and `number:integer` are BOTH offered on a money field and
 * both accept `1234`. They mean different amounts — $12.34 versus $1,234.00 —
 * and nothing in the file says which. The hints below are the entire mechanism
 * by which a user can tell them apart, so keep the examples concrete and keep
 * them opposed.
 *
 * Exhaustive by type (`Record<ResolutionType, …>`), so adding a resolution type
 * without labelling it is a compile error rather than a blank row in the picker.
 */
export const RESOLUTION_TYPE_LABELS: Record<ResolutionType, ResolutionTypeLabel> = {
  'text:value': { label: 'Text', hint: 'Imported as written' },
  'text:cuid': { label: 'Record ID', hint: 'The record’s internal ID, used to match' },
  'number:integer': {
    label: 'Whole number',
    hint: 'No fraction, 12.5 is refused — on a money field this is the raw cents value: 1234 → $12.34',
  },
  'number:decimal': { label: 'Decimal number', hint: 'Fraction kept: 12.34 → 12.34, 7.5% → 7.5' },
  'currency:major': {
    label: 'Money amount',
    hint: 'What you would write on an invoice: 12.34 → $12.34, 1,234.56 → $1,234.56',
  },
  'date:iso': { label: 'Date', hint: 'YYYY-MM-DD' },
  'date:custom': { label: 'Date (custom format)', hint: 'You supply the format' },
  'datetime:iso': { label: 'Date and time', hint: 'ISO 8601' },
  'datetime:custom': { label: 'Date and time (custom format)', hint: 'You supply the format' },
  'boolean:truthy': { label: 'Yes / no', hint: 'true, yes, 1 → Yes' },
  'email:value': { label: 'Email address', hint: 'One address per cell' },
  'email:split': {
    label: 'Email addresses',
    hint: 'Several per cell, comma or semicolon separated',
  },
  'phone:value': { label: 'Phone number', hint: 'Normalised to E.164' },
  'phone:split': { label: 'Phone numbers', hint: 'Several per cell, comma or semicolon separated' },
  'url:value': { label: 'Web address', hint: 'Scheme and path preserved' },
  'url:split': { label: 'Web addresses', hint: 'Several per cell, comma or semicolon separated' },
  'domain:value': { label: 'Domain', hint: 'Host only — scheme and path stripped' },
  'select:value': { label: 'Option', hint: 'Must match an existing option' },
  'select:create': { label: 'Option (create if new)', hint: 'Adds options the file introduces' },
  'multiselect:split': { label: 'Options', hint: 'Several per cell, matched against the list' },
  'array:split': { label: 'List', hint: 'Split into several values' },
  'relation:id': { label: 'Linked record ID', hint: 'The cell already holds the target’s ID' },
  'relation:match': { label: 'Linked record', hint: 'Matched by name or another field' },
  'relation:create': {
    label: 'Linked record (create if new)',
    hint: 'Creates the target record when nothing matches',
  },
}

/**
 * Label one resolution type for the picker.
 *
 * Falls back to the raw type string rather than throwing: an unlabelled type is
 * a bad picker row, never a broken import wizard.
 *
 * @param type - The resolution type
 * @returns Its label and disambiguating hint
 */
export function getResolutionTypeLabel(type: ResolutionType | string): ResolutionTypeLabel {
  return RESOLUTION_TYPE_LABELS[type as ResolutionType] ?? { label: type, hint: '' }
}
