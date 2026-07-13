// apps/web/src/app/(protected)/app/tickets/_components/ticket-number-form.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { SequenceScope } from '@auxx/lib/records'
import { BaseType } from '@auxx/lib/workflow-engine/types'
import { Button } from '@auxx/ui/components/button'
import { Form } from '@auxx/ui/components/form'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Hash } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
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

export interface TicketNumberingSettingsProps {
  /** Which `RecordSequence` scope this instance edits. Defaults to `'ticket'` (unchanged
   *  behavior at the original tickets/settings/format call site). */
  scope?: SequenceScope
  /** Section title — lets dispatch's Number Formats page render "Work Orders"/"Requests". */
  title?: string
  description?: string
  /** Root wrapper classes. Defaults to the centered single-column layout used by the tickets
   *  settings page; the dispatch grid overrides this to let each form fill its grid cell. */
  className?: string
}

export default function TicketNumberingSettings({
  scope = 'ticket',
  title = 'Ticket Numbering',
  description = 'Configure how ticket numbers are generated.',
  className = 'container mx-auto max-w-2xl overflow-y-auto pb-10 pt-4',
}: TicketNumberingSettingsProps = {}) {
  // Get current record sequence settings for this scope
  const { data: ticketSequence, refetch } = api.ticketSequence.get.useQuery({ scope })

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
      scope,
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
    <div className={className}>
      <SettingsSection className='mb-6' icon={Hash} title={title} description={description}>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FieldPanel className='p-0 [&_[data-slot=field-row-label]]:w-60'>
              {/* Prefix Settings */}
              <FieldPanelRow
                title='Use Prefix'
                description='Enable to use a prefix for ticket numbers (e.g., SUP-0001)'
                type={BaseType.BOOLEAN}
                showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.CHECKBOX}
                  value={form.watch('usePrefix')}
                  onChange={(val) => form.setValue('usePrefix', val as boolean)}
                  fieldOptions={{ variant: 'switch' }}
                />
              </FieldPanelRow>

              {form.watch('usePrefix') && (
                <>
                  <FieldPanelRow
                    title='Prefix Text'
                    description='Short text to prefix the ticket number (e.g., SUP)'
                    type={BaseType.STRING}
                    showIcon>
                    <FieldInputAdapter
                      fieldType={FieldType.TEXT}
                      value={form.watch('prefix') ?? ''}
                      onChange={(val) => form.setValue('prefix', val as string)}
                      placeholder='SUP'
                    />
                  </FieldPanelRow>

                  <FieldPanelRow
                    title='Include Date'
                    description='Add date component to prefix (e.g., SUP2403-0001)'
                    type={BaseType.BOOLEAN}
                    showIcon>
                    <FieldInputAdapter
                      fieldType={FieldType.CHECKBOX}
                      value={form.watch('useDateInPrefix')}
                      onChange={(val) => form.setValue('useDateInPrefix', val as boolean)}
                      fieldOptions={{ variant: 'switch' }}
                    />
                  </FieldPanelRow>

                  {form.watch('useDateInPrefix') && (
                    <FieldPanelRow
                      title='Date Format'
                      description='Format of the date component in the prefix'
                      type={BaseType.ENUM}
                      showIcon>
                      <FieldInputAdapter
                        fieldType={FieldType.SINGLE_SELECT}
                        value={form.watch('dateFormat')}
                        onChange={(val) =>
                          form.setValue('dateFormat', (val as string[])[0] ?? 'YYMM')
                        }
                        fieldOptions={{ options: DATE_FORMAT_OPTIONS }}
                      />
                    </FieldPanelRow>
                  )}
                </>
              )}

              {/* Suffix Settings */}
              <FieldPanelRow
                title='Use Suffix'
                description='Enable to use a suffix for ticket numbers (e.g., 0001-SUP)'
                type={BaseType.BOOLEAN}
                showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.CHECKBOX}
                  value={form.watch('useSuffix')}
                  onChange={(val) => form.setValue('useSuffix', val as boolean)}
                  fieldOptions={{ variant: 'switch' }}
                />
              </FieldPanelRow>

              {form.watch('useSuffix') && (
                <FieldPanelRow
                  title='Suffix Text'
                  description='Text to append after the ticket number'
                  type={BaseType.STRING}
                  showIcon>
                  <FieldInputAdapter
                    fieldType={FieldType.TEXT}
                    value={form.watch('suffix') ?? ''}
                    onChange={(val) => form.setValue('suffix', val as string)}
                    placeholder='SUP'
                  />
                </FieldPanelRow>
              )}

              {/* Number Format */}
              <FieldPanelRow
                title='Padding Length'
                description='Number of digits to pad the numeric part (e.g., 4 for 0001)'
                type={BaseType.NUMBER}
                showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.NUMBER}
                  value={form.watch('paddingLength')}
                  onChange={(val) => form.setValue('paddingLength', val as number)}
                  placeholder='4'
                />
              </FieldPanelRow>

              <FieldPanelRow
                title='Separator'
                description='Character(s) to separate parts (e.g., -, ., _)'
                type={BaseType.STRING}
                showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={form.watch('separator')}
                  onChange={(val) => form.setValue('separator', val as string)}
                  placeholder='-'
                />
              </FieldPanelRow>
            </FieldPanel>

            {/* Preview Section */}
            <div className='mt-6 rounded-2xl border bg-primary-100/30 p-4'>
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
      </SettingsSection>
    </div>
  )
}
