// apps/web/src/components/editor/rich-text/render-reference-badge.tsx

'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ActorId } from '@auxx/types/actor'
import { cn } from '@auxx/ui/lib/utils'
import { ToolBadge } from '~/components/pickers/tool-picker/tool-badge'
import { ToolsetBadge } from '~/components/pickers/toolset-picker/toolset-badge'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { FieldBadge } from '~/components/resources/ui/field-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { ResourceBadge } from '~/components/resources/ui/resource-badge'
import { ThreadBadge } from '~/components/threads/ui/thread-badge'

const referenceBadgeRing = 'transition-all inline-flex'

/**
 * id-prefix → badge renderer for the inline `reference` node. Used by every
 * editor that mounts the reference picker (Kopilot composer, KB article
 * editor, agent persona editor).
 */
export function renderReferenceBadge({ id, selected }: { id: string; selected: boolean }) {
  const ring = cn(referenceBadgeRing, selected && 'ring-2 ring-primary ring-offset-1')
  if (id.startsWith('user:') || id.startsWith('group:') || id.startsWith('agent:')) {
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
  // Admin-surface ids — `tool:<name>` is the new picker output; `toolset:<slug>`
  // remains for backward compatibility with existing prompts.
  if (id.startsWith('tool:')) {
    return <ToolBadge name={id.slice('tool:'.length)} className={ring} />
  }
  if (id.startsWith('toolset:')) {
    return <ToolsetBadge slug={id.slice('toolset:'.length)} className={ring} />
  }
  if (id.startsWith('resource:')) {
    return <ResourceBadge id={id.slice('resource:'.length)} selected={selected} className={ring} />
  }
  if (id.startsWith('field:')) {
    const payload = id.slice('field:'.length)
    // Plain `entityDef:fieldId` or path key `a:b::c:d` — derive root entity
    // from the head segment in either case.
    const head = payload.split('::')[0] ?? payload
    const entityDefinitionId = head.split(':')[0] ?? ''
    return (
      <FieldBadge
        id={payload}
        entityDefinitionId={entityDefinitionId}
        selected={selected}
        className={ring}
      />
    )
  }
  return <RecordBadge recordId={id as RecordId} className={ring} />
}
