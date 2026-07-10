# UI Design Guide

This is the source of truth for how `apps/web` UI is composed. It documents the
shared primitives in `@auxx/ui` (and a few `apps/web/src/components/global`
wrappers) so agent-generated UI is consistent instead of each file inventing
its own layout, spacing, and card shape.

**Rule: before building a settings page, detail page, dialog, or tree list,
check this doc for the matching primitive. Don't hand-roll a card, a dialog
header, or a form row that already has a primitive below.**

Reference implementations to read when in doubt:
- Detail page (tabs + docked chat): `apps/web/src/components/agents/ui/detail/agent-detail-view.tsx`, `agent-detail-tabs.tsx`
- Settings list page: `apps/web/src/app/(protected)/app/settings/webhooks/page.tsx`
- Multi-page dialog: `apps/web/src/components/webhooks/ui/webhook-endpoint-dialog.tsx`
- Form panel: any `FieldPanel`/`FieldPanelRow` usage, e.g. part forms
- Tree list: `TreeRow`/`TreeRowButton` usage in the agent tools/knowledge sections, webhook topics editor

---

## 1. Page shell: `MainPage`

Full-page app views (not settings — see §3) use `@auxx/ui/components/main-page`:

```tsx
import {
  MainPage, MainPageHeader, MainPageBreadcrumb, MainPageBreadcrumbItem, MainPageContent,
} from '@auxx/ui/components/main-page'

<MainPage>
  <MainPageHeader action={<div className='flex items-center gap-2'>...</div>}>
    <MainPageBreadcrumb>
      <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
      <MainPageBreadcrumbItem title='Agents' href='/app/agents' />
    </MainPageBreadcrumb>
  </MainPageHeader>

  <MainPageContent dockedPanels={isDesktop ? [{ key: 'chat', content: <Chat />, width, onWidthChange, minWidth, maxWidth }] : []}>
    {children}
  </MainPageContent>
</MainPage>
```

- `MainPageHeader` — the top bar: breadcrumb on the left, `action` slot on the right (buttons, autosave indicator).
- `MainPageBreadcrumb` / `MainPageBreadcrumbItem` — standard breadcrumb trail. Use `MainPageBreadcrumbDropdown` for an in-place entity switcher (e.g. picking a different agent without leaving the page).
- `MainPageContent` — the body. Supports `dockedPanels` (right side, resizable, animated in/out) and `leftPanels`. Gate docked panels on `useMedia('(min-width: 1024px)')` — they collapse to nothing on mobile, don't try to reflow them.
- Docked panel width state belongs in a Zustand store (`useDockStore` pattern) so it persists across remounts, not local `useState`.

## 2. Scrollable body + sections: `ScrollArea` + `Section`

Inside `MainPageContent`, a scrollable single-column body uses `ScrollArea` from `@auxx/ui/components/scroll-area`, and each block inside it is a `Section` from `@auxx/ui/components/section`:

```tsx
<ScrollArea viewportRef={scrollContainerRef} className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
  <div ref={assignRef('prompt')}>
    <Section title='Prompt' icon={<FileText className='size-4' />} initialOpen collapsible={false}>
      <PersonaEditor ... />
    </Section>
  </div>
  ...
  <div className='h-[40vh]' /> {/* spacer so the last section can scroll to the top */}
</ScrollArea>
```

- `Section` is collapsible by default (`collapsible={false}` to pin it open, e.g. for a tabbed page where the "section" is really just a titled block). Supports `actions` (top-right slot — a button/dropdown), `showEnable` (a switch that gates the body), and `description` (tooltip explanation next to the title).
- `EmptySection` (also in `section.tsx`) is the standard "nothing here yet" placeholder inside a section body — centered icon/title/description or a spinner via `loading`.
- Wire up scroll-spy (tab strip synced to which section is in view) with `useScrollSpy` (`~/hooks/use-scroll-spy`) — `assignRef('sectionKey')` on each wrapper div, `scrollToSection` to jump on tab click. See `agent-detail-tabs.tsx` for the full wiring including a `remountKey` to rebind after a nested nav-stack panel remounts the scroll container.

## 3. Drill-down navigation: `NavStack`

For "one page, multiple drill levels sharing a tab strip" (e.g. agent detail → procedure → procedure sub-drill), use `@auxx/ui/components/nav-stack`. This is an iOS-style push/pop stack with parallax slide animation, **not** a router — the stack is just string keys, driven by whatever state you like (commonly `nuqs` query params so drill state survives refresh/back).

```tsx
<NavStack
  stack={stack}                 // e.g. ['root'] | ['root','procedure'] | ['root','procedure','drill']
  onStackChange={(next) => { /* clear the query params that pushed levels beyond next.length */ }}
  className='flex flex-col flex-1 min-h-0'>
  <NavStackBar className='shrink-0 border-b bg-primary-150' />
  <NavStackPanels className='flex-1 min-h-0'>
    <NavStackPanel value='root' className='h-full bg-neutral-100 dark:bg-background' bar={<Tabs>...</Tabs>}>
      <ScrollArea ...>...</ScrollArea>
    </NavStackPanel>
    <NavStackPanel value='procedure' bar={detailBar}>
      <ScrollArea ...>...</ScrollArea>
    </NavStackPanel>
  </NavStackPanels>
</NavStack>
```

- `NavStackBar` renders the **active panel's `bar` prop**, cross-animated — it lives outside `NavStackPanels` (which clips overflow) so a bar can't get clipped or scroll away. Never put a `position: sticky` bar inside a panel's children for this reason.
- Each `NavStackPanel` owns its own scroll (wrap its children in its own `ScrollArea`) — don't rely on one outer page scroll, especially if a drilled panel needs full-height internal scroll (e.g. a code editor).
- State that must survive switching between stack levels (e.g. a draft/autosave provider) goes **above** `<NavStack>`, keyed by the relevant id + a reload token, not inside a panel.

## 4. Settings pages: `SettingsPage` + `SettingsSection` + `ListCard` placeholders

Settings routes (`apps/web/src/app/(protected)/app/settings/**`) do **not** use `MainPage` — they use `SettingsPage`/`SettingsSection` from `~/components/global/settings-page`:

```tsx
export default function WebhooksPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.webhooks)) {
    return (
      <SettingsPage
        title='Webhooks'
        description='Manage webhooks to integrate with external services.'
        breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Webhooks' }]}>
        <EmptyState icon={Lock} title='Webhooks Not Available' description='Upgrade your plan to use webhooks.' button={<div className='h-12' />} />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage
      title='Webhooks'
      description='Send Auxx events to external services when something happens.'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Webhooks' }]}>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <WebhooksSection />
        <WebhookEndpointsSection />
      </div>
    </SettingsPage>
  )
}
```

- `SettingsPage` is the scroll container + sticky header (icon/title/description/breadcrumbs, optional `subHeader` for a tab strip, optional `button` top-right action). It handles the scroll-shadow-on-scroll effect itself — don't reimplement it.
- Gate admin-only settings pages with `useUser({ requireRoles: [...] })` at the top, and gate paid features with `useFeatureFlags().hasAccess(FeatureKey.x)` — render an `EmptyState` (`~/components/global/empty-state`) with a lock icon when the org doesn't have access, don't just hide the page.
- Body content is stacked `SettingsSection`s (`icon`, `title`, `description`, right-aligned `action`) inside a `flex flex-col gap-8 p-3 sm:p-6` wrapper — one section per logical group (e.g. "Webhooks" config + "Webhook Endpoints" list as two sections on one page).
- **Empty/add-new tiles in a settings grid use `ListCard` with `variant='placeholder'`**, not a bespoke dashed box:

```tsx
<ListCard
  variant='placeholder'
  classNames={{ icon: 'border-dashed' }}
  icon={icon}
  title={title}
  subtitle={subtitle}
  description={description}
  onClick={onClick}
/>
```

  This is the same `ListCard` used for real rows in the grid (apps, connections, webhooks, datasets, agents, workflows, connectors) — a real card just omits `variant='placeholder'` and adds `status`, `badges`, `menuItems`, etc. Keep placeholder and real cards visually identical in shape so an empty grid reads as "click here to add," not a different component. See `~/components/webhooks/ui/webhook-placeholder-card.tsx` for the thin wrapper pattern (a named component per feature that pins the icon/copy, not a new visual style).

## 5. Forms: `FieldPanel` + `FieldPanelRow` + `FieldInputAdapter`

Most dialogs/forms — anywhere you're collecting several labeled fields — use `FieldPanel`/`FieldPanelRow` (`~/components/global/forms/field-panel`), a bordered, rounded panel of label/content rows with a draggable label-column divider:

```tsx
<FieldPanel
  orientation='responsive'
  breakpoint='md'
  resizeId='part-form'
  defaultLabelWidth={200}
  className='p-0'>
  <FieldPanelRow
    title='Title'
    type={BaseType.STRING}
    showIcon
    isRequired
    validationError={errors.title}
    validationType='error'>
    <FieldInputAdapter
      fieldType={FieldType.TEXT}
      value={values.title}
      onChange={(val) => handleChange('title', val)}
      placeholder='Part name'
      disabled={isPending}
    />
  </FieldPanelRow>
  {/* more FieldPanelRows */}
</FieldPanel>
```

- `orientation`: `'horizontal'` (label always left), `'vertical'` (label always stacked above), or `'responsive'` (stacks on narrow containers, goes horizontal past `breakpoint` — `'sm'` or `'md'` container width). Default to `'responsive'` for dialogs that can be narrow.
- `resizeId` — give every panel on the same logical form (e.g. all panels in one dialog) the **same** `resizeId` so the label-column width drags together and persists (localStorage) across mounts. Different forms should use different, form-specific ids (`'part-form'`, not a shared generic one) so their columns don't fight each other.
- `defaultLabelWidth` — tune per form based on the longest label; default is 160px.
- `FieldPanelRow` — one labeled row. `type` (a `BaseType`) drives the auto icon via `showIcon`; pass an explicit `icon` to override. `isRequired` adds the red asterisk. `validationError`/`validationType` render the inline error/warning badge. `onClear` adds a hover-revealed clear button.
- **All actual input widgets go through `FieldInputAdapter`** (`~/components/fields/inputs/field-input-adapter`), never a raw `<Input>`/`<Select>` inside a `FieldPanelRow`. Pass `fieldType={FieldType.X}` (the `@auxx/database/enums` `FieldType`) and `fieldOptions` for that field type's config (select options, currency code, relationship config, etc.) — the adapter switches on `fieldType` to render the right control (text, number, date, boolean, currency, phone, address, select/multi-select, relationship pickers, actor/participant pickers, file). This is what keeps every custom-field-shaped input — forms, filters, workflow nodes — visually and behaviorally identical.

## 6. Multi-page dialogs: `DialogNav` + `DialogNavPages`

Any dialog with more than one "screen" (configure → confirm/reveal → drill into a sub-page) uses `DialogNav`/`DialogNavPages` (`@auxx/ui/components/dialog-nav`) inside a `Dialog`/`DialogContent`, not ad-hoc conditional rendering with a hand-rolled header:

```tsx
<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
  <DialogContent size='content' position='tc' innerClassName='p-0'>
    <DialogNav
      title='Edit webhook endpoint'
      description='Receive events from any system at a generated URL.'
      onBack={page === 'topics' ? () => setPage('configure') : undefined}
      crumbs={[
        { label: endpoint.name, onClick: page !== 'configure' ? () => setPage('configure') : undefined },
        ...(page === 'created' ? [{ label: revealed?.title ?? 'Updated' }] : []),
        ...(page === 'topics' ? [{ label: 'Topics' }] : []),
      ]}
    />
    <DialogNavPages value={page}>
      <DialogNavPage value='configure' size='md'>...</DialogNavPage>
      <DialogNavPage value='created' size='md'>...</DialogNavPage>
      <DialogNavPage value='topics' size='md'>...</DialogNavPage>
    </DialogNavPages>
  </DialogContent>
</Dialog>
```

- `page` state is a plain `useState` (`'configure' | 'created' | 'topics'`) owned by the dialog, reset in a `useEffect` keyed on `open`/the entity id — dialogs don't carry stale page state into a fresh open.
- `DialogContent size='content' innerClassName='p-0'` is required for `DialogNavPages` to own the width/height animation — the shell must not impose its own padding/size, `DialogNavPages` measures and springs to each page's declared `size`.
- `crumbs` — the last crumb (or the one marked `active`) is the current, non-interactive page; earlier crumbs are clickable jumps back. `onBack` only renders a literal "‹ Back" button — use it for a strict linear step, use `crumbs` clicks for jumping across a shallow hierarchy (as above, jumping from `topics` straight back to the named entity).
- New-entity flows go through a separate template/gallery dialog that reuses the same form component (`mode='create'` vs `mode='edit'`), not a fourth page bolted onto the edit dialog.

### Dialog footer: Cancel / Submit with `Kbd` hints

Almost every dialog (single-page or `DialogNav`) ends its form with the same two-button `DialogFooter` — Cancel on the left as a ghost button with an Esc hint, primary action on the right as an outline button with a Cmd/Ctrl+Enter hint. See `edit-name-dialog.tsx` (settings/general), `part-form-dialog.tsx` (manufacturing/parts), or `tag-dialog.tsx` (tags — a variant with a third "Close" button) for real usage:

```tsx
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'

<DialogFooter>
  <Button
    type='button'
    variant='ghost'
    size='sm'
    onClick={() => onOpenChange(false)}
    disabled={isPending}>
    Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
  </Button>
  <Button
    onClick={handleSubmit}
    variant='outline'
    size='sm'
    loading={isPending}
    loadingText={isEditMode ? 'Updating...' : 'Creating...'}
    disabled={!partDefId}
    data-dialog-submit>
    {isEditMode ? 'Update Part' : 'Create Part'} <KbdSubmit variant='outline' size='sm' />
  </Button>
</DialogFooter>
```

- `Kbd`/`KbdSubmit` from `@auxx/ui/components/kbd`. Cancel gets `<Kbd shortcut='esc' variant='ghost' size='sm' />`; submit gets `<KbdSubmit variant='outline' size='sm' />` (renders Cmd+Enter on Mac, Ctrl+Enter elsewhere via `isMac()`). Match each `Kbd`'s `variant`/`size` to its button's `variant`/`size` — `ghost`/`sm` on Cancel, `outline`/`sm` on submit.
- Cancel is always `variant='ghost'`, submit is always `variant='outline'` — both `size='sm'`. Don't use `variant='default'`/solid-fill buttons in a dialog footer.
- `data-dialog-submit` on the submit button (not `type='submit'` unless it's inside a real `<form>`) is required — `DialogContent` listens for Cmd/Ctrl+Enter anywhere in the dialog and click-triggers whichever element matches `[data-dialog-submit]:not(:disabled), button[type="submit"]:not(:disabled)`. Without it (or a real submit-typed button), Cmd/Enter silently does nothing.
- Submit's `disabled`/`loading`/`loadingText` drive both the Esc-hint-less button state and the Cmd+Enter guard (`:not(:disabled)`) — don't add a separate `isPending` check in the click handler, the button's own disabled state is sufficient.
- Cancel's `onClick` closes the dialog (`onOpenChange(false)`); it does not need `data-dialog-submit` — Esc is handled globally by Radix `Dialog`, the `Kbd` there is a visual hint only.

## 7. Tree lists: `TreeRow` / `TreeRowButton` / `GridTreeRow`

Any indented, expandable, connector-lined list (agent tools tree, knowledge resource scope, webhook topics, data-connector mapping editor) uses `TreeRow` (or `GridTreeRow` for a column-aligned variant) from `@auxx/ui/components/tree-row`, not a hand-rolled `<div>` list with manual indentation:

```tsx
<TreeRow
  icon={<Tags className='size-4' />}
  isOpen={selectedId === topic.id}
  onToggleOpen={() => select(topic.id)}
  rowClassName={selectedId === topic.id ? 'bg-primary-100 hover:bg-primary-150' : 'bg-primary-50 hover:bg-primary-100'}
  title={
    <AutosizeInput
      value={topic.key}
      onChange={(e) => patchTopic(topic.id, { key: e.target.value })}
      onClick={(e) => e.stopPropagation()}
      placeholder='topic.key'
      inputClassName='bg-transparent text-sm text-foreground outline-none'
      minWidth={40}
    />
  }
  secondary={<span className='...'>{badge.label}</span>}
  actions={
    <TreeRowButton variant='destructive' tooltipText='Delete topic' onClick={() => void deleteTopic(topic)}>
      <Trash2 />
    </TreeRowButton>
  }
/>
```

- `title` accepts any `ReactNode` — an inline-editable `AutosizeInput`, not just static text, is a common pattern for "click to rename" rows. Always `e.stopPropagation()` on inner interactive elements so they don't trigger the row's own `onToggleOpen`.
- `onToggleOpen` alone (without `expandable`) makes the whole row clickable without a chevron — use this for "click row to select/open a detail panel" (as above); pass `expandable` too when the row should also expand inline children.
- `secondary` is small trailing text next to the title (a status badge, a type label); `actions` is the right-side hover-revealed cluster — always build actions from `TreeRowButton` (handles hover-fade, sizing, tooltip side) rather than a raw icon `Button`.
- `chevronOnHover` swaps the leading icon for the expand chevron on hover instead of adding a trailing chevron — use for dense trees where a second chevron column would waste space.
- `depth` indents one level (`~1.5rem` each); nested rows go in `children` and get the connector line automatically via `BaseTreeRow`.
- Use `GridTreeRow` instead of `TreeRow` when later columns (an arrow, a target picker, an actions cluster) need to line up at a fixed x regardless of nesting depth — `TreeRow`'s indent shifts the whole row, `GridTreeRow`'s indent lives only in the first cell.

## 8. Toast, buttons, delete confirmation

(Already in `CLAUDE.md` — repeated here since they're part of the same "don't reinvent" list.)

- Errors only, via `toastError` from `@auxx/ui/components/toast` — no success toasts.
- Loading buttons: `<Button loading={isPending} loadingText='Connecting...'>`. Icon-only buttons never get a manual size className — `Button` sizes the icon.
- Destructive confirmations go through `useConfirm()` (`~/hooks/use-confirm`), not a hand-rolled `AlertDialog`.

---

## 9. Empty states: `EmptyState`

Used for ~29 feature areas' "no data yet" / "no results" body — the single-state
version of §4's `ListCard` placeholder (which is for a grid tile, not a whole
page/section body). `apps/web/src/components/global/empty-state.tsx`:

```tsx
<EmptyState
  icon={Bot}
  title='No agents yet'
  description='Create an agent to delegate work to AI.'
  button={<CreateAgentButton />}
/>
```

- Centers itself in whatever flex container it's placed in (`flex-1 items-center justify-center`) — drop it directly into a `Section`/`SettingsSection` body or a page body, no extra wrapper needed.
- `icon` is a bare component reference (`Bot`, not `<Bot />`) — it gets sized/muted automatically.
- `button` is the call-to-action slot (usually the same "create" button used elsewhere on the page) — omit it for a pure filtered-empty state ("No results match your filters") vs. a first-run empty state that invites creation.

## 10. Picker inputs: `PickerTrigger`

The shared trigger button behind every picker-style field — relation pickers, actor/participant pickers, date-time picker, resource picker, condition operand inputs. This is the piece `FieldInputAdapter` (§5) delegates to for anything that opens a popover/dropdown rather than being a plain text/number input. `apps/web/src/components/ui/picker-trigger.tsx`:

```tsx
<PickerTrigger hasValue={!!value} placeholder='Select record...' onClear={handleClear} showClear>
  {selectedLabel}
</PickerTrigger>
```

- `hasValue` switches between rendering `children` (the selected value's display) and the muted `placeholder` text — always pass it explicitly, don't infer it from `children` truthiness inside the trigger.
- `showClear` + `onClear` renders the small round clear-x before the chevron, only when `hasValue`.
- `PickerTriggerOptions` (the subset of these props: `variant`, `size`, `icon`, `iconPosition`, `hideIcon`, `badgeSize`, etc.) is what `FieldInputAdapter`'s `triggerProps` forwards — when building a new picker-backed field type, accept `PickerTriggerOptions` rather than inventing new trigger customization props.
- Building a brand-new picker (a new popover-based selector)? Compose it from `PickerTrigger` + your popover body, don't style a bare `<Button>` to look like one — that's how trigger styling drifts from the rest of the pickers.

## 11. Route/section loading: `LoadingSpinner` / `LoadingContent`

`apps/web/src/components/global/loading-content.tsx` has two distinct jobs — don't conflate them:

- **`LoadingSpinner`** — the body of a Next.js route-level `loading.tsx` (App Router's automatic Suspense fallback). One line, no props:
  ```tsx
  // app/(protected)/app/calls/loading.tsx
  import { LoadingSpinner } from '~/components/global/loading-content'
  export default function Loading() { return <LoadingSpinner /> }
  ```
  It's an `absolute inset-0` centered spinner — the route segment it fills must be a positioned/sized container (it relies on the route layout, not on its own size).
- **`LoadingContent`** — an inline conditional swap for a fetched region *within* an already-rendered page (not a full route transition): pass `loading`/`error` and it swaps `children` for a small inline spinner or an error line. Use this for a section/panel that loads after the page shell is already up; use `LoadingSpinner` (via `loading.tsx`) for the page/route-level transition itself.
- Neither of these is `ListCard`'s `loading` prop (§4) or `StatCards`' `loading` prop (§13) — those render a skeleton shaped like the real content, for lists/grids where layout shift matters. Reach for those instead of a spinner when you're loading a known shape (a card grid, a stat row); reach for `LoadingSpinner`/`LoadingContent` when you're loading an unknown-shape region or a whole route.

## 12. List page toolbar: `ListToolbar` / `ListToolbarGroup`

The canonical sticky filter/search row above a list/grid page (`packages/ui/src/components/list-toolbar.tsx`, self-documented in its own header comment as "canonical"):

```tsx
<ListToolbar>
  <ListToolbarGroup>{filters}</ListToolbarGroup>
  <InputSearch ... />
  <ListToolbarGroup align='end'>{viewToggles}</ListToolbarGroup>
</ListToolbar>
```

- `ListToolbar` folds the sticky (`sticky top-0 z-10`) + `backdrop-blur-sm` + bordered-bar wrapping into one component — don't hand-roll this positioning again for a new list page.
- Compose its children as `ListToolbarGroup`s (clusters of controls) with a bare `InputSearch` in between — the search field is naturally `flex-1` and doesn't need its own group.
- `align='end'` on a `ListToolbarGroup` self-pins that group (and anything after it in source order) to the right via `ml-auto` — put right-aligned controls (view toggles, sort) in an `align='end'` group rather than manually spacing them.
- Set `sticky={false}` only when the toolbar is already inside another sticky/fixed ancestor (avoid double-sticky stacking).

## 13. Detail side panels: `DockableDrawer`

The sanctioned primitive for an entity-detail side panel that can either float as an overlay or dock inline next to the main content (`packages/ui/src/components/dockable-drawer.tsx`) — used across admin, workflows, participants, config, health, datasets, and workflow run/property/settings panels. **Reach for this instead of a raw `Drawer`/`Sheet` whenever the panel needs the docked-vs-floating duality** (most entity detail panels do, once the page is wide enough to dock).

```tsx
<DockableDrawer
  open={open}
  onOpenChange={setOpen}
  isDocked={isDocked}
  width={width}
  onWidthChange={setWidth}
  minWidth={350}
  maxWidth={800}>
  {content}
</DockableDrawer>
```

- `isDocked` (typically derived from a breakpoint, e.g. `useMedia('(min-width: 1024px)')`, or a user toggle) switches between: portaling `children` into a `portalTarget` ref (preserves React context — use this when the docked slot lives in a different part of the tree, e.g. `MainPageContent`'s `dockedPanels`), rendering `children` directly if no `portalTarget`, or falling back to a floating Vaul `Drawer` when not docked.
- Width/resize state (`width`, `onWidthChange`, `minWidth`, `maxWidth`) is the same shape as `MainPageContent`'s `DockedPanelConfig` (§1) — when a `DockableDrawer` docks into a `MainPageContent` panel slot, thread the same width state through both rather than keeping two sources of truth.
- Inside the drawer's content, `useDockableDrawer()` exposes `isDocked`/`width`/etc. to descendants that need to adapt their own layout to docked vs. floating mode.

## 14. Field/relation-path breadcrumbs: `SmartBreadcrumb`

A width-aware, auto-collapsing breadcrumb for showing a *path* (a field's location through nested relations, a resource's path) — distinct from `MainPageBreadcrumb` (§1, page navigation) and `AgentBreadcrumbSwitcher`-style entity switchers. Used in dynamic-table header cells, the data-import column mapping UI, the resource field-badge, and the conditions field selector. `packages/ui/src/components/smart-breadcrumb.tsx`:

```tsx
<SmartBreadcrumb segments={breadcrumbSegments} mode='display' size='sm' />
```

- `segments: BreadcrumbSegment[]` — `{ id, label, icon?, href?, onClick?, disabled? }`. `mode` controls interactivity: `'display'` (plain text path, e.g. inside a badge/cell — most common), `'clickable'` (segments navigate), `'dropdown'` (collapsed middle segments become a `DropdownMenu` rather than just being hidden).
- It measures actual text width against the container and water-fills space across segments, collapsing middle segments behind an ellipsis only when the full path doesn't fit — don't reach for manual `truncate`/`line-clamp` on a path string, this component exists specifically because naive truncation looks wrong on multi-segment paths (it prioritizes keeping the first and last segment visible).
- Use `mode='display'` by default; only switch to `'clickable'`/`'dropdown'` when the path segments are genuinely navigable destinations (not just descriptive labels).

## 15. Dashboard metrics row: `StatCard` / `StatCards`

The standard header-metrics strip for dashboard/detail pages — used on admin user/org detail pages, the ticket dashboard, workflow/task/dataset stats rows, and the AI usage dialog. `packages/ui/src/components/stat-card.tsx`:

```tsx
const cards: StatCardData[] = [
  { title: 'Open', body: openCount, icon: <CircleDot />, description: 'Currently open' },
  { title: 'Closed today', body: closedToday },
]
return <StatCards cards={cards} loading={!stats} />
```

- `StatCards` is a responsive grid (`md:grid-cols-4` by default, override via `columns`) that becomes a horizontal-scroll-snap row on mobile (two cards visible, snap-to-card) — this is why you pass the whole `cards` array to `StatCards` rather than laying out individual `StatCard`s yourself in a `grid`/`flex`.
- `loading` on `StatCards` renders a skeleton for every card, matching the real layout's shape — pass it directly from your query's `isLoading`, don't conditionally render the whole row.
- Each card's left border is automatic (`first` suppresses it on the first card) — don't add manual dividers between cards.
- There is a second, unrelated `stat-card.tsx` in `apps/homepage` for the marketing site — don't confuse the two; this entry is about the `packages/ui`/`apps/web` one.

## 16. Help / quick-start dialogs: `GuideDialog`

The shared shell for read-only "quick start" / help-sheet dialogs — built on `DialogNav`/`DialogNavPages` (§6), so it inherits the same crumb/back/paging model. Self-documented in its own header comment as "the shared look for read-only quick-start/help-sheet dialogs." Used by agent detail (`AgentGuideDialog`), data-connector stream setup, mail permissions, and the dynamic-table records guide — an emerging but deliberate convention, reach for it over a bespoke help overlay.

```tsx
<GuideDialog open={open} onOpenChange={setOpen} title='Mapping quick start'>
  <GuideColumns>
    <GuideColumn title='Keys'>
      <GuideConcept glyph={<KeyRound />} term='External ID' example='An order id…'>
        The upstream's primary key…
      </GuideConcept>
    </GuideColumn>
  </GuideColumns>
  <GuideSection title='Going further'>...</GuideSection>
</GuideDialog>
```

- Content vocabulary is container-agnostic and composable: `GuideColumns`/`GuideColumn` (responsive multi-column layout), `GuideSteps`/`GuideStep` (numbered walkthroughs), `GuideConcepts`/`GuideConcept`/`GuideExample` (glyph + term + description + example), `GuideSection` (a secondary "going further" block below the main columns), `GuideCode` (inline monospace token), `GuideKbd`/`GuideShortcuts`/`GuideShortcut` (keyboard shortcut reference rows).
- Set `page` (+ `GuidePage` children instead of raw content) only when the guide has multiple screens — a single static guide just passes content straight as `children` with no `page` prop, and gets a fixed `size` (default `'3xl'`) instead of the paged shell's content-sized animation.
- Don't build a new help overlay from a raw `Dialog` + hand-written prose — even a single-page guide should go through `GuideDialog` so the header/footer/Esc-hint chrome stays consistent.

## 17. Inline-editable / grow-to-content input: `AutosizeInput`

The standard input for "click to rename" / inline-editable text that shouldn't force a fixed-width box — hero titles, rename fields, detail-bar labels, recipient/search inputs. Used across agents, kb, webhooks, workflow node inputs, schema-editor, custom-fields, and versioning. `packages/ui/src/components/autosize-input.tsx`:

```tsx
<AutosizeInput
  value={topic.key}
  onChange={(e) => patchTopic(topic.id, { key: e.target.value })}
  placeholder='topic.key'
  inputClassName='bg-transparent text-sm text-foreground outline-none'
  minWidth={40}
/>
```

- It measures content width via a hidden sizer element and resizes the actual `<input>` to match — style the visible input via `inputClassName`/`inputStyle` (not `className`, which targets the wrapper `div`).
- Always set `minWidth` so an empty/short value doesn't collapse to nothing; set `maxWidth` when it sits in a constrained row (e.g. a tree row title) so a long value can't push siblings off-screen — it clips at `maxWidth` rather than growing unbounded.
- There's a matching `AutosizeTextarea` for multi-line grow-to-content and `AutosizeField` for a labeled wrapper around either — same package, same sizing mechanism.
- Don't reach for a plain `<input>` with manual `onChange`-driven width math for this — the sizer-element approach here already handles font-metric edge cases (letter-spacing, placeholder-vs-value width) that a naive `ch`-unit or `scrollWidth`-on-self approach gets wrong.

## 18. Content shell: `PanelFrame`

The nested-border "frosted panel" container that underlies both `MainPageContent`'s main content area and its docked panel slots (§1), and `DockableDrawer`'s docked mode (§13) renders into one of these too. You won't usually reach for `PanelFrame` directly — `MainPage`/`MainPageContent` already wrap your content in it — but recognize it as *the* content-area visual language (soft rounded corners, four layered inset borders for a subtle depth effect, `bg-muted/50`) so a new full-height content area (e.g. a custom docked panel outside `MainPageContent`) matches rather than reinventing plain `rounded-2xl border` styling:

```tsx
<PanelFrame width={320} flex={false}>
  {panelContent}
</PanelFrame>
```

- `flex` makes the frame grow to fill its flex container (the main content area sets this); `width` fixes a panel's width (docked side panels set this instead).
- If you're building a new docked-panel-like surface that isn't going through `MainPageContent.dockedPanels` or `DockableDrawer`, wrap it in `PanelFrame` rather than a plain bordered `div` so it reads as part of the same panel system.

## 19. Calendar / scheduling grids: `EventCalendar`

Month/week/day/agenda calendar UI — vendored (MIT) from `origin-space/event-calendar` and reworked into `@auxx/ui/components/event-calendar`. First consumer is the dispatch board; the meetings calendar and a worker mobile day list are known future consumers. Fully controlled and **never mutates** — it owns no date/view state and issues no writes; every interaction is a callback prop and the consumer decides what (if anything) to persist.

```tsx
import { EventCalendar, CalendarDndProvider } from '@auxx/ui/components/event-calendar'

<EventCalendar
  date={date}
  view={view}
  onDateChange={setDate}
  onViewChange={setView}
  onRangeChange={(from, to) => refetch({ from, to })}
  events={visits}
  weekStartsOn={1}
  renderEvent={(visit, ctx) => <VisitChip visit={visit} view={ctx.view} />}
  onEventClick={openVisitPopover}
  onSlotClick={(start) => openScheduleControl({ start })}
  onEventDrop={(visit, newStart, newEnd) => scheduleVisit.mutate({ visitId: visit.id, startTime: newStart, endTime: newEnd })}
  onEventResize={(visit, newEnd) => scheduleVisit.mutate({ visitId: visit.id, endTime: newEnd })}
/>
```

- **Render-prop, not a fixed palette**: pass `renderEvent?: (event, ctx: { view, isFirstDay, isLastDay, isDragging }) => ReactNode` to fully own chip content/color — it's threaded through every chip call site (month/week/day/agenda/resource grids and the drag ghost). Without it, a default tinted chip renders off `event.color` (any CSS color value, not a fixed enum).
- **`resources` day mode**: pass `view='resource'` + `resources={[{ id, label, header? }, ...]}` for a per-worker/per-vehicle column day view — the dispatch board's primary view (`Unassigned` as a synthetic first resource, one column per active `DispatchWorker`). Events opt in via `event.resourceId`.
- **`backgroundEvents`**: non-interactive shading (off-hours, time-off, overlap hints) — an absolutely positioned layer below the event chips, day/week/resource views only.
- Move AND resize both go through callbacks only (`onEventDrop`, `onEventResize`, 15-minute snap, 15-minute minimum duration) — there is no internal event-CRUD dialog; build your own (a popover, a drawer, `Schedule` control §…) and call your own mutation.
- To mount external draggables (e.g. an unscheduled-visits backlog rail) inside the same drag context as the calendar, wrap both in `CalendarDndProvider` yourself — `EventCalendar` detects the ambient provider and skips creating its own.

## When none of these fit

If a screen genuinely doesn't match any pattern above (a canvas/graph editor, a chat surface, a highly custom visualization), that's fine — these primitives cover list/detail/settings/form/dialog/tree shapes, not everything. But default to reaching for one of these first, and if you build something structurally new that recurs a second time, add it to this doc rather than letting three different reinventions drift apart.
