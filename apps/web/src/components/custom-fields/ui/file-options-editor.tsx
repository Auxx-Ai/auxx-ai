// apps/web/src/components/custom-fields/ui/file-options-editor.tsx
'use client'

import type { FieldOptions } from '@auxx/lib/field-values/client'
import { FILE_TYPE_CATEGORIES, type FileTypeCategory } from '@auxx/lib/files/client'
import { CheckboxGroup, CheckboxGroupItem } from '@auxx/ui/components/checkbox-group'
import { Field, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import { Label } from '@auxx/ui/components/label'
import { Slider } from '@auxx/ui/components/slider'
import { Switch } from '@auxx/ui/components/switch'
import { FileQuestion, FileText, Image, Music, Video } from 'lucide-react'
import { useState } from 'react'
import { type Tag, TagInput } from '~/components/tag-input/tag-input'

/** File options structure for the editor */
export interface FileOptions {
  allowMultiple: boolean
  maxFiles?: number
  allowedFileTypes?: FileTypeCategory[]
  allowedFileExtensions?: string[]
}

/** Default file options */
const DEFAULT_FILE_OPTIONS: FileOptions = {
  allowMultiple: false,
  maxFiles: undefined,
  allowedFileTypes: undefined,
  allowedFileExtensions: undefined,
}

/**
 * Parse stored field options into editor state.
 * Handles both new format (options.file) and legacy format (options.allowMultiple).
 */
export function parseFileOptions(fieldOptions?: FieldOptions): FileOptions {
  // Handle new format (options.file)
  if (fieldOptions?.file) {
    return {
      allowMultiple: fieldOptions.file.allowMultiple ?? false,
      maxFiles: fieldOptions.file.maxFiles,
      allowedFileTypes: fieldOptions.file.allowedFileTypes as FileTypeCategory[] | undefined,
      allowedFileExtensions: fieldOptions.file.allowedFileExtensions,
    }
  }
  // Handle legacy format (options.allowMultiple at root)
  if (fieldOptions && 'allowMultiple' in fieldOptions && fieldOptions.allowMultiple !== undefined) {
    return {
      allowMultiple: Boolean(fieldOptions.allowMultiple),
      maxFiles: undefined,
      allowedFileTypes: undefined,
      allowedFileExtensions: undefined,
    }
  }
  // Default
  return { ...DEFAULT_FILE_OPTIONS }
}

/**
 * Format editor state into storage format.
 * Returns options object with file key for storage.
 */
export function formatFileOptions(options: FileOptions): { file: FileOptions } {
  return { file: options }
}

/** File type category configuration for UI */
const FILE_TYPE_CONFIG: Record<
  FileTypeCategory,
  {
    icon: typeof Image
    label: string
    sublabel: string
    description: string
  }
> = {
  image: {
    icon: Image,
    label: 'Images',
    sublabel: 'jpg, png, gif, etc.',
    description: 'Allow image file uploads',
  },
  document: {
    icon: FileText,
    label: 'Documents',
    sublabel: 'pdf, doc, txt, etc.',
    description: 'Allow document file uploads',
  },
  video: {
    icon: Video,
    label: 'Videos',
    sublabel: 'mp4, mov, webm, etc.',
    description: 'Allow video file uploads',
  },
  audio: {
    icon: Music,
    label: 'Audio',
    sublabel: 'mp3, wav, m4a, etc.',
    description: 'Allow audio file uploads',
  },
  custom: {
    icon: FileQuestion,
    label: 'Custom Extensions',
    sublabel: 'specify your own',
    description: 'Define custom file extensions',
  },
}

/** Props for FileOptionsEditor component */
interface FileOptionsEditorProps {
  options: FileOptions
  onChange: (options: FileOptions) => void
  disabled?: boolean
}

/**
 * FileOptionsEditor component for configuring file upload field options
 * Used in both custom fields and workflow form-input nodes
 */
export function FileOptionsEditor({ options, onChange, disabled }: FileOptionsEditorProps) {
  const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null)

  const selectedTypes = options.allowedFileTypes || []
  const showCustomInput = selectedTypes.includes('custom')
  const showMaxFiles = options.allowMultiple

  /** Convert extensions string[] to Tag[] format for TagInput */
  const extensionTags: Tag[] = (options.allowedFileExtensions || []).map((ext) => ({
    id: ext,
    text: ext,
  }))

  /** Handle tag changes and convert back to string[] for onChange */
  const setExtensionTags = (tags: Tag[] | ((prev: Tag[]) => Tag[])) => {
    const newTags = typeof tags === 'function' ? tags(extensionTags) : tags
    const extensions = [
      ...new Set(
        newTags
          .map((tag) => tag.text.trim().toLowerCase())
          .filter((ext) => ext.length > 0)
          .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
      ),
    ]
    onChange({
      ...options,
      allowedFileExtensions: extensions.length > 0 ? extensions : undefined,
    })
  }

  /**
   * Handle file type selection change
   * Custom is mutually exclusive with other types
   */
  const handleFileTypesChange = (values: string[]) => {
    const newTypes = values as FileTypeCategory[]

    const prevHadCustom = selectedTypes.includes('custom')
    const nowHasCustom = newTypes.includes('custom')

    let finalTypes: FileTypeCategory[]
    if (!prevHadCustom && nowHasCustom && newTypes.length > 1) {
      // Custom just selected - make it exclusive
      finalTypes = ['custom']
    } else if (prevHadCustom && newTypes.length > 1) {
      // Other type selected while custom was active - remove custom
      finalTypes = newTypes.filter((t) => t !== 'custom')
    } else {
      finalTypes = newTypes
    }

    onChange({
      ...options,
      allowedFileTypes: finalTypes.length > 0 ? finalTypes : undefined,
      // Clear custom extensions if custom is deselected
      allowedFileExtensions: finalTypes.includes('custom')
        ? options.allowedFileExtensions
        : undefined,
    })
  }

  /**
   * Handle max files slider change
   */
  const handleMaxFilesChange = (value: number[]) => {
    onChange({
      ...options,
      maxFiles: value[0] || undefined,
    })
  }

  return (
    <div className='rounded-xl border py-3 px-3 bg-primary-50 space-y-4'>
      {/* Allow Multiple Toggle */}
      <div className='flex items-center space-x-2'>
        <Switch
          id='allow-multiple'
          size='sm'
          checked={options.allowMultiple ?? false}
          onCheckedChange={(checked) =>
            onChange({
              ...options,
              allowMultiple: checked,
              maxFiles: checked ? options.maxFiles : undefined,
            })
          }
          disabled={disabled}
        />
        <Label htmlFor='allow-multiple'>Allow multiple files</Label>
      </div>

      {/* Max Files Slider - only shown when allowMultiple is true */}
      {showMaxFiles && (
        <FieldGroup className='gap-2'>
          <Field>
            <div className='flex items-center justify-between'>
              <FieldLabel>Maximum files</FieldLabel>
              <span className='text-sm text-muted-foreground'>{options.maxFiles || 10}</span>
            </div>
            <Slider
              value={[options.maxFiles || 10]}
              onValueChange={handleMaxFilesChange}
              min={1}
              max={10}
              step={1}
              disabled={disabled}
              className='py-2'
            />
          </Field>
        </FieldGroup>
      )}

      {/* File Types Selection */}
      <FieldGroup className='gap-2'>
        <FieldLabel>Allowed file types</FieldLabel>
        <CheckboxGroup
          value={selectedTypes}
          onValueChange={handleFileTypesChange}
          disabled={disabled}>
          {FILE_TYPE_CATEGORIES.map((type) => {
            const config = FILE_TYPE_CONFIG[type]
            const Icon = config.icon
            return (
              <CheckboxGroupItem
                key={type}
                value={type}
                label={config.label}
                sublabel={config.sublabel}
                icon={<Icon />}
                description={config.description}
              />
            )
          })}
        </CheckboxGroup>
      </FieldGroup>

      {/* Custom Extensions Input - only shown when 'custom' is selected */}
      {showCustomInput && (
        <FieldGroup className='gap-2'>
          <Field>
            <FieldLabel>Custom extensions</FieldLabel>
            <TagInput
              tags={extensionTags}
              setTags={setExtensionTags}
              activeTagIndex={activeTagIndex}
              setActiveTagIndex={setActiveTagIndex}
              placeholder='Type extension and press Enter'
              disabled={disabled}
              size='sm'
              styleClasses={{
                inlineTagsContainer: 'min-h-9 bg-background',
              }}
            />
          </Field>
        </FieldGroup>
      )}
    </div>
  )
}
