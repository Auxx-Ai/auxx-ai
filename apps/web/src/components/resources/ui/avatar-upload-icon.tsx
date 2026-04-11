// apps/web/src/components/resources/ui/avatar-upload-icon.tsx
'use client'

import type { FieldOptions } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { Camera } from 'lucide-react'
import { parseFileOptions } from '~/components/custom-fields/ui/file-options-editor'
import { useFieldFileUpload } from '~/components/fields/inputs/hooks/use-field-file-upload'
import { Tooltip } from '~/components/global/tooltip'
import { RecordIcon } from './record-icon'

interface AvatarUploadIconProps {
  recordId: RecordId
  avatarUrl?: string | null
  avatarFieldId: string
  avatarFieldOptions?: FieldOptions
  iconId: string
  color: string
}

/**
 * Wraps RecordIcon with click-to-upload behavior for entities
 * that have an avatar field configured. Opens the native file picker
 * on click and handles the full upload → field value save flow.
 */
export function AvatarUploadIcon({
  recordId,
  avatarUrl,
  avatarFieldId,
  avatarFieldOptions,
  iconId,
  color,
}: AvatarUploadIconProps) {
  const fileOptions = parseFileOptions(avatarFieldOptions)

  const { openNativeFilePicker } = useFieldFileUpload({
    recordId,
    fieldRef: avatarFieldId,
    fileOptions: { ...fileOptions, allowMultiple: false },
  })

  return (
    <Tooltip content={avatarUrl ? 'Change avatar' : 'Upload avatar'}>
      <button
        type='button'
        onClick={openNativeFilePicker}
        className='group relative shrink-0 rounded-lg cursor-pointer'>
        <RecordIcon avatarUrl={avatarUrl} iconId={iconId} color={color} size='xl' inverse />
        <div className='absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 group-hover:bg-black/40 transition-colors'>
          <Camera className='size-4 text-white opacity-0 group-hover:opacity-100 transition-opacity' />
        </div>
      </button>
    </Tooltip>
  )
}
