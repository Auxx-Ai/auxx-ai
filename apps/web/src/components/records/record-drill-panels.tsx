// apps/web/src/components/records/record-drill-panels.tsx
'use client'

// Per-entityType `drillPanels` registry (dispatch M2 build spec §F.1/§F.3,
// dispatch v4/02 plan). Shared, surface-agnostic home consumed by both the
// detail page's sections layout (`DetailViewSections`) and the record drawer
// (`BaseEntityDrawer`) — a plain `entityType → panels[]` lookup, code-split via
// `next/dynamic` so entityTypes without a drill never pull in the dispatch
// bundle.

import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { ChevronLeft } from 'lucide-react'
import dynamic from 'next/dynamic'
import { parseAsArrayOf, parseAsString, useQueryState, useQueryStates } from 'nuqs'
import * as React from 'react'
import type { RecordId } from '~/components/resources'

/**
 * Context handed to a `RecordDrillPanel`'s `bar`/`render`/`renderItem`. Shared
 * across every record surface that can push a drill panel over its root
 * content via the `panel`/`item` nuqs query params — the detail page's
 * sections layout today, the record drawer as of dispatch v4/02.
 */
export interface RecordDrillContext {
  recordId: RecordId
  entityInstanceId: string
  record?: Record<string, unknown>
  /** The drilled item id — the `item` nuqs query param — once this panel is on top. */
  itemId: string | null
  /** Push (id) / pop (null) the third stack level (`${panel.value}:item`). */
  setItemId: (id: string | null) => void
  /** Pop all the way back to the root panel. */
  close: () => void
}

/**
 * One additional `NavStackPanel` pushed over a record surface's root content,
 * keyed by the `panel` nuqs query param (dispatch M2 build spec §F.1 — e.g.
 * work_order's "visits" list). `renderItem` is optional: when provided,
 * calling `setItemId` from within `render` pushes a third stack level
 * (mirrors agent-detail's procedure → drill).
 */
export interface RecordDrillPanel {
  /** Panel key. Activated when the `panel` query param equals this value. */
  value: string
  /** `NavStackBar` content while this panel (or its item level) is on top. */
  bar?: React.ReactNode | ((ctx: RecordDrillContext) => React.ReactNode)
  /** List-level (or single) panel body. */
  render: (ctx: RecordDrillContext) => React.ReactNode
  /** Optional item-level body — the third stack level, keyed `${value}:item`. */
  renderItem?: (ctx: RecordDrillContext) => React.ReactNode
}

const DRILL_LOADING = () => <div className='p-6 text-sm text-muted-foreground'>Loading...</div>

const VisitsListPanel = dynamic(
  () => import('../dispatch/ui/job-schedule/visits-list-panel').then((m) => m.VisitsListPanel),
  { ssr: false, loading: DRILL_LOADING }
)
const VisitDetailPanel = dynamic(
  () => import('../dispatch/ui/job-schedule/visit-detail-panel').then((m) => m.VisitDetailPanel),
  { ssr: false, loading: DRILL_LOADING }
)

/** Back button + title — the `ProcedureDetailBar`/`agent-detail-tabs.tsx` shared-bar
 * pattern, kept inline (generic `@auxx/ui` primitives only) so this registry stays
 * a light, statically-imported hookup point (`detail-view.tsx` imports it eagerly). */
export function DrillBackBar({ title }: { title: string }) {
  const { pop } = useNavStack()
  return (
    <div className='flex h-9 items-center gap-2 px-2'>
      <Button variant='ghost' size='icon-xs' className='rounded-md' onClick={() => pop()}>
        <ChevronLeft />
      </Button>
      <span className='text-sm font-medium'>{title}</span>
    </div>
  )
}

const RECORD_DRILL_PANELS: Record<string, RecordDrillPanel[]> = {
  work_order: [
    {
      value: 'visits',
      bar: (ctx: RecordDrillContext) => <DrillBackBar title={ctx.itemId ? 'Visit' : 'Visits'} />,
      render: (ctx) => <VisitsListPanel {...ctx} />,
      renderItem: (ctx) => <VisitDetailPanel {...ctx} />,
    },
  ],
}

/** Drill panels registered for an entityType, or `[]`. Safe to call statically
 * (e.g. outside a component's render path) — a plain lookup, no hooks. */
export function getRecordDrillPanels(entityType: string): RecordDrillPanel[] {
  return RECORD_DRILL_PANELS[entityType] ?? []
}

/**
 * Wraps the shared `panel`/`item` nuqs query params driving the two-level
 * record drill (dispatch v4/02 §1.2). Consumed by both `DetailViewSections`
 * and `BaseEntityDrawer` — nuqs state is global, so cards/sections trigger
 * drills through this hook with no prop threading.
 */
export function useRecordDrill() {
  const [panel, setPanel] = useQueryState('panel')
  const [item, setItem] = useQueryState('item')

  return {
    panel,
    itemId: item,
    /** Push the drill panel, optionally straight to an item (third stack level). */
    open: (panelValue: string, itemId?: string) => {
      void setPanel(panelValue)
      void setItem(itemId ?? null)
    },
    setItemId: (id: string | null) => void setItem(id),
    /** Pop all the way back to the root panel. */
    close: () => {
      void setPanel(null)
      void setItem(null)
    },
  }
}

/**
 * `panel`/`item` state + NavStack stack derivation for a drill RENDERER
 * (`DetailViewSections`, `BaseEntityDrawer`). Entering an item DIRECTLY — deep
 * link, a Schedule-card row, a dispatch sidebar row — yields a TWO-level stack,
 * so back goes straight to the record root; the list level only interposes when
 * the user actually navigated through it this drill session (v4/02 follow-up).
 * The stack is guarded on a REGISTERED panel: an unrecognized `?panel=` value
 * would otherwise top the stack with a value no NavStackPanel matches, blanking
 * the surface.
 */
export function useRecordDrillStack(drillPanels: RecordDrillPanel[]) {
  const [panel, setPanel] = useQueryState('panel')
  const [item, setItem] = useQueryState('item')

  const activeDrillPanel = React.useMemo(
    () => drillPanels.find((p) => p.value === panel) ?? null,
    [drillPanels, panel]
  )

  // "Came from the full list" — flips true only once the list level has
  // rendered. Render-time ref write is idempotent (strict-mode safe).
  const visitedListRef = React.useRef(false)
  if (!panel) visitedListRef.current = false
  else if (!item) visitedListRef.current = true

  const stack =
    !panel || !activeDrillPanel
      ? ['root']
      : !item || !activeDrillPanel.renderItem
        ? ['root', panel]
        : visitedListRef.current
          ? ['root', panel, `${panel}:item`]
          : ['root', `${panel}:item`]

  const clear = React.useCallback(() => {
    void setPanel(null)
    void setItem(null)
  }, [setPanel, setItem])

  const onStackChange = React.useCallback(
    (next: string[]) => {
      if (next.length <= 1) {
        void setPanel(null)
        void setItem(null)
      } else if (next.length === 2) {
        void setItem(null)
      }
    },
    [setPanel, setItem]
  )

  return { panel, item, setItem, clear, activeDrillPanel, stack, onStackChange }
}

/** `useRecordPeekStack`'s return shape. */
export interface RecordPeekStack {
  /** `[base, ...peek]` — the full stack of frames, base first, top last. */
  frames: RecordId[]
  /** `frames[frames.length - 1]` — the frame currently on top. */
  top: RecordId | null
  /** `frames.length`. */
  depth: number
  /** Push a record onto the stack. Already-present (incl. the base) → truncate back to it. */
  push: (recordId: RecordId) => void
  /** Drop the top peek frame. No-op at depth 1 (base only). */
  pop: () => void
  /** Empty the peek stack entirely. */
  clear: () => void
}

/**
 * Cross-record "peek" stack over a record surface's `?peek=` nuqs array param
 * (dispatch v4/04 §1.1) — the layer ABOVE `useRecordDrillStack`: each frame in
 * the stack is a full drawer body for one record (its own header, tabs,
 * overview cards) and owns its own `panel`/`item` drill independently. The
 * base record stays the host's own param (`?record=`/`?id=`); this hook only
 * owns `peek`, so a host needs zero changes to adopt it.
 *
 * Push/pop/clear all write `peek` AND clear `tab`/`panel`/`item` in the SAME
 * `useQueryStates` batch — one history entry, no intermediate render with a
 * new top frame but a stale drill/tab from the frame it replaced.
 *
 * When the BASE record changes while mounted (clicking another row with the
 * drawer open), the URL still carries the previous record's `peek` frames
 * until the host's clearing effect lands a paint later — long enough for the
 * frame NavStack to see the stack shrink and slide 'back' from a stale frame.
 * Stale frames are dropped at RENDER time instead, so the whole stack
 * re-bases in one update (a NavStack 'replace'); the ref initializes to the
 * first base, so a cold-load deep link (?id=…&peek=…) still hydrates its stack.
 */
export function useRecordPeekStack(baseRecordId: RecordId | null): RecordPeekStack {
  const [{ peek }, setState] = useQueryStates({
    peek: parseAsArrayOf(parseAsString),
    tab: parseAsString,
    panel: parseAsString,
    item: parseAsString,
  })

  const prevBaseRef = React.useRef(baseRecordId)
  const peekStaleRef = React.useRef(false)
  if (prevBaseRef.current !== baseRecordId) {
    if (prevBaseRef.current !== null && baseRecordId !== null) peekStaleRef.current = true
    prevBaseRef.current = baseRecordId
  }
  if (!peek || peek.length === 0) peekStaleRef.current = false
  const livePeek = peekStaleRef.current ? null : peek

  const frames = React.useMemo<RecordId[]>(() => {
    if (!baseRecordId) return []
    return [baseRecordId, ...((livePeek ?? []) as RecordId[])]
  }, [baseRecordId, livePeek])

  const depth = frames.length
  const top = frames[depth - 1] ?? null

  const push = React.useCallback(
    (recordId: RecordId) => {
      const existingIndex = frames.indexOf(recordId)
      // Already on the stack (including the base, index 0) — truncate back to
      // it instead of appending a duplicate (decision #6, kills SR→QT→SR cycles).
      const nextPeek =
        existingIndex >= 0 ? frames.slice(1, existingIndex + 1) : [...frames.slice(1), recordId]
      void setState({
        peek: nextPeek.length > 0 ? nextPeek : null,
        tab: null,
        panel: null,
        item: null,
      })
    },
    [frames, setState]
  )

  const pop = React.useCallback(() => {
    if (depth <= 1) return
    const nextPeek = frames.slice(1, -1)
    void setState({
      peek: nextPeek.length > 0 ? nextPeek : null,
      tab: null,
      panel: null,
      item: null,
    })
  }, [depth, frames, setState])

  const clear = React.useCallback(() => {
    void setState({ peek: null, tab: null, panel: null, item: null })
  }, [setState])

  return { frames, top, depth, push, pop, clear }
}

/** Context handed down by `RecordStackProvider` — `push`+`depth` from the
 * enclosing `useRecordPeekStack`, so any nested card/row can push a related
 * record onto the stack without prop-threading. */
interface RecordStackContextValue {
  push: (recordId: RecordId) => void
  depth: number
}

const RecordStackContext = React.createContext<RecordStackContextValue | null>(null)

/** Provided by `BaseEntityDrawer` around its frame stack. */
export function RecordStackProvider({
  value,
  children,
}: {
  value: RecordStackContextValue
  children: React.ReactNode
}) {
  return <RecordStackContext.Provider value={value}>{children}</RecordStackContext.Provider>
}

/**
 * Context-aware "open this related record" hook (decision #8) — one call-site
 * convention for every related-record affordance. Inside a `RecordStackProvider`
 * (a drawer's frame stack) → returns `push`, so clicking a related-record row
 * drills into it in place. Outside one → `null`, so the caller falls back to
 * its existing href/`router.push` navigation.
 */
export function useOpenRecord(): ((recordId: RecordId) => void) | null {
  const ctx = React.useContext(RecordStackContext)
  return ctx?.push ?? null
}
