// apps/web/src/components/editor/rich-text/render-reference-badge.tsx

'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ActorId } from '@auxx/types/actor'
import { cn } from '@auxx/ui/lib/utils'
import { ToolsetBadge } from '~/components/pickers/toolset-picker/toolset-badge'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { ThreadBadge } from '~/components/threads/ui/thread-badge'

const referenceBadgeRing = 'transition-all inline-flex'

/**
 * id-prefix → badge renderer for the inline `reference` node. Used by every
 * editor that mounts the reference picker (Kopilot composer, KB article
 * editor, agent persona editor).
 */
export function renderReferenceBadge({ id, selected }: { id: string; selected: boolean }) {
  const ring = cn(referenceBadgeRing, selected && 'ring-2 ring-primary ring-offset-1')
  if (id.startsWith('user:') || id.startsWith('group:')) {
    return <ActorBadge actorId={id as ActorId} className={ring} />
  }
  if (id.startsWith('thread:') || id.startsWith('draft:')) {
    try {
      const { entityInstanceId } = parseRecordId(id as RecordId)
      return <ThreadBadge threadId={entityInstanceId} className={ring} />
    } catch {
      return <RecordBadge recordId={id as RecordId} className={ring} />
    }
  }
  // Admin-surface ids — toolset (and stub tool:<name>) for the persona prompt
  // Tools tab. Resolved against the org toolset catalog, not the record cache.
  if (id.startsWith('toolset:')) {
    return <ToolsetBadge slug={id.slice('toolset:'.length)} className={ring} />
  }
  return <RecordBadge recordId={id as RecordId} className={ring} />
}
