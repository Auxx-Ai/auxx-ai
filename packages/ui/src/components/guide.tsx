// packages/ui/src/components/guide.tsx
'use client'

import { Dialog, DialogContent, type DialogSize } from '@auxx/ui/components/dialog'
import {
  DialogNav,
  type DialogNavCrumb,
  DialogNavPage,
  DialogNavPages,
} from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdGroup, type ShortcutKey } from '@auxx/ui/components/kbd'
import { cn } from '@auxx/ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * Guide — the shared look for read-only "quick start" / help-sheet dialogs. A titled
 * surface of explanatory columns: numbered steps, glyph+term concepts, and example
 * callouts. The CONTENT primitives (`GuideColumns`, `GuideColumn`, `GuideSteps`,
 * `GuideStep`, `GuideConcept`, `GuideSection`, `GuideCode`) are container-agnostic —
 * drop them into `GuideDialog` here, or into any overlay/sheet that wants the same
 * vocabulary. Modeled on `apps/web/.../getting-started-overlay`'s `p-6` grid.
 *
 * @example
 * <GuideDialog open={open} onOpenChange={setOpen} title='Mapping quick start'>
 *   <GuideColumns>
 *     <GuideColumn title='Keys'>
 *       <GuideConcept glyph={<KeyRound />} term='External ID' example='An order id…'>
 *         The upstream's primary key…
 *       </GuideConcept>
 *     </GuideColumn>
 *   </GuideColumns>
 *   <GuideSection title='Going further'>…</GuideSection>
 * </GuideDialog>
 */

// ── Dialog shell ──────────────────────────────────────────────────────────────

export interface GuideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The title shown in the nav bar (also the accessible dialog title). */
  title: string
  /** Screen-reader-only summary; falls back to the title when omitted. */
  description?: string
  /**
   * A visible leading label before the crumbs (e.g. "Help"), separated by a
   * divider. Use with a custom `crumbs` trail acting as tabs, so a fixed dialog
   * title sits in front of the page switches. (Single-crumb guides don't need it:
   * their `title` already renders as the lone crumb.)
   */
  heading?: ReactNode
  /**
   * Override the nav breadcrumb trail. Defaults to a single current crumb from
   * `title`. Pass a trail when several guides share one dialog (e.g. tabbed help
   * sheets or a drill-in), so the bar reflects where the reader is.
   */
  crumbs?: DialogNavCrumb[]
  /**
   * Active page key. When set, the body animates between `GuidePage` children
   * (crossfade + height/width spring) via `DialogNavPages`, and the shell becomes
   * content-sized. Leave unset for a single static body. Pair with `crumbs` (mark
   * the active one) for a multi-page header.
   */
  page?: string
  /** Renders the leading "‹ Back" button in the nav bar when provided. */
  onBack?: () => void
  /** Right-aligned slot in the nav bar — e.g. tabs or a step indicator. */
  navActions?: ReactNode
  /** Dialog width preset. Defaults to a roomy `3xl` for multi-column guides. */
  size?: DialogSize
  /**
   * Footer hint on the right (static-body mode only). Defaults to "Press Esc to
   * close"; pass `null` to hide. In paged mode each `GuidePage` owns its footer.
   */
  footer?: ReactNode
  children: ReactNode
}

/**
 * A help/quick-start dialog: a `DialogNav` header carrying the title (so multiple
 * guides can share one dialog via `crumbs`/`navActions`/`onBack`) above the
 * standard `p-6` body and Esc footer. Set `page` (+ `GuidePage` children) for an
 * animated multi-page body, with `crumbs` marking the active page in the header.
 */
export function GuideDialog({
  open,
  onOpenChange,
  title,
  description,
  heading,
  crumbs,
  page,
  onBack,
  navActions,
  size = '3xl',
  footer = 'Press Esc to close',
  children,
}: GuideDialogProps) {
  const paged = page !== undefined
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Paged guides shrink-wrap to the animating body (`content`); static ones
          use the fixed width preset. */}
      <DialogContent size={paged ? 'content' : size} position='tc' innerClassName='p-0'>
        <div className='flex flex-col'>
          <DialogNav
            title={title}
            description={description ?? title}
            heading={heading}
            crumbs={crumbs ?? [{ label: title }]}
            onBack={onBack}
            actions={navActions}
          />
          {paged ? (
            <DialogNavPages value={page}>{children}</DialogNavPages>
          ) : (
            <div className='p-6'>
              {children}
              {footer && (
                <div className='mt-4 flex justify-end'>
                  <p className='text-muted-foreground text-xs'>{footer}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One page of a paged `GuideDialog` (rendered only when active). Wraps the body in
 * the standard `p-6` padding and an optional footer row; the dialog crossfades and
 * height-springs between pages.
 *
 * - `value` is matched against the dialog's `page`.
 * - `size` is the width the body springs to. Keep it equal across a guide's pages
 *   for a pure height/crossfade switch. **Pass it explicitly** — a default-param
 *   value wouldn't surface on the element's props, which is where the underlying
 *   `DialogNavPages` reads the width.
 * - `footer` renders below the body: a string shows as the right-aligned Esc hint;
 *   a node renders as-is; `null` hides it.
 */
export function GuidePage({
  value,
  size = '3xl',
  footer = 'Press Esc to close',
  children,
}: {
  value: string
  size?: DialogSize
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <DialogNavPage value={value} size={size}>
      <div className='p-6'>
        {children}
        {footer != null &&
          (typeof footer === 'string' ? (
            <div className='mt-4 flex justify-end'>
              <p className='text-muted-foreground text-xs'>{footer}</p>
            </div>
          ) : (
            <div className='mt-4'>{footer}</div>
          ))}
      </div>
    </DialogNavPage>
  )
}

// ── Content primitives (container-agnostic) ───────────────────────────────────

/** Responsive grid of `GuideColumn`s. Defaults to 3 columns on `md+`. */
export function GuideColumns({
  cols = 3,
  className,
  children,
}: {
  cols?: 2 | 3 | 4
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-6',
        cols === 2 && 'md:grid-cols-2',
        cols === 3 && 'md:grid-cols-3',
        cols === 4 && 'md:grid-cols-4',
        className
      )}>
      {children}
    </div>
  )
}

/** A titled column with the uppercase-muted section heading. */
export function GuideColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className='space-y-3'>
      <h3 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>{title}</h3>
      {children}
    </div>
  )
}

/** Ordered list wrapper for `GuideStep`s. */
export function GuideSteps({ children }: { children: ReactNode }) {
  return <ol className='space-y-2.5 text-sm'>{children}</ol>
}

/**
 * Description-list wrapper for a column of `GuideConcept`s (gives the `dt`/`dd` a
 * valid `dl` ancestor). Not needed inside `GuideSection`, which renders its own `dl`.
 */
export function GuideConcepts({ children }: { children: ReactNode }) {
  return <dl className='space-y-2.5 text-sm'>{children}</dl>
}

/** A numbered step: number gutter + bold title + muted detail. */
export function GuideStep({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: ReactNode
}) {
  return (
    <li className='flex gap-2'>
      <span className='shrink-0 font-medium text-muted-foreground'>{n}.</span>
      <div>
        <span className='font-medium'>{title}</span>
        <p className='mt-0.5 text-muted-foreground text-xs'>{children}</p>
      </div>
    </li>
  )
}

/**
 * A glyph + term + description entry, with an optional left-ruled example callout.
 *
 * - `glyph` is rendered before the term (an icon or a badge cluster). When present
 *   on the default layout, the description aligns under the term.
 * - `inlineGlyph` keeps the description flush-left — use it for wide glyphs (badge
 *   clusters) where a hanging indent would look off.
 */
export function GuideConcept({
  glyph,
  term,
  example,
  inlineGlyph = false,
  children,
}: {
  glyph?: ReactNode
  term: string
  example?: ReactNode
  inlineGlyph?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <dt className={cn('flex', inlineGlyph ? 'items-center gap-2' : 'items-center gap-1.5')}>
        {glyph &&
          (inlineGlyph ? (
            glyph
          ) : (
            <span className='inline-flex w-4 shrink-0 justify-center'>{glyph}</span>
          ))}
        <span className='font-medium text-foreground text-sm'>{term}</span>
      </dt>
      <dd
        className={cn(
          'mt-0.5 text-muted-foreground text-xs',
          glyph && !inlineGlyph && 'pl-[1.375rem]'
        )}>
        {children}
        {example && <GuideExample>{example}</GuideExample>}
      </dd>
    </div>
  )
}

/** A muted, left-ruled "Example:" line shown beneath a concept's description. */
export function GuideExample({ children }: { children: ReactNode }) {
  return (
    <span className='mt-1 block border-muted-foreground/20 border-l-2 pl-2 text-muted-foreground/80'>
      <span className='font-medium'>Example: </span>
      {children}
    </span>
  )
}

/**
 * A secondary block below the main columns ("Going further") — a top rule, an
 * uppercase heading, and a responsive grid of `GuideConcept`s. Defaults to 2 columns.
 */
export function GuideSection({
  title,
  cols = 2,
  children,
}: {
  title: string
  cols?: 1 | 2 | 3
  children: ReactNode
}) {
  return (
    <div className='mt-6 border-t pt-4'>
      <h3 className='mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
        {title}
      </h3>
      <dl
        className={cn(
          'grid grid-cols-1 gap-x-6 gap-y-3 text-sm',
          cols === 2 && 'sm:grid-cols-2',
          cols === 3 && 'sm:grid-cols-3'
        )}>
        {children}
      </dl>
    </div>
  )
}

/** Inline monospace token for paths / field names inside guide copy. */
export function GuideCode({ children }: { children: ReactNode }) {
  return (
    <code className='rounded bg-muted px-1 font-mono text-foreground text-[11px]'>{children}</code>
  )
}

/** Keys that render as a glyph/label via `Kbd`'s `shortcut` prop; everything else is literal text. */
const SHORTCUT_KEYS = new Set<ShortcutKey>([
  'cmd',
  'command',
  'ctrl',
  'esc',
  'enter',
  'alt',
  'option',
])

/**
 * Inline keyboard key for use inside guide copy (the keyboard sibling of
 * `GuideCode`): renders a single `Kbd` with the guide's outline/sm styling. Pass a
 * shortcut token (cmd/ctrl/enter/esc/alt) as `k` to get its glyph, or `children`
 * for a literal key like `N`.
 *
 * @example Press <GuideKbd>N</GuideKbd> or <GuideKbd k='cmd' /><GuideKbd>C</GuideKbd>.
 */
export function GuideKbd({ k, children }: { k?: ShortcutKey; children?: ReactNode }) {
  return (
    <Kbd
      variant='outline'
      size='sm'
      {...(k && SHORTCUT_KEYS.has(k) ? { shortcut: k } : { children })}
    />
  )
}

/**
 * Column of keyboard shortcuts: a label-left, keys-right list. Wrap a set of
 * `GuideShortcut`s. Pairs with `GuideColumn title='Shortcuts'`.
 */
export function GuideShortcuts({ children }: { children: ReactNode }) {
  return <div className='space-y-1.5'>{children}</div>
}

/**
 * One shortcut row: a `KbdGroup` of keys on the left, a muted label on the right.
 * Keys matching a `Kbd` `shortcut` token (cmd/ctrl/enter/esc/alt) render as their
 * glyph; any other key renders as literal text.
 */
export function GuideShortcut({ keys, label }: { keys: readonly string[]; label: string }) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <KbdGroup variant='outline' size='sm'>
        {keys.map((key) => (
          <Kbd
            key={key}
            {...(SHORTCUT_KEYS.has(key as ShortcutKey)
              ? { shortcut: key as ShortcutKey }
              : { children: key })}
          />
        ))}
      </KbdGroup>
      <span className='text-muted-foreground text-xs'>{label}</span>
    </div>
  )
}
