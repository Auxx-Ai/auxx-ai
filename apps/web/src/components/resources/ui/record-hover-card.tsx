// apps/web/src/components/resources/ui/record-hover-card.tsx
'use client'

import {
  getDefinitionId,
  getHoverCardFieldKeys,
  parseRecordId,
  type RecordId,
} from '@auxx/lib/resources/client'
import type { FieldReference, ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@auxx/ui/components/hover-card'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { Maximize2, PanelRight, Star } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { useFavoriteToggle } from '~/components/favorites/hooks/use-favorite-toggle'
import { useRecord } from '~/components/resources/hooks/use-record'
import { useResource } from '~/components/resources/hooks/use-resource'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { RecordHoverCardField } from './record-hover-card-field'
import { RecordIcon } from './record-icon'

interface RecordHoverCardProps {
  /** RecordId in format "entityDefinitionId:entityInstanceId". When null/undefined, the trigger renders without hover behaviour. */
  recordId?: RecordId | null
  /** Field references to render in the body. Falls back to per-resource defaults from `HOVER_CARD_FIELDS`. Pass `[]` to force header-only. */
  fields?: FieldReference[]
  /** Trigger element. Wrapped in `HoverCardTrigger asChild`. */
  children: React.ReactNode
  /** Hover open delay in ms. */
  openDelay?: number
  /** Hover close delay in ms. */
  closeDelay?: number
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /** Pixel offset from the trigger along the side axis. */
  sideOffset?: number
  className?: string
  /** When provided, shows a "View in drawer" footer button that calls this. */
  onOpenInDrawer?: (recordId: RecordId) => void
}

/**
 * Reusable hover-card preview for any record. Shows a large icon/avatar,
 * primary + secondary display names, a favorite-toggle star, optional fields,
 * and footer buttons for opening in drawer / full page.
 *
 * Reuses the existing `useRecord` / `useResource` / `useFieldValue` stores;
 * does not issue new tRPC requests when the record is already cached.
 */
export function RecordHoverCard({
  recordId,
  fields,
  children,
  openDelay = 300,
  closeDelay = 100,
  side,
  align = 'start',
  sideOffset,
  className,
  onOpenInDrawer,
}: RecordHoverCardProps) {
  if (!recordId) return <>{children}</>

  return (
    <HoverCard openDelay={openDelay} closeDelay={closeDelay}>
      {/* Wrap in a stable inline-flex span so the trigger's pointer listeners
          attach to a host element we own — avoids asChild merging into a
          re-rendering Link/anchor inside a virtualized cell, which can drop
          pointerenter events. */}
      <HoverCardTrigger asChild>
        <span data-slot='record-hover-trigger' className='inline-flex max-w-full'>
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn('w-80 p-3', className)}
        onClick={(e) => e.stopPropagation()}>
        <RecordHoverCardBody recordId={recordId} fields={fields} onOpenInDrawer={onOpenInDrawer} />
      </HoverCardContent>
    </HoverCard>
  )
}

interface BodyProps {
  recordId: RecordId
  fields?: FieldReference[]
  onOpenInDrawer?: (recordId: RecordId) => void
}

function RecordHoverCardBody({ recordId, fields, onOpenInDrawer }: BodyProps) {
  const entityDefinitionId = getDefinitionId(recordId)
  const { record, isLoading: isLoadingRecord, isNotFound } = useRecord({ recordId })
  const { resource, isLoading: isLoadingResource } = useResource(entityDefinitionId)
  const href = useRecordLink(recordId)
  const systemAttributeMap = useResourceStore((s) => s.systemAttributeMap)

  // Secondary display lives on RecordMeta.secondaryInfo (populated by the batch
  // fetcher from EntityInstance.secondaryDisplayValue). Same path TicketBadge uses.
  const secondaryDisplay =
    typeof record?.secondaryInfo === 'string' && record.secondaryInfo.length > 0
      ? record.secondaryInfo
      : null

  // Resolve fields: caller override > registry default (system attributes) > [].
  // The registry stores stable system-attribute names (e.g. 'ticket_status');
  // resolve them to real ResourceFieldIds via the resource store map — same
  // primitive `useSystemValues` uses.
  const resolvedFields = useMemo<FieldReference[]>(() => {
    if (fields !== undefined) return fields
    if (!resource?.entityType) return []
    const attrs = getHoverCardFieldKeys(resource.entityType)
    if (attrs.length === 0) return []
    const refs: ResourceFieldId[] = []
    for (const attr of attrs) {
      const ref = systemAttributeMap[attr]
      if (ref) refs.push(ref)
    }
    return refs
  }, [fields, resource?.entityType, systemAttributeMap])

  if (isNotFound) {
    return <div className='py-4 text-center text-sm text-muted-foreground'>Record not found</div>
  }

  const isLoading = (isLoadingRecord || isLoadingResource) && !record
  if (isLoading) {
    return (
      <div className='flex items-start gap-3'>
        <Skeleton className='size-12 rounded-full' />
        <div className='flex-1 space-y-2 pt-1'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-3 w-24' />
        </div>
      </div>
    )
  }

  const displayName = (record?.displayName as string | undefined) ?? 'Untitled'

  const hasFooter = !!onOpenInDrawer || !!href
  const showDivider = resolvedFields.length > 0 || hasFooter

  return (
    <>
      {/* Header */}
      <div className='flex items-start gap-3'>
        <RecordIcon
          avatarUrl={record?.avatarUrl as string | undefined}
          iconId={resource?.icon || 'circle'}
          color={resource?.color || 'gray'}
          size='xl'
          inverse
        />
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1.5'>
            <h4 className=' truncate text-sm font-semibold leading-snug'>{displayName}</h4>
            <FavoriteStarButton recordId={recordId} />
          </div>
          {secondaryDisplay && (
            <p className='truncate text-xs text-muted-foreground'>{secondaryDisplay}</p>
          )}
        </div>
      </div>

      {/* Fields */}
      {resolvedFields.length > 0 && (
        <div className='pt-2'>
          {resolvedFields.map((ref) => (
            <RecordHoverCardField key={String(ref)} recordId={recordId} fieldRef={ref} />
          ))}
        </div>
      )}

      {/* Footer */}
      {hasFooter && (
        <div
          className={cn(
            'flex items-center justify-end gap-1',
            // Only render the divider once — fields section already has its own.
            !resolvedFields.length && showDivider && 'border-t'
          )}>
          {onOpenInDrawer && (
            <Button
              variant='ghost'
              size='icon-xs'
              title='Open in drawer'
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onOpenInDrawer(recordId)
              }}>
              <PanelRight />
            </Button>
          )}
          {href && (
            <Button asChild variant='ghost' size='icon-xs' title='Open full page'>
              <Link href={href} onClick={(e) => e.stopPropagation()}>
                <Maximize2 />
              </Link>
            </Button>
          )}
        </div>
      )}
    </>
  )
}

function FavoriteStarButton({ recordId }: { recordId: RecordId }) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const { toggle, isFavorited, isPending } = useFavoriteToggle('ENTITY_INSTANCE', {
    entityDefinitionId,
    entityInstanceId,
  })

  return (
    <Button
      variant='ghost'
      size='icon-xs'
      className='shrink-0'
      loading={isPending}
      title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggle()
      }}>
      <Star className={cn(isFavorited && 'fill-yellow-400 text-yellow-400')} />
    </Button>
  )
}
