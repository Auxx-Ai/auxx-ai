// apps/web/src/components/rules/ui/rule-dialog-shell.tsx

'use client'

import { Dialog, DialogContent, type DialogSize } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import type { ReactNode } from 'react'

/** One step of the dialog's linear page stack. */
export interface RuleDialogShellPage {
  /** Stable page key — the `DialogNavPages` value. */
  id: string
  /** Breadcrumb label for this page. The first page is labelled by `rootCrumb` instead. */
  title: string
  /** Page width token, forwarded to `DialogNavPage`. */
  size?: DialogSize
  /** The page body. Rendered only while active. */
  content: ReactNode
}

export interface RuleDialogShellProps {
  open: boolean
  onClose: () => void
  /** sr-only dialog title (Radix a11y). */
  title: string
  /** sr-only dialog description. */
  description?: string
  /** Leading breadcrumb — typically the rule's name, with a placeholder fallback. */
  rootCrumb: string
  /** Ordered page stack; `pages[0]` is the root. */
  pages: RuleDialogShellPage[]
  /** Active page id (controlled by the caller, which owns the form state). */
  page: string
  onPageChange: (page: string) => void
  /** Footer rendered as a sibling of the page stack — for shells with one shared footer. */
  footer?: ReactNode
}

/**
 * The shared create/edit dialog chrome for rule-shaped features (record rules,
 * mail filters): the `Dialog` shell, the `DialogNav` breadcrumb/back header and the
 * animated `DialogNavPages` stack.
 *
 * The shell owns navigation only — form state stays with the caller's dialog, which
 * is what lets two features with different page bodies share the same chrome.
 */
export function RuleDialogShell({
  open,
  onClose,
  title,
  description,
  rootCrumb,
  pages,
  page,
  onPageChange,
  footer,
}: RuleDialogShellProps) {
  const index = Math.max(
    0,
    pages.findIndex((p) => p.id === page)
  )
  const goTo = (target: number) => {
    const next = pages[target]
    if (next) onPageChange(next.id)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title={title}
          description={description}
          onBack={index > 0 ? () => goTo(index - 1) : undefined}
          crumbs={[
            { label: rootCrumb, onClick: index > 0 ? () => goTo(0) : undefined },
            // Every page walked into so far. `i` is offset by one (the slice starts at
            // pages[1]); only pages behind the current one are clickable.
            ...pages.slice(1, index + 1).map((p, i) => ({
              label: p.title,
              onClick: i + 1 < index ? () => goTo(i + 1) : undefined,
            })),
          ]}
        />

        <DialogNavPages value={page}>
          {pages.map((p) => (
            <DialogNavPage key={p.id} value={p.id} size={p.size}>
              {p.content}
            </DialogNavPage>
          ))}
        </DialogNavPages>

        {footer}
      </DialogContent>
    </Dialog>
  )
}
