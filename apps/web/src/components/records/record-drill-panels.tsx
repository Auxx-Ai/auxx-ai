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
import { useRecord } from '~/components/resources'

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
  /** Capability required to mount this query-owning drill panel. */
  permissionKey?: string
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
const InvoiceDetailPanel = dynamic(
  () => import('../money/ui/invoice/invoice-detail-panel').then((m) => m.InvoiceDetailPanel),
  { ssr: false, loading: DRILL_LOADING }
)
const CreditMemoDetailPanel = dynamic(
  () =>
    import('../money/ui/credit-memo/credit-memo-detail-panel').then((m) => m.CreditMemoDetailPanel),
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

/** Nav-bar title for the `invoices` drill — the invoice's own `displayName`
 * (its invoice number) once loaded, falling back to the generic label. */
function InvoiceDrillBar({ itemId }: { itemId: string | null }) {
  const invoiceRecordId = itemId as RecordId | null
  const { record } = useRecord({ recordId: invoiceRecordId, enabled: Boolean(itemId) })
  return <DrillBackBar title={record?.displayName ?? 'Invoice'} />
}

/** Nav-bar title for the `credit-memos` drill — the memo's own `displayName`
 * (its CM number) once loaded, falling back to the generic label. */
function CreditMemoDrillBar({ itemId }: { itemId: string | null }) {
  const creditMemoRecordId = itemId as RecordId | null
  const { record } = useRecord({ recordId: creditMemoRecordId, enabled: Boolean(itemId) })
  return <DrillBackBar title={record?.displayName ?? 'Credit memo'} />
}

/**
 * The `credit-memos` drill (plans/accounting/tasks/done/10-credit-memos.md §6.1):
 * single-level like `invoices`, so a Credit memos card on a DETAIL PAGE (order,
 * contact) can `open('credit-memos', recordId)` straight into the memo. Inside a
 * drawer the same card uses `useOpenRecord` and pushes a peek frame instead.
 */
const CREDIT_MEMOS_DRILL: RecordDrillPanel = {
  value: 'credit-memos',
  permissionKey: 'dispatch.board.view',
  bar: (ctx: RecordDrillContext) => <CreditMemoDrillBar itemId={ctx.itemId} />,
  render: (ctx) => <CreditMemoDetailPanel {...ctx} />,
}

const RECORD_DRILL_PANELS: Record<string, RecordDrillPanel[]> = {
  order: [CREDIT_MEMOS_DRILL],
  contact: [CREDIT_MEMOS_DRILL],
  work_order: [
    {
      value: 'visits',
      permissionKey: 'dispatch.board.view',
      bar: (ctx: RecordDrillContext) => <DrillBackBar title={ctx.itemId ? 'Visit' : 'Visits'} />,
      render: (ctx) => <VisitsListPanel {...ctx} />,
      renderItem: (ctx) => <VisitDetailPanel {...ctx} />,
    },
    {
      // Single-level on purpose (no list panel — surfaces list invoices themselves
      // and drill straight in): `render` reads the drilled invoice off ctx.itemId,
      // so `open('invoices', recordId)` always lands a two-level stack.
      value: 'invoices',
      permissionKey: 'dispatch.board.view',
      bar: (ctx: RecordDrillContext) => <InvoiceDrillBar itemId={ctx.itemId} />,
      render: (ctx) => <InvoiceDetailPanel {...ctx} />,
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

/**
 * A frame of a drawer peek stack: a record, or one of the ledger's two
 * table-backed detail frames (83 §2.4).
 *
 * The `~` prefix cannot open a `RecordId` (`<entityDefinitionId>:<instanceId>`,
 * always a slug or a cuid), so `frameKind` can never misread one.
 */
export type DrawerFrame =
  | RecordId
  | `~posting:${string}`
  | `~movement:${string}`
  | `~shipment:${string}`
  | `~summary:${string}`

/** The ledger frames a `DrawerFrame` stack can hold beside records. */
export type LedgerFrameKind = 'posting' | 'movement' | 'shipment' | 'summary'

/** Encode a ledger frame for a `DrawerFrame` stack. */
export function toFrame(kind: LedgerFrameKind, id: string): DrawerFrame {
  return `~${kind}:${id}` as DrawerFrame
}

/** Decode a `DrawerFrame`; anything without a ledger prefix is a `RecordId`. */
export function frameKind(
  frame: string
): { kind: 'record'; recordId: RecordId } | { kind: LedgerFrameKind; id: string } {
  for (const kind of ['posting', 'movement', 'shipment', 'summary'] as const) {
    const prefix = `~${kind}:`
    if (frame.startsWith(prefix)) return { kind, id: frame.slice(prefix.length) }
  }
  return { kind: 'record', recordId: frame as RecordId }
}

/** `useRecordPeekStack`'s return shape. */
export interface RecordPeekStack<F extends string = RecordId> {
  /** `[base, ...peek]` — the full stack of frames, base first, top last. */
  frames: F[]
  /** `frames[frames.length - 1]` — the frame currently on top. */
  top: F | null
  /** `frames.length`. */
  depth: number
  /** Push a frame onto the stack. Already-present (incl. the base) → truncate back to it. */
  push: (frame: F, options?: PushFrameOptions) => void
  /** Drop the top peek frame. No-op at depth 1 (base only). */
  pop: () => void
  /** Empty the peek stack entirely. */
  clear: () => void
}

/** Options for a peek-stack push. `tab` lands the pushed frame on that tab instead of its default. */
export interface PushFrameOptions {
  tab?: string
}

/** `useRecordPeekStack`'s options. */
export interface RecordPeekStackOptions {
  /** The nuqs array param the stack lives on. For a page that hosts two stacks. */
  paramKey?: string
}

const DrawerTabParamContext = React.createContext<string>('tab')

/**
 * Overrides the nuqs param a drawer frame keeps its active tab in, for a host
 * page that already owns `?tab=` for something else (the Outbox's tab strip).
 */
export function DrawerTabParamProvider({
  value,
  children,
}: {
  value: string
  children: React.ReactNode
}) {
  return <DrawerTabParamContext.Provider value={value}>{children}</DrawerTabParamContext.Provider>
}

/** The nuqs param key for a drawer frame's active tab — `'tab'` by default. */
export function useDrawerTabParam(): string {
  return React.useContext(DrawerTabParamContext)
}

/**
 * Cross-record "peek" stack over a record surface's `?peek=` nuqs array param
 * (dispatch v4/04 §1.1) — the layer ABOVE `useRecordDrillStack`: each frame in
 * the stack is a full drawer body for one record (its own header, tabs,
 * overview cards) and owns its own `panel`/`item` drill independently. The
 * base record stays the host's own param (`?record=`/`?id=`); this hook only
 * owns `peek`, so a host needs zero changes to adopt it.
 *
 * Push/pop/clear all write `peek` AND clear the frame tab param/`panel`/`item` in the SAME
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
export function useRecordPeekStack<F extends string = RecordId>(
  base: F | null,
  options?: RecordPeekStackOptions
): RecordPeekStack<F> {
  const paramKey = options?.paramKey ?? 'peek'
  const tabParam = useDrawerTabParam()

  const keyMap = React.useMemo(
    () => ({
      [paramKey]: parseAsArrayOf(parseAsString),
      [tabParam]: parseAsString,
      panel: parseAsString,
      item: parseAsString,
    }),
    [paramKey, tabParam]
  )
  const [state, setState] = useQueryStates(keyMap)
  const peek = state[paramKey] as string[] | null

  const prevBaseRef = React.useRef(base)
  const peekStaleRef = React.useRef(false)
  if (prevBaseRef.current !== base) {
    if (prevBaseRef.current !== null && base !== null) peekStaleRef.current = true
    prevBaseRef.current = base
  }
  if (!peek || peek.length === 0) peekStaleRef.current = false
  const livePeek = peekStaleRef.current ? null : peek

  const frames = React.useMemo<F[]>(() => {
    if (!base) return []
    return [base, ...((livePeek ?? []) as F[])]
  }, [base, livePeek])

  const depth = frames.length
  const top = frames[depth - 1] ?? null

  const write = React.useCallback(
    (nextPeek: F[], tab?: string) => {
      void setState({
        [paramKey]: nextPeek.length > 0 ? nextPeek : null,
        [tabParam]: tab ?? null,
        panel: null,
        item: null,
      })
    },
    [paramKey, tabParam, setState]
  )

  const push = React.useCallback(
    (frame: F, options?: PushFrameOptions) => {
      const existingIndex = frames.indexOf(frame)
      // Already on the stack (including the base, index 0) — truncate back to
      // it instead of appending a duplicate (decision #6, kills SR→QT→SR cycles).
      write(
        existingIndex >= 0 ? frames.slice(1, existingIndex + 1) : [...frames.slice(1), frame],
        options?.tab
      )
    },
    [frames, write]
  )

  const pop = React.useCallback(() => {
    if (depth <= 1) return
    write(frames.slice(1, -1))
  }, [depth, frames, write])

  const clear = React.useCallback(() => write([]), [write])

  return { frames, top, depth, push, pop, clear }
}

/** Context handed down by `RecordStackProvider` — `push`+`depth` from the
 * enclosing `useRecordPeekStack`, so any nested card/row can push a related
 * record onto the stack without prop-threading. */
interface RecordStackContextValue {
  push: (frame: DrawerFrame, options?: PushFrameOptions) => void
  depth: number
}

const RecordStackContext = React.createContext<RecordStackContextValue | null>(null)

/**
 * Provided by a drawer host around its frame stack (`BaseEntityDrawer`,
 * `LedgerDrawerHost`).
 *
 * Generic in the host's frame type so a `RecordId`-only stack can still be
 * handed in: the stored `push` is contravariant, hence the one cast.
 */
export function RecordStackProvider<F extends string>({
  value,
  children,
}: {
  value: { push: (frame: F, options?: PushFrameOptions) => void; depth: number }
  children: React.ReactNode
}) {
  const ctx = value as RecordStackContextValue
  return <RecordStackContext.Provider value={ctx}>{children}</RecordStackContext.Provider>
}

/**
 * Context-aware "open this related record" hook (decision #8) — one call-site
 * convention for every related-record affordance. Inside a `RecordStackProvider`
 * (a drawer's frame stack) → returns `push`, so clicking a related-record row
 * drills into it in place. Outside one → `null`, so the caller falls back to
 * its existing href/`router.push` navigation.
 */
export function useOpenRecord(): ((frame: DrawerFrame, options?: PushFrameOptions) => void) | null {
  const ctx = React.useContext(RecordStackContext)
  return ctx?.push ?? null
}

/**
 * `onClick` for a record LINK (`RecordBadge`, `RecordLink`) that should push a
 * peek frame instead of navigating — the opt-in half of `useOpenRecord`.
 *
 * Two gates, both required. `enabled` is the call site's explicit opt-in, so
 * adopting this never changes a link the author did not convert; the
 * `RecordStackProvider` check then keeps the same component honest on surfaces
 * with no stack to push onto (the detail page's sidebar mounts several of the
 * very same cards), where it degrades to the plain link it always was.
 *
 * Modifier and non-primary clicks always fall through to the browser, so the
 * element stays a real `<a href>` and cmd-/middle-click still opens a tab.
 */
export function useOpenRecordLinkClick(
  recordId: RecordId | null | undefined,
  enabled: boolean | undefined,
  tab?: string
): ((event: React.MouseEvent) => void) | undefined {
  const openRecord = useOpenRecord()
  const push = enabled ? openRecord : null

  return React.useMemo(() => {
    if (!push || !recordId) return undefined
    return (event: React.MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return
      }
      event.preventDefault()
      push(recordId, tab ? { tab } : undefined)
    }
  }, [push, recordId, tab])
}
