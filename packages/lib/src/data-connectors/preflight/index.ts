// packages/lib/src/data-connectors/preflight/index.ts
// The duplicate-SKU adoption pre-flight — read-only core only.
// (plans/money/design/duplicate-sku-preflight.md, plans/money/tasks/37 §9 phase 0)
//
// Built here: the paginating sweep (§6.1 item 1), pure classification + the
// SKU lookup (§6.1 item 2), and their composition into one report.
//
// NOT built here — left for a follow-up task:
//  - §6.1 item 3, persisting the verdict so it survives a page reload and so
//    "the merchant accepted this" is a recorded fact, not just a click.
//  - §6.1 item 4, extending the readiness ladder so enabling
//    `matchFieldKeys: ['sku']` requires an accepted, zero-`ambiguous` report.
//  - Any router or UI surface. `runAdoptionPreflight` is a plain lib function;
//    nothing here asserts capabilities (CLAUDE.md "Access control does not
//    live in lib" — the router must assert before calling this).
//  - Any schema change. Nothing here adds a column or a table; a follow-up
//    implementing item 3/5 will need one (design §8 item 5 is unresolved: no
//    table currently models "a human approved this connector's adoption").
//
// Design §8's open questions this code surfaced answers/evidence for, restated
// for whoever picks up item 3/4:
//  1. Re-run after a fix — this module has no notion of "the last report";
//     every call is a fresh, full sweep. An explicit re-run action (the
//     design's own leaning) is trivial to wire once item 3 exists; nothing
//     here blocks it.
//  2. Acceptance scope (pin to a catalog state / hash) — `AdoptionPreflightReport`
//     has no id or hash today. `variantCount` + `pagesFetched` are the only
//     summary numbers; a hash of the swept variant set (sku, variantId pairs)
//     would be the natural staleness key if item 3 wants one, computed over
//     `rows` before persisting.
//  3. `catalog_item` in `EntityRefKind` — untouched; this module never reads
//     or writes `catalog_item`, only `part`.
//  4. Cost of the sweep — confirmed real. `sweepConnectorFetch`
//     (`../connector-runtime.ts`) runs synchronously to exhaustion with only a
//     page-count ceiling (`maxPages`, throws past it); there is no job,
//     progress reporting, or resumability. A large store's sweep is a long
//     synchronous call. Whoever builds item 3/4's router surface must decide
//     job+progress vs. a documented interactive ceiling — this module does not.
//  5. Where the accepted-verdict row lives — unresolved; still needs a schema
//     decision (new `DataConnector` column vs. a row of its own), which is
//     explicitly out of scope for this task.

export type {
  AmbiguousSku,
  ClassificationSummary,
  ClassifiedVariant,
  ClassifyVariantsResult,
  ExistingPart,
  VariantClass,
} from './classify'
export { classifyVariants } from './classify'
export { findPartsBySkus, findPartsBySkusForField } from './lookup'
export type {
  AdoptionPreflightReport,
  RunAdoptionPreflightDeps,
  RunAdoptionPreflightInput,
} from './run-preflight'
export { runAdoptionPreflight } from './run-preflight'
export type {
  SweepProductVariantsInput,
  SweepProductVariantsResult,
  SweptVariant,
} from './sweep'
export { extractVariantsFromProducts, sweepProductVariants } from './sweep'
