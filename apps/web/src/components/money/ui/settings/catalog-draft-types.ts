// apps/web/src/components/money/ui/settings/catalog-draft-types.ts

/**
 * The minimal "is there a phantom draft, and what's its display name" handle
 * the products-services-page owner keeps for each tab (products/groups).
 * The full draft field set (description, category, price, entries, …) lives
 * entirely inside the editor component instance (`ProductDraftEditorForm` /
 * `GroupDraftEditorForm`, keyed by `draftId`) — the page only needs enough to
 * render the phantom row in the list and to know whether the currently
 * selected id is a draft or a real record.
 */
export interface CatalogDraftHandle {
  draftId: string
  name: string
  /**
   * Set once the draft's first `record.create` resolves. The draft is KEPT
   * alive after creation (with selection swapped to this id) so the draft
   * editor form stays mounted — remounting onto the store-bound form
   * mid-typing would replace the input's text with the create snapshot and
   * cancel the pending debounced name commit (`useDebouncedCallback` clears
   * its timer on unmount). The list hides the phantom row once this is set
   * (the real row arrived via `appendRecord`); the draft is finally dropped
   * when the user navigates to another row/tab.
   */
  recordId?: string
}
