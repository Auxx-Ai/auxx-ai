// apps/web/src/components/data-import/steps/step-map-columns.tsx

'use client'

import { useState, useEffect } from 'react'
import { Button } from '@auxx/ui/components/button'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@auxx/ui/components/empty'
import { Loader2, Wand2 } from 'lucide-react'
import { api } from '~/trpc/react'
import { suggestResolutionType } from '@auxx/lib/import/client'
import { ColumnMappingTable } from '../column-mapping/column-mapping-table'
import { SampleValuesPanel } from '../column-mapping/sample-values-panel'
import type { ColumnMappingUI } from '../types'

interface StepMapColumnsProps {
  jobId: string
  onComplete: () => void
  /** Called when mapping counts change (for step card display) */
  onMappingChange?: (mappedCount: number, totalColumns: number) => void
}

/**
 * Step 2: Column mapping.
 * Two-panel layout: mapping table on left, sample values preview on right.
 * Sample values panel updates on row hover.
 */
export function StepMapColumns({ jobId, onComplete, onMappingChange }: StepMapColumnsProps) {
  const [mappings, setMappings] = useState<ColumnMappingUI[]>([])
  const [selectedColumn, setSelectedColumn] = useState<number | null>(null)

  // Show selected column or first column by default
  const activeColumn = selectedColumn ?? (mappings.length > 0 ? 0 : null)

  // Fetch job details and available fields
  const { data: job, isLoading: jobLoading } = api.dataImport.getJob.useQuery({ jobId })
  const { data: fields, isLoading: fieldsLoading } = api.dataImport.getImportableFields.useQuery(
    { targetTable: job?.importMapping?.targetTable ?? '', includeIdentifiers: true },
    { enabled: !!job?.importMapping?.targetTable }
  )
  const { data: mappableProperties } = api.dataImport.getMappableProperties.useQuery({ jobId })

  const saveMapping = api.dataImport.saveColumnMapping.useMutation()
  const autoMap = api.dataImport.autoMapColumns.useMutation()

  // Initialize mappings from mappable properties (includes saved mapping data from server)
  useEffect(() => {
    if (mappableProperties && fields) {
      const initialMappings: ColumnMappingUI[] = mappableProperties.map((prop) => ({
        id: prop.id,
        importMappingId: job?.importMappingId ?? '',
        sourceColumnIndex: prop.columnIndex,
        sourceColumnName: prop.visibleName,
        columnName: prop.visibleName,
        sampleValues: prop.sampleValues ?? [],
        // Use saved values from server instead of hardcoded defaults
        targetType: prop.targetType ?? 'skip',
        targetFieldKey: prop.targetFieldKey ?? null,
        customFieldId: prop.customFieldId ?? null,
        resolutionType: prop.resolutionType ?? 'text:value',
        matchField: prop.matchField ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        isMapped: !!prop.targetFieldKey,
        suggestedField: null,
      }))
      setMappings(initialMappings)
    }
  }, [mappableProperties, fields, job?.importMappingId])

  // Report initial mapping counts to parent when mappings are loaded
  useEffect(() => {
    if (mappings.length > 0) {
      const mappedCount = mappings.filter((m) => m.isMapped).length
      onMappingChange?.(mappedCount, mappings.length)
    }
    // Only run on initial load, not on every mappings change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappings.length > 0])

  const handleMappingChange = async (
    columnIndex: number,
    fieldKey: string | null,
    resolutionType: string,
    matchField?: string
  ) => {
    // Find if another column is using this fieldKey (for replacement)
    const existingMapping = fieldKey
      ? mappings.find((m) => m.targetFieldKey === fieldKey && m.sourceColumnIndex !== columnIndex)
      : null

    // Get the target field to check if it's a relation
    const targetField = fieldKey ? fields?.find((f) => f.key === fieldKey) : null

    // Determine resolution type based on the selected field
    // For relations with matchField, use 'relation:match'
    // Otherwise, use suggestResolutionType to get the appropriate type for the field
    const finalResolutionType = targetField
      ? targetField.isRelation && matchField
        ? 'relation:match'
        : suggestResolutionType(targetField)
      : 'text:value'

    // Update local state - clear old mapping if replacing, then set new mapping
    setMappings((prev) => {
      const updated = prev.map((m) => {
        // Clear the old column that had this field
        if (existingMapping && m.sourceColumnIndex === existingMapping.sourceColumnIndex) {
          return {
            ...m,
            targetFieldKey: null,
            targetType: 'skip',
            matchField: null,
            isMapped: false,
          }
        }
        // Set the new mapping
        if (m.sourceColumnIndex === columnIndex) {
          return {
            ...m,
            targetFieldKey: fieldKey,
            targetType: fieldKey ? 'particle' : 'skip',
            resolutionType: finalResolutionType,
            matchField: matchField ?? null,
            isMapped: !!fieldKey,
          }
        }
        return m
      })

      // Report updated counts to parent immediately
      const newMappedCount = updated.filter((m) => m.isMapped).length
      onMappingChange?.(newMappedCount, updated.length)

      return updated
    })

    // Save to server - clear old mapping first if replacing
    if (existingMapping) {
      await saveMapping.mutateAsync({
        jobId,
        columnIndex: existingMapping.sourceColumnIndex,
        targetFieldKey: null,
        resolutionType: existingMapping.resolutionType,
      })
    }

    // Save the new mapping
    await saveMapping.mutateAsync({
      jobId,
      columnIndex,
      targetFieldKey: fieldKey,
      resolutionType: finalResolutionType,
      matchField,
      relationConfig: targetField?.relationConfig,
      enumValues: targetField?.enumValues,
    })
  }

  const handleAutoMap = async () => {
    const result = await autoMap.mutateAsync({ jobId })

    // Update local state with auto-mapped results
    setMappings((prev) => {
      const updated = prev.map((m) => {
        const autoMapped = result.mappings.find((r) => r.columnIndex === m.sourceColumnIndex)
        if (autoMapped) {
          return {
            ...m,
            targetFieldKey: autoMapped.targetFieldKey,
            targetType: autoMapped.targetFieldKey ? 'particle' : 'skip',
            resolutionType: autoMapped.resolutionType,
            isMapped: !!autoMapped.targetFieldKey,
            suggestedField: autoMapped.targetFieldKey,
          }
        }
        return m
      })

      // Report updated counts to parent immediately
      const newMappedCount = updated.filter((m) => m.isMapped).length
      onMappingChange?.(newMappedCount, updated.length)

      return updated
    })

    // Log if AI was used (could show UI indicator in the future)
    if (result.usedAI) {
      console.log('AI-powered mapping applied')
    }
  }

  const mappedCount = mappings.filter((m) => m.isMapped).length
  const canContinue = mappedCount > 0

  if (jobLoading || fieldsLoading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-0 h-full">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-background">
              <Loader2 className="animate-spin" />
            </EmptyMedia>
            <EmptyTitle>Loading...</EmptyTitle>
            <EmptyDescription>Fetching column mappings</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="">
      {/* Header with auto-map */}
      <div className="flex items-center justify-between sticky top-0 px-4 border-b bg-muted/80 backdrop-blur h-12 z-10">
        <div className="flex flex-row items-center gap-2">
          <h3 className="font-medium">Column Mappings</h3>
          <p className="text-sm text-muted-foreground">
            {mappedCount} of {mappings.length} columns mapped
          </p>
        </div>
        <div className="flex items-center gap-2 flex-row">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoMap}
            loading={autoMap.isPending}
            loadingText="Auto-mapping...">
            <Wand2 />
            Auto-map Columns
          </Button>
          <Button onClick={onComplete} disabled={!canContinue} size="sm">
            Continue to Review
          </Button>
        </div>
      </div>

      {/* Two-panel layout: mapping table + sample values preview */}
      <div className="flex gap-4">
        {/* Left: Mapping table (CSV Column | Maps To) */}
        <div className="flex-1 min-w-0 shrink-0">
          <ColumnMappingTable
            mappings={mappings}
            availableFields={fields ?? []}
            activeColumn={activeColumn}
            onSelectColumn={setSelectedColumn}
            onChange={handleMappingChange}
          />
        </div>

        {/* Right: Sample values panel (shows on hover/click, defaults to first column) */}
        <div className="w-[300px] shrink-0 pe-6">
          <SampleValuesPanel mapping={mappings.find((m) => m.sourceColumnIndex === activeColumn)} />
        </div>
      </div>
    </div>
  )
}
