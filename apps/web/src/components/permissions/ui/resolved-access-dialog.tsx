// apps/web/src/components/permissions/ui/resolved-access-dialog.tsx
'use client'

import { Level } from '@auxx/lib/permissions/client'
import { Badge, type BadgeProps } from '@auxx/ui/components/badge'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { ShieldQuestion } from 'lucide-react'
import { useState } from 'react'
import { RUNG_BADGE_VARIANT, RUNG_LABELS } from './level-labels'

/** Shared row chrome — same shape the leveled grids use. */
const ROW_CLASS = 'bg-primary-50 hover:bg-primary-100'

/**
 * The four rungs every leveled access model in the product resolves to. Shape is
 * shared, and so is the rung vocabulary (`None / Read / Edit / Full`, from
 * `level-labels.ts`); callers still supply their own helper text and badge
 * colours via {@link ResolvedAccessLevelMetaMap}.
 */
export type ResolvedAccessLevel = 'none' | 'read' | 'write' | 'full'

export interface ResolvedAccessLevelMeta {
  label: string
  /** One line of what the rung authorizes — rendered as the badge's hover title. */
  helper: string
  variant: NonNullable<BadgeProps['variant']>
}

/** Total by construction, so `none` always has a name of its own. */
export type ResolvedAccessLevelMetaMap = Record<ResolvedAccessLevel, ResolvedAccessLevelMeta>

/**
 * Last-resort names, used only when a caller's map is missing a rung. `none`
 * reads as an explicit denial, never as "inherit" or an empty cell (doc 19 §7).
 * Labels and colours both come from the shared ladder vocabulary — a fallback
 * that invented its own would be the hardest kind of drift to notice, since it
 * only ever renders where a caller already forgot a rung.
 */
const FALLBACK_LEVEL_META: ResolvedAccessLevelMetaMap = {
  none: {
    label: RUNG_LABELS[Level.None],
    helper: 'Denied',
    variant: RUNG_BADGE_VARIANT[Level.None],
  },
  read: {
    label: RUNG_LABELS[Level.Read],
    helper: 'Read only',
    variant: RUNG_BADGE_VARIANT[Level.Read],
  },
  write: {
    label: RUNG_LABELS[Level.Edit],
    helper: 'Read plus write',
    variant: RUNG_BADGE_VARIANT[Level.Edit],
  },
  full: {
    label: RUNG_LABELS[Level.Full],
    helper: 'Read and write, plus administration',
    variant: RUNG_BADGE_VARIANT[Level.Full],
  },
}

export interface ResolvedAccessRow {
  id: string
  label: string
  description?: string
  icon?: React.ReactNode
  level: ResolvedAccessLevel
  /** Carries a rule of its own rather than taking the domain default. */
  isOverride?: boolean
}

export interface ResolvedAccessDomain {
  key: string
  /** `Areas` / `Record types` / `Resources`. */
  title: string
  /** The rung every key with no rule of its own resolves to, rendered as a row. */
  defaultRow?: { label: string; level: ResolvedAccessLevel }
  /** Rows bucketed by a heading — areas group by their registry group. */
  groups?: Array<{ label: string; rows: ResolvedAccessRow[] }>
  /** Flat rows, for domains with no grouping. */
  rows?: ResolvedAccessRow[]
  isLoading?: boolean
  loadingLabel?: string
}

interface ResolvedAccessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  /** Rung names for this caller's access model. */
  levelMeta: ResolvedAccessLevelMetaMap
  /** Empty means nothing resolved — the dialog renders its empty state. */
  domains: ResolvedAccessDomain[]
  emptyTitle?: string
  emptyDescription?: string
}

/** A rung as a badge, with its meaning on hover. Always renders — `none` included. */
export function ResolvedAccessBadge({
  level,
  levelMeta,
  isOverride,
}: {
  level: ResolvedAccessLevel
  levelMeta: ResolvedAccessLevelMetaMap
  isOverride?: boolean
}) {
  const meta = levelMeta[level] ?? FALLBACK_LEVEL_META[level]
  return (
    <span className='flex items-center gap-1.5'>
      {isOverride && <span className='text-[10px] uppercase text-muted-foreground'>set</span>}
      <Badge variant={meta.variant} size='sm' title={meta.helper}>
        {meta.label}
      </Badge>
    </span>
  )
}

/**
 * Read-only view of a resolved four-rung access policy across any number of
 * domains. Knows nothing about who the policy belongs to — callers normalize
 * their model into {@link ResolvedAccessDomain}s and name the rungs.
 */
export function ResolvedAccessDialog({
  open,
  onOpenChange,
  title = 'Resolved access',
  description,
  levelMeta,
  domains,
  emptyTitle = 'Nothing resolved',
  emptyDescription,
}: ResolvedAccessDialogProps) {
  const [nonDefaultOnly, setNonDefaultOnly] = useState(false)

  const overrideCount = domains.reduce(
    (sum, domain) => sum + allRows(domain).filter((row) => row.isOverride).length,
    0
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='xl' position='tc' className='max-h-[80vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {domains.length === 0 ? (
          <EmptySection
            orientation='horizontal'
            icon={<ShieldQuestion />}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : (
          <div className='flex flex-col gap-6'>
            <div className='flex items-center justify-between gap-2'>
              <Badge variant='outline' size='sm'>
                Read-only
              </Badge>
              <ButtonSwitch
                label='Only overrides'
                checked={nonDefaultOnly}
                onCheckedChange={setNonDefaultOnly}
                disabled={overrideCount === 0}
              />
            </div>

            {domains.map((domain) => (
              <DomainBlock
                key={domain.key}
                domain={domain}
                levelMeta={levelMeta}
                nonDefaultOnly={nonDefaultOnly}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Every row a domain carries, grouped or flat. */
function allRows(domain: ResolvedAccessDomain): ResolvedAccessRow[] {
  return [...(domain.rows ?? []), ...(domain.groups ?? []).flatMap((group) => group.rows)]
}

function DomainBlock({
  domain,
  levelMeta,
  nonDefaultOnly,
}: {
  domain: ResolvedAccessDomain
  levelMeta: ResolvedAccessLevelMetaMap
  nonDefaultOnly: boolean
}) {
  const keep = (rows: ResolvedAccessRow[]) =>
    nonDefaultOnly ? rows.filter((row) => row.isOverride) : rows

  return (
    <div className='flex flex-col gap-2'>
      <span className='text-sm font-medium'>{domain.title}</span>

      {domain.defaultRow && (
        <TreeRow
          rowClassName={ROW_CLASS}
          title={<span className='text-muted-foreground'>{domain.defaultRow.label}</span>}
          trailing={<ResolvedAccessBadge level={domain.defaultRow.level} levelMeta={levelMeta} />}
        />
      )}

      {domain.isLoading ? (
        <p className='px-1 text-xs text-muted-foreground'>{domain.loadingLabel ?? 'Loading…'}</p>
      ) : (
        <>
          {domain.rows && (
            <div className='flex flex-col gap-0.5'>
              {keep(domain.rows).map((row) => (
                <AccessRow key={row.id} row={row} levelMeta={levelMeta} />
              ))}
            </div>
          )}

          {domain.groups && (
            <div className='flex flex-col gap-4'>
              {domain.groups.map((group) => (
                <div key={group.label} className='flex flex-col gap-0.5'>
                  <span className='px-1 text-xs font-semibold uppercase text-primary-600'>
                    {group.label}
                  </span>
                  {keep(group.rows).map((row) => (
                    <AccessRow key={row.id} row={row} levelMeta={levelMeta} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AccessRow({
  row,
  levelMeta,
}: {
  row: ResolvedAccessRow
  levelMeta: ResolvedAccessLevelMetaMap
}) {
  return (
    <TreeRow
      rowClassName={ROW_CLASS}
      icon={row.icon}
      title={row.label}
      description={row.description}
      trailing={
        <ResolvedAccessBadge level={row.level} levelMeta={levelMeta} isOverride={row.isOverride} />
      }
    />
  )
}
