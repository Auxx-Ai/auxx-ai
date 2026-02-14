// apps/web/src/components/datasets/documents/document-filter-bar.tsx
'use client'
import type { Document } from '@auxx/database/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

interface DocumentFilterBarProps {
  filterValue: string
  onFilterChange: (value: string) => void
  documents: Document[]
  totalDocuments: number
}
export function DocumentFilterBar({
  filterValue,
  onFilterChange,
  documents,
  totalDocuments,
}: DocumentFilterBarProps) {
  const statusCounts = {
    all: totalDocuments,
    UPLOADED: documents.filter((doc) => doc.status === 'UPLOADED').length,
    PROCESSING: documents.filter((doc) => doc.status === 'PROCESSING').length,
    INDEXED: documents.filter((doc) => doc.status === 'INDEXED').length,
    FAILED: documents.filter((doc) => doc.status === 'FAILED').length,
    ARCHIVED: documents.filter((doc) => doc.status === 'ARCHIVED').length,
  }
  return (
    <div className='flex'>
      {/* Status Filter */}
      <Select value={filterValue} onValueChange={onFilterChange}>
        <SelectTrigger className='w-[120px]' variant='ghost' size='sm'>
          <SelectValue placeholder='Filter by status' />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='all'>All ({statusCounts.all})</SelectItem>
          <SelectItem value='UPLOADED'>Uploaded ({statusCounts.UPLOADED})</SelectItem>
          <SelectItem value='PROCESSING'>Processing ({statusCounts.PROCESSING})</SelectItem>
          <SelectItem value='INDEXED'>Indexed ({statusCounts.INDEXED})</SelectItem>
          <SelectItem value='FAILED'>Failed ({statusCounts.FAILED})</SelectItem>
          <SelectItem value='ARCHIVED'>Archived ({statusCounts.ARCHIVED})</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
