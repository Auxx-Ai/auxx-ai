// apps/web/src/components/timeline/change-detail.tsx
import { ArrowRight } from 'lucide-react'
import { pickRenderable, type SnapshotChange, SnapshotValue } from './snapshot-chip'

interface ChangeDetailProps {
  change: SnapshotChange
}

/**
 * Renders a single field-change row. Prefers the server-resolved snapshots
 * (`oldDisplay`/`newDisplay`); falls back to a pure unwrap of legacy raw
 * values for rows that pre-date the snapshot system.
 */
export function ChangeDetail({ change }: ChangeDetailProps) {
  const oldSnap = pickRenderable(change, 'old')
  const newSnap = pickRenderable(change, 'new')
  const hasOld = oldSnap !== null && (Array.isArray(oldSnap) ? oldSnap.length > 0 : true)

  return (
    <div className='flex items-center gap-2'>
      <span className='font-medium'>{change.field}:</span>
      {hasOld && (
        <>
          <span className='text-primary-400 line-through'>
            <SnapshotValue snap={oldSnap} />
          </span>
          <ArrowRight />
        </>
      )}
      <span className='emphasis'>
        <SnapshotValue snap={newSnap} />
      </span>
    </div>
  )
}
