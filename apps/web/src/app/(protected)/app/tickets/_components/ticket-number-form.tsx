// apps/web/src/app/(protected)/app/tickets/_components/ticket-number-form.tsx

'use client'

import { BaseType } from '@auxx/lib/workflow-engine/types'
import { Button } from '@auxx/ui/components/button'
import { Form } from '@auxx/ui/components/form'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Hash } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'

const formSchema = z.object({
  prefix: z.string().max(10).optional(),
  paddingLength: z.number().min(1).max(10).default(4),
  usePrefix: z.boolean().default(true),
  useDateInPrefix: z.boolean().default(false),
  dateFormat: z.string().default('YYMM'),
  separator: z.string().max(3).default('-'),
  suffix: z.string().max(10).optional(),
  useSuffix: z.boolean().default(false),
})

// Generate a sample ticket number
const generateSample = (values: FormValues, number: number) => {
  const numericPart = String(number).padStart(values.paddingLength || 4, '0')

  // Build the ticket number parts
  const parts = []

  // Prefix handling
  if (values.usePrefix) {
    // Static prefix
    let prefixPart = values.prefix || ''

    // Date in prefix
    if (values.useDateInPrefix) {
      const now = new Date()
      const dateFormat = values.dateFormat || 'YYMM'
      let datePart = ''

      // Format the date according to the specified format
      switch (dateFormat) {
        case 'YYMM':
          datePart = `${now.getFullYear().toString().slice(2)}${(now.getMonth() + 1).toString().padStart(2, '0')}`
          break
        case 'YYYYMM':
          datePart = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}`
          break
        case 'MMYY':
          datePart = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear().toString().slice(2)}`
          break
        case 'YY':
          datePart = now.getFullYear().toString().slice(2)
          break
        case 'MM':
          datePart = (now.getMonth() + 1).toString().padStart(2, '0')
          break
        default:
          datePart = `${now.getFullYear().toString().slice(2)}${(now.getMonth() + 1).toString().padStart(2, '0')}`
      }

      // Combine the static prefix with the date
      prefixPart = prefixPart ? `${prefixPart}${datePart}` : datePart
    }

    if (prefixPart) {
      parts.push(prefixPart)
    }
  }

  // Add the numeric part
  parts.push(numericPart)

  // Suffix handling
  if (values.useSuffix && values.suffix) {
    parts.push(values.suffix)
  }

  // Join all parts with the separator
  const separator = values.separator || ''
  return parts.join(separator)
}

type FormValues = z.infer<typeof formSchema>

/** Date format options for prefix */
const DATE_FORMAT_OPTIONS = [
  { value: 'YYMM', label: 'Year Month (YYMM)' },
  { value: 'YYYYMM', label: 'Full Year Month (YYYYMM)' },
  { value: 'MMYY', label: 'Month Year (MMYY)' },
  { value: 'YY', label: 'Year only (YY)' },
  { value: 'MM', label: 'Month only (MM)' },
]

export default function TicketNumberingSettings() {
  // Get current ticket sequence settings
  const { data: ticketSequence, refetch } = api.ticketSequence.get.useQuery()

  // Current sequence number display
  const currentNumber = ticketSequence ? ticketSequence.currentNumber : 0

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      prefix: ticketSequence?.prefix || '',
      paddingLength: ticketSequence?.paddingLength || 4,
      usePrefix: ticketSequence?.usePrefix || true,
      useDateInPrefix: ticketSequence?.useDateInPrefix || false,
      dateFormat: ticketSequence?.dateFormat || 'YYMM',
      separator: ticketSequence?.separator || '-',
      suffix: ticketSequence?.suffix || '',
      useSuffix: ticketSequence?.useSuffix || false,
    },
  })
  const { watch } = form

  // Update form values when data is loaded
  useEffect(() => {
    if (ticketSequence) {
      form.reset({
        prefix: ticketSequence.prefix || '',
        paddingLength: ticketSequence.paddingLength,
        usePrefix: ticketSequence.usePrefix,
        useDateInPrefix: ticketSequence.useDateInPrefix,
        dateFormat: ticketSequence.dateFormat || 'YYMM',
        separator: ticketSequence.separator,
        suffix: ticketSequence.suffix || '',
        useSuffix: ticketSequence.useSuffix,
      })
    }
  }, [ticketSequence, form])

  // Update ticket sequence settings
  const updateSequence = api.ticketSequence.update.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Settings updated',
        description: 'Your ticket numbering settings have been updated.',
      })
      void refetch()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })

  // Watch all form values for preview generation
  const allValues = watch()
  const sampleSequence = generateSample(allValues, currentNumber + 1)

  /** Handle form submission */
  const onSubmit = (values: FormValues) => {
    updateSequence.mutate({
      prefix: values.prefix,
      paddingLength: values.paddingLength,
      usePrefix: values.usePrefix,
      useDateInPrefix: values.useDateInPrefix,
      dateFormat: values.dateFormat,
      separator: values.separator,
      suffix: values.suffix,
      useSuffix: values.useSuffix,
    })
  }

  return (
    <div className='container mx-auto max-w-2xl overflow-y-auto pb-10 pt-4'>
      {/* Title Header */}
      <div className='mb-6 space-y-1'>
        <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
          <Hash className='size-4' /> Ticket Numbering
        </div>
        <p className='text-sm text-muted-foreground'>Configure how ticket numbers are generated.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <VarEditorField className='p-0 [&_[data-slot=field-row-label]]:w-60'>
            {/* Prefix Settings */}
            <VarEditorFieldRow
              title='Use Prefix'
              description='Enable to use a prefix for ticket numbers (e.g., SUP-0001)'
              type={BaseType.BOOLEAN}
              showIcon>
              <ConstantInputAdapter
                value={form.watch('usePrefix')}
                onChange={(_, val) => form.setValue('usePrefix', val)}
                varType={BaseType.BOOLEAN}
                fieldOptions={{ variant: 'switch' }}
              />
            </VarEditorFieldRow>

            {form.watch('usePrefix') && (
              <>
                <VarEditorFieldRow
                  title='Prefix Text'
                  description='Short text to prefix the ticket number (e.g., SUP)'
                  type={BaseType.STRING}
                  showIcon>
                  <ConstantInputAdapter
                    value={form.watch('prefix') ?? ''}
                    onChange={(_, val) => form.setValue('prefix', val)}
                    varType={BaseType.STRING}
                    placeholder='SUP'
                  />
                </VarEditorFieldRow>

                <VarEditorFieldRow
                  title='Include Date'
                  description='Add date component to prefix (e.g., SUP2403-0001)'
                  type={BaseType.BOOLEAN}
                  showIcon>
                  <ConstantInputAdapter
                    value={form.watch('useDateInPrefix')}
                    onChange={(_, val) => form.setValue('useDateInPrefix', val)}
                    varType={BaseType.BOOLEAN}
                    fieldOptions={{ variant: 'switch' }}
                  />
                </VarEditorFieldRow>

                {form.watch('useDateInPrefix') && (
                  <VarEditorFieldRow
                    title='Date Format'
                    description='Format of the date component in the prefix'
                    type={BaseType.ENUM}
                    showIcon>
                    <ConstantInputAdapter
                      value={form.watch('dateFormat')}
                      onChange={(_, val) => form.setValue('dateFormat', val)}
                      varType={BaseType.ENUM}
                      fieldOptions={{ enum: DATE_FORMAT_OPTIONS }}
                    />
                  </VarEditorFieldRow>
                )}
              </>
            )}

            {/* Suffix Settings */}
            <VarEditorFieldRow
              title='Use Suffix'
              description='Enable to use a suffix for ticket numbers (e.g., 0001-SUP)'
              type={BaseType.BOOLEAN}
              showIcon>
              <ConstantInputAdapter
                value={form.watch('useSuffix')}
                onChange={(_, val) => form.setValue('useSuffix', val)}
                varType={BaseType.BOOLEAN}
                fieldOptions={{ variant: 'switch' }}
              />
            </VarEditorFieldRow>

            {form.watch('useSuffix') && (
              <VarEditorFieldRow
                title='Suffix Text'
                description='Text to append after the ticket number'
                type={BaseType.STRING}
                showIcon>
                <ConstantInputAdapter
                  value={form.watch('suffix') ?? ''}
                  onChange={(_, val) => form.setValue('suffix', val)}
                  varType={BaseType.STRING}
                  placeholder='SUP'
                />
              </VarEditorFieldRow>
            )}

            {/* Number Format */}
            <VarEditorFieldRow
              title='Padding Length'
              description='Number of digits to pad the numeric part (e.g., 4 for 0001)'
              type={BaseType.NUMBER}
              showIcon>
              <ConstantInputAdapter
                value={form.watch('paddingLength')}
                onChange={(_, val) => form.setValue('paddingLength', val)}
                varType={BaseType.NUMBER}
                placeholder='4'
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Separator'
              description='Character(s) to separate parts (e.g., -, ., _)'
              type={BaseType.STRING}
              showIcon>
              <ConstantInputAdapter
                value={form.watch('separator')}
                onChange={(_, val) => form.setValue('separator', val)}
                varType={BaseType.STRING}
                placeholder='-'
              />
            </VarEditorFieldRow>
          </VarEditorField>

          {/* Preview Section */}
          <div className='mt-6 rounded-xl border bg-primary-100/30 p-4'>
            <div className='mb-2 text-sm font-medium'>Preview</div>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <div className='text-xs text-muted-foreground'>Current sequence</div>
                <div className='text-lg font-bold'>{currentNumber}</div>
              </div>
              <div>
                <div className='text-xs text-muted-foreground'>Next ticket</div>
                <div className='font-mono text-lg font-bold'>{sampleSequence}</div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className='mt-6 flex justify-end gap-2'>
            <Button type='button' variant='ghost' size='sm' onClick={() => form.reset()}>
              Reset
            </Button>
            <Button
              type='submit'
              size='sm'
              variant='outline'
              loading={updateSequence.isPending}
              loadingText='Saving...'>
              Save Settings
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
