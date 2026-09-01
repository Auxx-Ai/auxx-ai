// packages/lib/src/field-hooks/__tests__/support/captured.ts
//
// Fixture builders that produce the shape `captureEventData` ACTUALLY produces,
// so a guard test cannot pass against a shape production never sends.
//
// 🛑 Every pre-delete and post-delete hook receives `values` from
// `captureEventData`, which arrays every `ARRAY_RETURN_FIELD_TYPES` member
// (`SINGLE_SELECT`, `MULTI_SELECT`, `TAGS`, `RELATIONSHIP`, `FILE`) regardless
// of value count. A hand-written `{ build_reversal_of: 'def:id' }` fixture is
// the CREATE chain's shape; a guard tested against it passes while being inert
// in production, which is exactly what shipped in #1995
// (`plans/money/tasks/24-captured-value-shape.md`).
//
// Use these instead of literals. The contract they encode is pinned by
// `resources/events/captured-shape.test.ts`.

/** A captured RELATIONSHIP: an array of RecordId strings, even for a to-one. */
export function capturedRelation(...recordIds: string[]): string[] {
  return recordIds
}

/** A captured SINGLE_SELECT / MULTI_SELECT: an array of option ids. */
export function capturedOption(...optionIds: string[]): string[] {
  return optionIds
}
