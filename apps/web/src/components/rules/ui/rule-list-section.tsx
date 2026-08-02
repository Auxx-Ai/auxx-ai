// apps/web/src/components/rules/ui/rule-list-section.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  ListCard,
  type ListCardBadgeChip,
  type ListCardMenuItem,
  renderBadgeChips,
} from '@auxx/ui/components/list-card'
import { History, type LucideIcon, Pencil, Plus, Trash } from 'lucide-react'
import type { ReactNode } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'

/** The minimum a row must expose for the shared card grid. */
export interface RuleListRow {
  id: string
  name: string
  enabled: boolean
}

/** A labelled bucket of rows — e.g. mail filters grouped by inbox. */
export interface RuleListGroup<R> {
  key: string
  label: string
  rows: R[]
}

export interface RuleListSectionProps<R extends RuleListRow> {
  /** Section header icon, reused for the card icon and the enable/disable menu item. */
  icon: LucideIcon
  title: string
  description: string
  /** Create button label, e.g. `'Add'`. */
  createLabel: string
  onCreate: () => void
  isLoading?: boolean
  /** Flat rows. Ignored when `groups` is set. */
  rows?: R[]
  /** Grouped rows — one subheading + grid per group. Omit for the flat grid. */
  groups?: RuleListGroup<R>[]
  /**
   * Optional badge rendered BEFORE the card title — e.g. a mail filter's
   * evaluation order within its inbox. Omit for a plain title (unchanged).
   */
  leadingBadge?: (row: R) => ReactNode
  /** Card subtitle line. */
  subtitle: (row: R) => ReactNode
  /** Card description line. */
  describe: (row: R) => string
  /** Header-end chips, e.g. "Managed" / "Disabled". */
  badges?: (row: R) => ListCardBadgeChip[]
  /**
   * Rows that can't be edited or deleted (feature-provisioned). Their menu drops
   * Edit/Delete and the card opens run history instead of the editor.
   */
  isLocked?: (row: R) => boolean
  onEdit: (row: R) => void
  onViewRuns: (row: R) => void
  onToggleEnabled: (row: R) => void
  onDelete: (row: R) => void
  /** Extra menu items per row (e.g. "Move up" / "Move down"), placed before Delete. */
  extraMenuItems?: (row: R) => ListCardMenuItem[]
  /** Title of the delete confirmation, e.g. `'Delete rule?'`. */
  deleteConfirmTitle: string
  /** The card shown when there are no rows — a create affordance. */
  placeholder: { title: string; subtitle: string; description: string }
  /** Dialogs and other section-owned nodes. */
  children?: ReactNode
}

const GRID_CLASS = 'grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'

/**
 * The shared settings section for rule-shaped features: a card grid with per-row
 * edit / run history / enable / delete, an empty-state placeholder and the delete
 * confirmation. Domain-agnostic — rows, copy and handlers all arrive via props.
 */
export function RuleListSection<R extends RuleListRow>({
  icon: Icon,
  title,
  description,
  createLabel,
  onCreate,
  isLoading,
  rows,
  groups,
  leadingBadge,
  subtitle,
  describe,
  badges,
  isLocked,
  onEdit,
  onViewRuns,
  onToggleEnabled,
  onDelete,
  extraMenuItems,
  deleteConfirmTitle,
  placeholder,
  children,
}: RuleListSectionProps<R>) {
  const [confirm, ConfirmDialog] = useConfirm()

  const handleDelete = async (row: R) => {
    const ok = await confirm({
      title: deleteConfirmTitle,
      description: `Remove "${row.name}"? This action cannot be undone.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    onDelete(row)
  }

  const renderCard = (row: R) => {
    const locked = isLocked?.(row) ?? false
    const menuItems: ListCardMenuItem[] = [
      ...(locked ? [] : [{ label: 'Edit', icon: <Pencil />, onClick: () => onEdit(row) }]),
      { label: 'Run history', icon: <History />, onClick: () => onViewRuns(row) },
      {
        label: row.enabled ? 'Disable' : 'Enable',
        icon: <Icon />,
        onClick: () => onToggleEnabled(row),
      },
      ...(extraMenuItems?.(row) ?? []),
      ...(locked
        ? []
        : [
            {
              label: 'Delete',
              icon: <Trash />,
              onClick: () => void handleDelete(row),
              destructive: true,
            },
          ]),
    ]
    const chips = badges?.(row) ?? []
    const leading = leadingBadge?.(row)
    return (
      <ListCard
        key={row.id}
        title={
          leading ? (
            <span className='flex min-w-0 items-center gap-1.5'>
              {leading}
              <span className='min-w-0 truncate'>{row.name}</span>
            </span>
          ) : (
            row.name
          )
        }
        subtitle={subtitle(row)}
        description={describe(row)}
        icon={<Icon className='size-4' />}
        headerEnd={chips.length > 0 ? renderBadgeChips(chips) : undefined}
        onClick={() => (locked ? onViewRuns(row) : onEdit(row))}
        menuItems={menuItems}
      />
    )
  }

  const skeletons = [...Array(3)].map((_, i) => (
    <ListCard key={`skeleton-${i}`} loading descriptionLines={0} />
  ))

  const placeholderCard = (
    <ListCard
      title={placeholder.title}
      subtitle={placeholder.subtitle}
      description={placeholder.description}
      icon={<Icon className='size-4 text-muted-foreground' />}
      onClick={onCreate}
    />
  )

  const flatRows = rows ?? []

  return (
    <SettingsSection
      icon={Icon}
      title={title}
      description={description}
      action={
        <Button variant='outline' size='sm' onClick={onCreate}>
          <Plus />
          {createLabel}
        </Button>
      }>
      <div className='@container'>
        {groups ? (
          <div className='flex flex-col gap-4'>
            {isLoading && <div className={GRID_CLASS}>{skeletons}</div>}

            {!isLoading &&
              groups.map((group) => (
                <div key={group.key} className='space-y-2'>
                  <p className='text-xs font-medium text-muted-foreground'>{group.label}</p>
                  <div className={GRID_CLASS}>{group.rows.map(renderCard)}</div>
                </div>
              ))}

            {!isLoading && groups.every((group) => group.rows.length === 0) && (
              <div className={GRID_CLASS}>{placeholderCard}</div>
            )}
          </div>
        ) : (
          <div className={GRID_CLASS}>
            {isLoading && skeletons}

            {!isLoading && flatRows.map(renderCard)}

            {!isLoading && flatRows.length === 0 && placeholderCard}
          </div>
        )}
      </div>

      {children}
      <ConfirmDialog />
    </SettingsSection>
  )
}
