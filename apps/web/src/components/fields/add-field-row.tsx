// apps/web/src/components/fields/add-field-row.tsx
'use client'

import { Plus } from 'lucide-react'

/**
 * Props for AddFieldRow component
 */
interface AddFieldRowProps {
  onClick: () => void
}

/**
 * Row component that appears in edit mode to add new custom fields
 */
export function AddFieldRow({ onClick }: AddFieldRowProps) {
  return (
    <div
      onClick={onClick}
      className="flex h-[24px] -ms-1  gap-1 row group min-h-[30px] cursor-pointer hover:bg-primary-200/50 rounded-md transition-colors items-center">
      <div className="items-center flex gap-[4px] h-[24px] shrink-0 text-primary-500 ps-1.5">
        <Plus className="size-4  shrink-0" />
        <div className="w-[120px] text-sm shrink-0">
          <div className="truncate">Add Field</div>
        </div>
      </div>
    </div>
  )
}
