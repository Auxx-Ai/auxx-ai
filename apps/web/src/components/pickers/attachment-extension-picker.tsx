// apps/web/src/components/pickers/attachment-extension-picker.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

/**
 * Common file extensions for the picker
 */
const COMMON_FILE_EXTENSIONS = [
  // Documents
  { value: '.pdf', label: 'PDF', category: 'Documents' },
  { value: '.doc', label: 'Word Doc', category: 'Documents' },
  { value: '.docx', label: 'Word Docx', category: 'Documents' },
  { value: '.xls', label: 'Excel', category: 'Documents' },
  { value: '.xlsx', label: 'Excel Xlsx', category: 'Documents' },
  { value: '.ppt', label: 'PowerPoint', category: 'Documents' },
  { value: '.pptx', label: 'PowerPoint Pptx', category: 'Documents' },
  { value: '.txt', label: 'Text', category: 'Documents' },
  { value: '.csv', label: 'CSV', category: 'Documents' },
  // Images
  { value: '.jpg', label: 'JPEG', category: 'Images' },
  { value: '.jpeg', label: 'JPEG', category: 'Images' },
  { value: '.png', label: 'PNG', category: 'Images' },
  { value: '.gif', label: 'GIF', category: 'Images' },
  { value: '.webp', label: 'WebP', category: 'Images' },
  { value: '.svg', label: 'SVG', category: 'Images' },
  // Archives
  { value: '.zip', label: 'ZIP', category: 'Archives' },
  { value: '.rar', label: 'RAR', category: 'Archives' },
  { value: '.7z', label: '7-Zip', category: 'Archives' },
  { value: '.tar', label: 'TAR', category: 'Archives' },
  { value: '.gz', label: 'GZip', category: 'Archives' },
]

interface AttachmentExtensionPickerProps {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
}

export function AttachmentExtensionPicker({
  value,
  onChange,
  placeholder = 'Select file extensions',
}: AttachmentExtensionPickerProps) {
  const [customExtension, setCustomExtension] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const handleSelect = (extension: string) => {
    if (!value.includes(extension)) {
      onChange([...value, extension])
    }
    setIsOpen(false)
  }

  const addCustomExtension = () => {
    if (customExtension.trim() && !value.includes(customExtension.trim())) {
      const ext = customExtension.startsWith('.') ? customExtension : `.${customExtension}`
      onChange([...value, ext])
      setCustomExtension('')
    }
  }

  const removeExtension = (ext: string) => {
    onChange(value.filter((e) => e !== ext))
  }

  const extensionsByCategory = COMMON_FILE_EXTENSIONS.reduce(
    (acc, ext) => {
      if (!acc[ext.category]) acc[ext.category] = []
      acc[ext.category].push(ext)
      return acc
    },
    {} as Record<string, (typeof COMMON_FILE_EXTENSIONS)[0][]>
  )

  return (
    <div className='space-y-3'>
      {/* Selected Extensions Display */}
      {value.length > 0 && (
        <div className='flex flex-wrap gap-1'>
          {value.map((ext) => {
            const commonExt = COMMON_FILE_EXTENSIONS.find((e) => e.value === ext)
            return (
              <Badge key={ext} variant='secondary' className='pr-1'>
                {commonExt ? commonExt.label : ext}
                <Button
                  variant='ghost'
                  size='sm'
                  className='ml-1 h-auto p-0.5 hover:bg-transparent'
                  onClick={() => removeExtension(ext)}>
                  <X className='h-3 w-3' />
                </Button>
              </Badge>
            )
          })}
        </div>
      )}

      {/* Common Extensions Selector */}
      <Select open={isOpen} onOpenChange={setIsOpen} onValueChange={handleSelect}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className='max-h-96'>
          {Object.entries(extensionsByCategory).map(([category, extensions]) => (
            <div key={category}>
              <div className='px-2 py-1.5'>
                <div className='text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
                  {category}
                </div>
              </div>
              {extensions.map((ext) => {
                const isSelected = value.includes(ext.value)
                return (
                  <SelectItem
                    key={ext.value}
                    value={ext.value}
                    className={`pl-4 ${isSelected ? 'bg-muted' : ''}`}
                    disabled={isSelected}>
                    <div className='flex items-center gap-2 w-full'>
                      <div className='flex-1'>
                        <div className='font-medium'>{ext.label}</div>
                        <div className='text-xs text-muted-foreground'>{ext.value}</div>
                      </div>
                      {isSelected && (
                        <Badge variant='secondary' className='ml-auto'>
                          Selected
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                )
              })}
            </div>
          ))}
        </SelectContent>
      </Select>

      {/* Custom Extension Input */}
      <div className='flex gap-2'>
        <Input
          placeholder='Custom extension (e.g., .xyz)'
          value={customExtension}
          onChange={(e) => setCustomExtension(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCustomExtension()}
          className='flex-1'
        />
        <Button variant='outline' size='sm' onClick={addCustomExtension}>
          <Plus className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}
