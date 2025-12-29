// apps/web/src/components/datasets/settings/sections/vector-db-settings-section.tsx
'use client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { z } from 'zod'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Textarea } from '@auxx/ui/components/textarea'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Database, Server, Cloud, Settings, Code, AlertTriangle } from 'lucide-react'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { type VectorDbType } from '@auxx/database/types'
import type { DatasetEntity as Dataset } from '@auxx/database/models'

interface VectorDbSettingsSectionProps {
  dataset: Dataset
  onUpdate?: (dataset: Dataset) => void
  readOnly?: boolean
}
const vectorDbSettingsSchema = z.object({
  vectorDbType: z.enum(['POSTGRESQL', 'CHROMA', 'QDRANT', 'PINECONE'] as const),
  vectorDbConfig: z.string().optional(), // JSON string for form handling
})
type VectorDbSettingsForm = z.infer<typeof vectorDbSettingsSchema>
const VECTOR_DB_INFO = {
  POSTGRESQL: {
    icon: Database,
    label: 'PostgreSQL (pgvector)',
    description: 'Use your existing PostgreSQL database with pgvector extension',
    badge: 'Default',
    defaultConfig: {
      index_type: 'ivfflat',
      m: 16,
      ef_construction: 64,
    },
  },
  CHROMA: {
    icon: Server,
    label: 'ChromaDB',
    description: 'Open-source vector database designed for AI applications',
    badge: 'Popular',
    defaultConfig: {
      host: 'localhost',
      port: 8000,
      collection_name: 'default',
    },
  },
  QDRANT: {
    icon: Cloud,
    label: 'Qdrant',
    description: 'High-performance vector database with advanced filtering',
    badge: 'Fast',
    defaultConfig: {
      url: 'http://localhost:6333',
      collection_name: 'default',
      vector_size: 1536,
    },
  },

  PINECONE: {
    icon: Cloud,
    label: 'Pinecone',
    description: 'Fully managed cloud vector database service',
    badge: 'Managed',
    defaultConfig: {
      api_key: '',
      environment: 'us-east1-gcp',
      index_name: 'default',
    },
  },
}
export function VectorDbSettingsSection({
  dataset,
  onUpdate,
  readOnly = false,
}: VectorDbSettingsSectionProps) {
  const [configError, setConfigError] = useState<string | null>(null)
  const form = useForm<VectorDbSettingsForm>({
    resolver: standardSchemaResolver(vectorDbSettingsSchema),
    defaultValues: {
      vectorDbType: dataset.vectorDbType as VectorDbType,
      vectorDbConfig: dataset.vectorDbConfig ? JSON.stringify(dataset.vectorDbConfig, null, 2) : '',
    },
  })
  const selectedDbType = form.watch('vectorDbType')
  const configValue = form.watch('vectorDbConfig')
  const updateDataset = api.dataset.update.useMutation({
    onSuccess: (updatedDataset) => {
      toastSuccess({
        title: 'Vector database settings updated',
        description: 'New configuration has been saved',
      })
      onUpdate?.(updatedDataset)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update vector database settings',
        description: error.message,
      })
    },
  })
  const onSubmit = (data: VectorDbSettingsForm) => {
    if (readOnly) return
    // Validate JSON config
    let parsedConfig = {}
    if (data.vectorDbConfig?.trim()) {
      try {
        parsedConfig = JSON.parse(data.vectorDbConfig)
        setConfigError(null)
      } catch (error) {
        setConfigError('Invalid JSON configuration')
        return
      }
    }
    updateDataset.mutate({
      id: dataset.id,
      data: {
        vectorDbType: data.vectorDbType,
        vectorDbConfig: parsedConfig,
      },
    })
  }
  const handleDbTypeChange = (dbType: VectorDbType) => {
    form.setValue('vectorDbType', dbType)
    // Set default configuration for the selected database
    const dbInfo = VECTOR_DB_INFO[dbType]
    if (dbInfo?.defaultConfig) {
      form.setValue('vectorDbConfig', JSON.stringify(dbInfo.defaultConfig, null, 2))
    }
  }
  const validateJsonConfig = (config: string) => {
    if (!config.trim()) {
      setConfigError(null)
      return
    }
    try {
      JSON.parse(config)
      setConfigError(null)
    } catch (error) {
      setConfigError('Invalid JSON format')
    }
  }
  const dbInfo = VECTOR_DB_INFO[selectedDbType]
  const DbIcon = dbInfo?.icon || Database
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* Two Column Layout */}
        <div className="flex flex-col lg:flex-row">
          {/* Left Column - Database Type Selection */}
          <div className="flex-1 p-6 lg:pr-6">
            <div className="space-y-1 mb-6">
              <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
                <Database className="size-4" /> Vector Database
              </div>
              <p className="text-sm text-muted-foreground">
                Select the vector database for storing embeddings.
              </p>
            </div>

            <FormField
              control={form.control}
              name="vectorDbType"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={(value) => handleDbTypeChange(value as VectorDbType)}
                      disabled={readOnly || updateDataset.isPending}>
                      {Object.entries(VECTOR_DB_INFO).map(([dbType, info]) => {
                        const Icon = info.icon
                        return (
                          <RadioGroupItemCard
                            key={dbType}
                            label={info.label}
                            sublabel={info.badge}
                            value={dbType}
                            icon={<Icon />}
                            description={info.description}
                          />
                        )
                      })}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Right Column - Database Configuration */}
          <div className="flex-1 border-t lg:border-t-0 lg:border-l p-6 lg:pl-6">
            <div className="space-y-1 mb-6">
              <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
                <DbIcon className="size-4" /> {dbInfo?.label} Configuration
              </div>
              <p className="text-sm text-muted-foreground">
                Configure connection and index settings.
              </p>
            </div>

            <div className="space-y-4">
              <FormField
                control={form.control}
                name="vectorDbConfig"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Configuration (JSON)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={`{\n  "example": "configuration"\n}`}
                        rows={6}
                        className="font-mono text-sm"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e.target.value)
                          validateJsonConfig(e.target.value)
                        }}
                        disabled={readOnly}
                      />
                    </FormControl>
                    <FormDescription className="flex items-start gap-2">
                      <Code className="size-3 mt-0.5 flex-shrink-0" />
                      <span>Leave empty to use defaults.</span>
                    </FormDescription>
                    {configError && (
                      <div className="flex items-center gap-2 text-red-600 text-sm">
                        <AlertTriangle className="size-4" />
                        {configError}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Configuration Example */}
              {dbInfo?.defaultConfig && (
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 mb-2">
                    <Settings className="size-3" />
                    <span className="font-medium text-xs">Default Example</span>
                  </div>
                  <pre className="text-xs font-mono bg-background p-2 rounded border overflow-auto">
                    {JSON.stringify(dbInfo.defaultConfig, null, 2)}
                  </pre>
                </div>
              )}
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
            disabled={readOnly || !!configError}>
            Save Configuration
          </Button>
        </div>
      </form>
    </Form>
  )
}
