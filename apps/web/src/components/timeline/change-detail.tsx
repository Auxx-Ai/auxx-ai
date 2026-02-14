// apps/web/src/components/timeline/change-detail.tsx
import { ArrowRight } from 'lucide-react'

/**
 * Props for the ChangeDetail component
 */
interface ChangeDetailProps {
  change: {
    field: string
    oldValue: any
    newValue: any
  }
}

/**
 * Formats a value for display in change details
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

/**
 * Displays a single field change with old and new values
 */
export function ChangeDetail({ change }: ChangeDetailProps) {
  return (
    <div className='flex items-center gap-2'>
      <span className='font-medium'>{change.field}:</span>
      {change.oldValue !== null && change.oldValue !== undefined && (
        <>
          <span className='text-primary-400 line-through'>{formatValue(change.oldValue)}</span>
          <ArrowRight />
        </>
      )}
      <span className='emphasis'>{formatValue(change.newValue)}</span>
    </div>
  )
}
