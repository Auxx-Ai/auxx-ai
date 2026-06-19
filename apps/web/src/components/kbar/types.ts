// apps/web/src/components/kbar/types.ts

/** Pages the command palette can show. */
export type PalettePage =
  | 'root'
  | 'search'
  | 'search-threads'
  | 'record-actions'
  | 'create'
  | 'create-field'
  | 'create-snippet'
  | 'create-signature'
  | 'create-task'
  | 'create-api-key'
  | 'create-webhook'
  | 'create-inbox'
  | 'create-mail-view'
  | 'create-meeting'
  | 'create-group'
  | 'create-dataset'

/**
 * A single command-palette entry. The whole palette is built from plain arrays
 * of these — cmdk renders/filters them, and {@link useCommandPaletteStore} is
 * driven from inside `perform` (via `getState()`), so actions stay serializable
 * and host-agnostic.
 */
export interface PaletteAction {
  /** Stable id — also the key into `SHORTCUTS` and the recents store. */
  id: string
  /** Primary label shown in the row. */
  label: string
  /** Muted helper line (optional). */
  subtitle?: string
  /** Icon id from the shared icon registry (`getIcon`). */
  icon?: string
  /** Extra terms folded into cmdk's fuzzy match. */
  keywords?: string
  /** Chord hint, lowercase as displayed (e.g. `['g', 'i']`). */
  shortcut?: string[]
  /** Render a non-selectable, muted row (e.g. a selection-aware action with nothing selected). */
  disabled?: boolean
  /** Run the action. */
  perform: () => void
}

/** A labelled group of actions rendered as one cmdk group. */
export interface PaletteSection {
  /** Group heading. */
  label: string
  actions: PaletteAction[]
}
