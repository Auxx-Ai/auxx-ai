// apps/web/src/components/files/file-filter-bar.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { X } from 'lucide-react'
import { useMemo } from 'react'
import type { FileFilterSettings, FileItem } from './files-store'
import { getFileCategory } from './utils/file-type'

/**
 * Props for the FileFilterBar component
 */
interface FileFilterBarProps {
  filterSettings: FileFilterSettings
  onFilterChange: (settings: FileFilterSettings) => void
  items: FileItem[]
  currentFolderId?: string | null
}

/**
 * Filter bar component for files list
 */
export function FileFilterBar({
  filterSettings,
  onFilterChange,
  items,
  currentFolderId,
}: FileFilterBarProps) {
  // Calculate category counts including uploads
  const categoryCounts = useMemo(() => {
    const allFiles = items.filter((item) => item.type === 'file')
    const uploadingFiles = items.filter((item) => item.isUploading)

    const counts = {
      all: items.length,
      folders: items.filter((item) => item.type === 'folder' && !item.isUploading).length,
      uploading: uploadingFiles.length,
      images: 0,
      documents: 0,
      videos: 0,
      audio: 0,
      archives: 0,
      code: 0,
      other: 0,
    }

    allFiles.forEach((file) => {
      if (file.isUploading) return // Already counted in uploading
      const category = getFileCategory(file.mimeType, file.ext).toLowerCase()
      if (counts[category as keyof typeof counts] !== undefined) {
        ;(counts as any)[category]++
      } else {
        counts.other++
      }
    })

    return counts
  }, [items])

  const hasActiveFilters = filterSettings.fileTypes.length > 0

  const clearFilters = () => {
    onFilterChange({
      ...filterSettings,
      fileTypes: [],
    })
  }

  return (
    <div className='flex items-center gap-2'>
      {/* File Type Filter */}
      <Select
        value={filterSettings.fileTypes[0] || 'all'}
        onValueChange={(value) => {
          onFilterChange({
            ...filterSettings,
            fileTypes: value === 'all' ? [] : [value],
          })
        }}>
        <SelectTrigger className='w-[140px]' variant='ghost' size='sm'>
          <SelectValue placeholder='All types' />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='all'>All ({categoryCounts.all})</SelectItem>
          {categoryCounts.uploading > 0 && (
            <SelectItem value='uploading'>Uploading ({categoryCounts.uploading})</SelectItem>
          )}
          <SelectItem value='folders'>Folders ({categoryCounts.folders})</SelectItem>
          <SelectItem value='images'>Images ({categoryCounts.images})</SelectItem>
          <SelectItem value='documents'>Documents ({categoryCounts.documents})</SelectItem>
          <SelectItem value='videos'>Videos ({categoryCounts.videos})</SelectItem>
          <SelectItem value='audio'>Audio ({categoryCounts.audio})</SelectItem>
          <SelectItem value='archives'>Archives ({categoryCounts.archives})</SelectItem>
          <SelectItem value='code'>Code ({categoryCounts.code})</SelectItem>
          <SelectItem value='other'>Other ({categoryCounts.other})</SelectItem>
        </SelectContent>
      </Select>

      {/* Active Filters */}
      {hasActiveFilters && (
        <div className='flex items-center gap-1'>
          {filterSettings.fileTypes.map((type) => (
            <Badge key={type} variant='secondary' className='text-xs'>
              {type}
              <Button
                variant='ghost'
                size='icon-sm'
                className='h-3 w-3 ml-1 p-0'
                onClick={() => {
                  onFilterChange({
                    ...filterSettings,
                    fileTypes: filterSettings.fileTypes.filter((t) => t !== type),
                  })
                }}>
                <X className='h-2 w-2' />
              </Button>
            </Badge>
          ))}

          <Button variant='ghost' size='sm' onClick={clearFilters}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  )
}
