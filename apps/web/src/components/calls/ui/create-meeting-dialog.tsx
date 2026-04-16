// apps/web/src/components/calls/ui/create-meeting-dialog.tsx
'use client'

import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useState } from 'react'
import { BaseType } from '~/components/workflow/types'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'

const PLATFORM_OPTIONS = [
  { label: 'Google Meet', value: 'google_meet' },
  { label: 'Zoom', value: 'zoom' },
  { label: 'Teams', value: 'teams' },
  { label: 'Other', value: 'other' },
]

const DURATION_OPTIONS = [
  { label: '15 min', value: '15' },
  { label: '30 min', value: '30' },
  { label: '45 min', value: '45' },
  { label: '60 min', value: '60' },
  { label: '90 min', value: '90' },
  { label: '120 min', value: '120' },
]

/**
 * Get the next half-hour as default start time.
 */
function getDefaultStartTime(): string {
  const now = new Date()
  const minutes = now.getMinutes()
  const roundedMinutes = minutes < 30 ? 30 : 60
  now.setMinutes(roundedMinutes, 0, 0)
  if (roundedMinutes === 60) {
    now.setHours(now.getHours())
  }
  return now.toISOString()
}

interface CreateMeetingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateMeetingDialog({ open, onOpenChange }: CreateMeetingDialogProps) {
  const [values, setValues] = useState({
    title: '',
    platform: 'google_meet',
    startTime: '',
    duration: '30',
    meetingUrl: '',
    participants: [] as RecordId[],
    description: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setValues({
        title: '',
        platform: 'google_meet',
        startTime: getDefaultStartTime(),
        duration: '30',
        meetingUrl: '',
        participants: [],
        description: '',
      })
      setErrors({})
    }
  }, [open])

  const handleChange = useCallback((field: string, value: any) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev }
        delete next[field]
        return next
      }
      return prev
    })
  }, [])

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!values.title) newErrors.title = 'Title is required'
    if (!values.startTime) newErrors.startTime = 'Date & time is required'
    if (!values.duration) newErrors.duration = 'Duration is required'
    if (values.platform !== 'google_meet' && !values.meetingUrl) {
      newErrors.meetingUrl = 'Meeting URL is required'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const utils = api.useUtils()
  const createMeeting = api.recording.createMeeting.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Meeting created' })
      utils.recording.list.invalidate()
      utils.calendar.getUpcoming.invalidate()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Error creating meeting', description: error.message })
    },
  })

  const isPending = createMeeting.isPending

  const handleSubmit = async () => {
    if (!validate()) return

    const isGoogleMeet = values.platform === 'google_meet'

    createMeeting.mutate({
      title: values.title,
      startTime: values.startTime,
      durationMinutes: Number.parseInt(values.duration, 10),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      createGoogleMeet: isGoogleMeet,
      meetingUrl: !isGoogleMeet && values.meetingUrl ? values.meetingUrl : undefined,
      description: values.description || undefined,
      contactRecordIds: values.participants as string[],
    })
  }

  const isManualUrl = values.platform !== 'google_meet'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]' position='tc'>
        <DialogHeader>
          <DialogTitle>Create Meeting</DialogTitle>
          <DialogDescription>
            Schedule a new meeting and optionally generate a video link.
          </DialogDescription>
        </DialogHeader>

        <VarEditorField
          orientation='responsive'
          className='p-0 sm:[&_[data-slot=field-row-label]]:w-50'>
          {/* Title */}
          <VarEditorFieldRow
            title='Title'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={errors.title}
            validationType='error'>
            <ConstantInputAdapter
              value={values.title}
              onChange={(_, val) => handleChange('title', val)}
              varType={BaseType.STRING}
              placeholder='Meeting title'
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {/* Platform */}
          <VarEditorFieldRow title='Platform' type={BaseType.ENUM} showIcon>
            <ConstantInputAdapter
              value={values.platform}
              onChange={(_, val) => handleChange('platform', val)}
              varType={BaseType.ENUM}
              disabled={isPending}
              fieldOptions={{ enum: PLATFORM_OPTIONS }}
            />
          </VarEditorFieldRow>

          {/* Date & Time */}
          <VarEditorFieldRow
            title='Date & Time'
            type={BaseType.DATETIME}
            showIcon
            isRequired
            validationError={errors.startTime}
            validationType='error'>
            <ConstantInputAdapter
              value={values.startTime}
              onChange={(_, val) => handleChange('startTime', val)}
              varType={BaseType.DATETIME}
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {/* Duration */}
          <VarEditorFieldRow
            title='Duration'
            type={BaseType.ENUM}
            showIcon
            isRequired
            validationError={errors.duration}
            validationType='error'>
            <ConstantInputAdapter
              value={values.duration}
              onChange={(_, val) => handleChange('duration', val)}
              varType={BaseType.ENUM}
              disabled={isPending}
              fieldOptions={{ enum: DURATION_OPTIONS }}
            />
          </VarEditorFieldRow>

          {/* Meeting URL — only for non-Google Meet */}
          {isManualUrl && (
            <VarEditorFieldRow
              title='Meeting URL'
              type={BaseType.URL}
              showIcon
              isRequired
              validationError={errors.meetingUrl}
              validationType='error'>
              <ConstantInputAdapter
                value={values.meetingUrl}
                onChange={(_, val) => handleChange('meetingUrl', val)}
                varType={BaseType.URL}
                placeholder='https://zoom.us/j/...'
                disabled={isPending}
              />
            </VarEditorFieldRow>
          )}

          {/* Participants */}
          <VarEditorFieldRow title='Participants' type={BaseType.RELATION} showIcon>
            <ConstantInputAdapter
              value={values.participants}
              onChange={(_, val) => handleChange('participants', val)}
              varType={BaseType.RELATION}
              placeholder='Search contacts...'
              disabled={isPending}
              fieldOptions={{
                relatedEntityDefinitionId: 'contact',
                relationshipType: 'has_many',
              }}
            />
          </VarEditorFieldRow>

          {/* Description */}
          <VarEditorFieldRow title='Description' type={BaseType.STRING} showIcon>
            <ConstantInputAdapter
              value={values.description}
              onChange={(_, val) => handleChange('description', val)}
              varType={BaseType.STRING}
              placeholder='Optional meeting notes'
              disabled={isPending}
              fieldOptions={{ string: { multiline: true } }}
            />
          </VarEditorFieldRow>
        </VarEditorField>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText='Creating...'
            data-dialog-submit>
            Create Meeting <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
