// apps/web/src/components/datasets/settings/sections/general-settings-section.tsx
'use client'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { z } from 'zod'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Switch } from '@auxx/ui/components/switch'
import { Table, TableBody, TableCell, TableRow } from '@auxx/ui/components/table'
import { Settings, Calendar, Database, FileText, Hash, Activity } from 'lucide-react'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { formatBytes } from '@auxx/lib/utils'
import type { DatasetEntity as Dataset } from '@auxx/database/models'

interface GeneralSettingsSectionProps {
  dataset: Dataset
  onUpdate?: (dataset: Dataset) => void
  readOnly?: boolean
}

const generalSettingsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be less than 255 characters'),
  description: z.string().max(1000, 'Description must be less than 1000 characters').optional(),
  isActive: z.boolean(),
})

type GeneralSettingsForm = z.infer<typeof generalSettingsSchema>

/** Status display info for all statuses */
const STATUS_INFO = {
  ACTIVE: { label: 'Active', variant: 'default' as const },
  INACTIVE: { label: 'Inactive', variant: 'secondary' as const },
  PROCESSING: { label: 'Processing', variant: 'outline' as const },
  ERROR: { label: 'Error', variant: 'destructive' as const },
}

/**
 * Formats a date for display
 */
const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function GeneralSettingsSection({
  dataset,
  onUpdate,
  readOnly = false,
}: GeneralSettingsSectionProps) {
  const form = useForm<GeneralSettingsForm>({
    resolver: standardSchemaResolver(generalSettingsSchema),
    defaultValues: {
      name: dataset.name,
      description: dataset.description || '',
      isActive: dataset.status === 'ACTIVE',
    },
  })

  const updateDataset = api.dataset.update.useMutation({
    onSuccess: (updatedDataset) => {
      onUpdate?.(updatedDataset)
    },
    onError: (error) => {
      toastError({ title: 'Failed to update dataset', description: error.message })
    },
  })

  const onSubmit = (data: GeneralSettingsForm) => {
    if (readOnly) return
    updateDataset.mutate({
      id: dataset.id,
      data: {
        name: data.name,
        description: data.description || undefined,
        status: data.isActive ? 'ACTIVE' : 'INACTIVE',
      },
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* Two Column Layout */}
        <div className="flex flex-col lg:flex-row">
          {/* Left Column - Form Fields */}
          <div className="flex-1 p-6 lg:pr-6">
            <div className="space-y-1 mb-6">
              <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
                <Settings className="size-4" /> General Settings
              </div>
              <p className="text-sm text-muted-foreground">
                Configure the basic information for your dataset.
              </p>
            </div>

            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dataset Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter dataset name..." {...field} disabled={readOnly} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe what this dataset contains..."
                        rows={3}
                        {...field}
                        disabled={readOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-xl border px-3 py-1 bg-primary-100">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm">Active</FormLabel>
                      <FormDescription>
                        Enable this dataset for use in queries and searches
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={readOnly}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Right Column - Dataset Information */}
          <div className="flex-1 border-t lg:border-t-0 lg:border-l p-6 lg:pl-6">
            <div className="space-y-1 mb-6">
              <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
                <Database className="size-4" /> Dataset Information
              </div>
              <p className="text-sm text-muted-foreground">
                Read-only metadata about your dataset.
              </p>
            </div>

            <div className="overflow-hidden rounded-md border bg-background">
              <Table>
                <TableBody>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">
                      <div className="flex items-center gap-1">
                        <FileText className="size-3.5 text-muted-foreground" />
                        Documents
                      </div>
                    </TableCell>
                    <TableCell className="py-2">{dataset.documentCount.toLocaleString()}</TableCell>
                  </TableRow>

                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">
                      <div className="flex items-center gap-1">
                        <Database className="size-3.5 text-muted-foreground" />
                        Total Size
                      </div>
                    </TableCell>
                    <TableCell className="py-2">{formatBytes(Number(dataset.totalSize))}</TableCell>
                  </TableRow>

                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">
                      <div className="flex items-center gap-1">
                        <Calendar className="size-3.5 text-muted-foreground" />
                        Created
                      </div>
                    </TableCell>
                    <TableCell className="py-2">{formatDate(dataset.createdAt)}</TableCell>
                  </TableRow>

                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">
                      <div className="flex items-center gap-1">
                        <Calendar className="size-3.5 text-muted-foreground" />
                        Last Updated
                      </div>
                    </TableCell>
                    <TableCell className="py-2">{formatDate(dataset.updatedAt)}</TableCell>
                  </TableRow>

                  {dataset.lastIndexedAt && (
                    <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                      <TableCell className="bg-muted/50 py-2 font-medium">
                        <div className="flex items-center gap-1">
                          <Calendar className="size-3.5 text-muted-foreground" />
                          Last Indexed
                        </div>
                      </TableCell>
                      <TableCell className="py-2">{formatDate(dataset.lastIndexedAt)}</TableCell>
                    </TableRow>
                  )}

                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">
                      <div className="flex items-center gap-1">
                        <Hash className="size-3.5 text-muted-foreground" />
                        ID
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded">{dataset.id}</code>
                    </TableCell>
                  </TableRow>

                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">
                      <div className="flex items-center gap-1">
                        <Activity className="size-3.5 text-muted-foreground" />
                        Status
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant={STATUS_INFO[dataset.status].variant}>
                        {STATUS_INFO[dataset.status].label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 border-t px-4 py-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => form.reset()}
            disabled={readOnly}>
            Reset
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            loading={updateDataset.isPending}
            loadingText="Saving..."
            disabled={readOnly}>
            Save Changes
          </Button>
        </div>
      </form>
    </Form>
  )
}
