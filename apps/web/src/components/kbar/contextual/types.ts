// apps/web/src/components/kbar/contextual/types.ts

export type CommandScopeKind = 'table' | 'record' | 'thread' | 'page'

/** Structured scope payload a `<CommandContext>` contributes. */
export interface CommandScope {
  /** Group heading + default group key for descendant actions. */
  label: string
  kind: CommandScopeKind
  /** "entityDefinitionId:instanceId" — present for record scopes. */
  recordId?: string
  entityDefinitionId?: string
  /** Higher = listed first among contextual groups. Default 0. */
  priority?: number
}

/** A registered scope slice, keyed by the contributing component's `useId()`. */
export interface CommandContextSlice extends CommandScope {
  id: string
}

/**
 * One contextual row. Mirrors {@link PaletteAction} but adds `group`, `disabled`
 * and `priority`. The `perform` stored here is a STABLE wrapper that reads the
 * latest closure via a ref — see `command-action.tsx`.
 */
export interface CommandActionSlice {
  id: string
  label: string
  subtitle?: string
  icon?: string
  keywords?: string
  /** Chord hint — rendered as a `Kbd` chip but bound to NO global hotkey. */
  shortcut?: string[]
  /** Resolved group label (explicit prop or inherited context label). */
  group: string
  disabled?: boolean
  priority?: number
  /** Stable wrapper → latest perform. */
  perform: () => void
}
