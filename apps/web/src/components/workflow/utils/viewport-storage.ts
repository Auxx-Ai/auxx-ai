// apps/web/src/components/workflow/utils/viewport-storage.ts

/**
 * Where the per-user canvas camera lives.
 *
 * DECIDED (Markus, 2026-08-19 — `plans/kopilot/workflow/22-draft-save-discipline.md` §5 D1):
 * `graph.viewport` means the AUTHORED starting view and nothing else. Where a
 * given user happens to be scrolled is a browser preference, not a property of
 * the workflow — which is precisely what let an idle second tab 409 an editing
 * one, and what made panning the canvas queue a draft write.
 *
 * Browser-profile scope is enough; no user id in the key.
 */

export interface StoredViewport {
  x: number
  y: number
  zoom: number
}

const key = (workflowId: string) => `workflow:viewport:${workflowId}`

/**
 * The viewport this browser last left the workflow at, or `undefined`.
 *
 * Read order on open is: this → the stored `graph.viewport` (authored) →
 * `fitView`.
 */
export function readStoredViewport(workflowId: string): StoredViewport | undefined {
  if (typeof window === 'undefined' || !workflowId) return undefined
  try {
    const raw = window.localStorage.getItem(key(workflowId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<StoredViewport>
    if (
      typeof parsed?.x !== 'number' ||
      typeof parsed?.y !== 'number' ||
      typeof parsed?.zoom !== 'number'
    ) {
      return undefined
    }
    return { x: parsed.x, y: parsed.y, zoom: parsed.zoom }
  } catch {
    // A quota error, a disabled store or a hand-edited value must never stop a
    // workflow from opening — fall through to the authored view.
    return undefined
  }
}

/** Remember where this browser is looking. Never touches the document. */
export function writeStoredViewport(workflowId: string, viewport: StoredViewport): void {
  if (typeof window === 'undefined' || !workflowId) return
  try {
    window.localStorage.setItem(key(workflowId), JSON.stringify(viewport))
  } catch {
    // Private mode / quota exceeded. A forgotten camera is not worth an error.
  }
}
