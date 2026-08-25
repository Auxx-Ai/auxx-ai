// apps/web/src/components/data-import/steps/step-map-columns.tsx

'use client'

import {
  buildRelationColumnPolicy,
  getValidResolutionTypes,
  type ImportableField,
  type ImportStrategyMode,
  type ResolutionType,
  suggestResolutionType,
} from '@auxx/lib/import/client'
import { Button } from '@auxx/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { toastError } from '@auxx/ui/components/toast'
import { AlertTriangle, Loader2, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useResources } from '~/components/resources'
import { api } from '~/trpc/react'
import { isMappingIncomplete } from '../column-mapping/column-mapping-row'
import { ColumnMappingTable } from '../column-mapping/column-mapping-table'
import type { ColumnPolicyPatch } from '../column-mapping/column-policy-popover'
import { ImportModeSelector } from '../column-mapping/import-mode-selector'
import { SampleValuesPanel } from '../column-mapping/sample-values-panel'
import type { ColumnMappingUI } from '../types'

interface StepMapColumnsProps {
  jobId: string
  onComplete: () => void
  /** Called when mapping counts change (for step card display) */
  onMappingChange?: (mappedCount: number, totalColumns: number) => void
}

/** Everything `saveColumnMapping` needs beyond the job + column index. */
interface ColumnSavePayload {
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: string
  matchField?: string
  relationConfig?: {
    relatedEntityDefinitionId: string
    relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
    matchField?: string
    onNoMatch?: 'create' | 'blank' | 'fail'
    linkMode?: 'add' | 'set'
  }
  options?: Array<{ value: string; label: string }>
}

/**
 * Step 2: Column mapping.
 * Two-panel layout: mapping table on left, sample values preview on right.
 * Sample values panel updates on row hover.
 *
 * The identity toggle is a per-COLUMN write with per-JOB consequences: it moves
 * `identifierFieldKeys` and can flip `defaultStrategy`. Every write here
 * therefore invalidates BOTH the column read and the job read, updating one
 * optimistically and leaving the other alone is how the mode selector and the
 * preview go stale while looking authoritative.
 */
export function StepMapColumns({ jobId, onComplete, onMappingChange }: StepMapColumnsProps) {
  const [mappings, setMappings] = useState<ColumnMappingUI[]>([])
  const [selectedColumn, setSelectedColumn] = useState<number | null>(null)
  const [savingColumns, setSavingColumns] = useState<ReadonlySet<number>>(new Set())

  // Show selected column or first column by default
  const activeColumn = selectedColumn ?? (mappings.length > 0 ? 0 : null)

  // Fetch job details and available fields
  const { data: job, isLoading: jobLoading } = api.dataImport.getJob.useQuery({ jobId })
  const { data: fields, isLoading: fieldsLoading } = api.dataImport.getImportableFields.useQuery(
    { entityDefinitionId: job?.importMapping?.entityDefinitionId ?? '', includeIdentifiers: true },
    { enabled: !!job?.importMapping?.entityDefinitionId }
  )
  const { data: mappableProperties } = api.dataImport.getMappableProperties.useQuery({ jobId })

  const saveColumnMapping = api.dataImport.saveColumnMapping.useMutation()
  const autoMapColumns = api.dataImport.autoMapColumns.useMutation()
  const setImportStrategy = api.dataImport.setImportStrategy.useMutation()
  const utils = api.useUtils()
  const { getResourceById } = useResources()

  /**
   * Read back from the server, never computed here. `saveMappingProperty`
   * flips the mode to `create-or-update` the first time an identifier column is
   * flagged and back to `create` when the last one is cleared; a second local
   * derivation of that rule would be a second thing to keep in sync.
   */
  const mode: ImportStrategyMode = job?.importMapping?.defaultStrategy ?? 'create'
  const identifierFieldKeys = useMemo(
    () => job?.importMapping?.identifierFieldKeys ?? [],
    [job?.importMapping?.identifierFieldKeys]
  )

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
        // Use saved values from server instead of hardcoded defaults. The column is a plain
        // `string` server-side; anything other than 'skip' means the column is mapped.
        targetType: prop.targetType === 'skip' ? 'skip' : 'particle',
        targetFieldKey: prop.targetFieldKey ?? null,
        customFieldId: prop.customFieldId ?? null,
        resolutionType: prop.resolutionType ?? 'text:value',
        matchField: prop.matchField ?? null,
        identityRole: prop.identityRole ?? null,
        mergeStrategy: prop.mergeStrategy ?? null,
        onNoMatch: prop.onNoMatch ?? null,
        linkMode: prop.linkMode ?? null,
        distinctValueCount: prop.distinctValueCount ?? 0,
        totalValueCount: prop.totalValueCount ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isMapped: !!prop.targetFieldKey,
        suggestedField: null,
      }))
      setMappings(initialMappings)
    }
  }, [mappableProperties, fields, job?.importMappingId])

  // Report mapping counts to parent whenever mappings change
  useEffect(() => {
    if (mappings.length > 0) {
      const mappedCount = mappings.filter((m) => m.isMapped).length
      onMappingChange?.(mappedCount, mappings.length)
    }
  }, [mappings, onMappingChange])

  /** Mark a column busy so its write controls cannot be double-fired. */
  const markSaving = useCallback((columnIndex: number, saving: boolean) => {
    setSavingColumns((prev) => {
      const next = new Set(prev)
      if (saving) next.add(columnIndex)
      else next.delete(columnIndex)
      return next
    })
  }, [])

  /**
   * Both reads move together, always.
   *
   * `identifierFieldKeys` and `defaultStrategy` live on the JOB while the identity
   * flag lives on the COLUMN, so a column write can silently change what the
   * mode selector and the plan preview should be showing.
   */
  const refreshMappingState = useCallback(async () => {
    await Promise.all([
      utils.dataImport.getMappableProperties.invalidate({ jobId }),
      utils.dataImport.getJob.invalidate({ jobId }),
    ])
  }, [jobId, utils.dataImport])

  /**
   * Build the full `saveColumnMapping` payload for a column.
   *
   * The whole `relationConfig` is resent every time, because
   * `saveMappingProperty` REBUILDS that object from its input rather than
   * merging it, omitting `onNoMatch` on a merge-strategy save would silently
   * revert the no-match policy.
   *
   * The relation resolution type comes from `buildRelationColumnPolicy`, the
   * same function the resolver uses. The old code hardcoded
   * `isRelation && matchField ? 'relation:match' : suggest(...)`, which made
   * `relation:create` unreachable from the wizard no matter what the policy said.
   */
  const buildPayload = useCallback(
    (
      mapping: Pick<ColumnMappingUI, 'matchField' | 'onNoMatch' | 'linkMode'> & {
        /** The column's stored resolution type, or undefined on a retarget. */
        resolutionType?: string | null
      },
      field: ImportableField | undefined,
      overrides: {
        targetFieldKey?: string | null
        matchField?: string
        onNoMatch?: 'create' | 'blank' | 'fail'
        linkMode?: 'add' | 'set'
        resolutionType?: ResolutionType
      } = {}
    ): ColumnSavePayload => {
      const targetFieldKey =
        overrides.targetFieldKey !== undefined ? overrides.targetFieldKey : null

      if (!field || !targetFieldKey) {
        return {
          targetFieldKey: null,
          customFieldId: null,
          resolutionType: 'text:value',
        }
      }

      if (field.isRelation && field.relationConfig) {
        const targetResource = getResourceById(field.relationConfig.relatedEntityDefinitionId)
        const chosen = {
          matchField: overrides.matchField ?? mapping.matchField ?? undefined,
          onNoMatch: overrides.onNoMatch ?? mapping.onNoMatch ?? undefined,
          linkMode: overrides.linkMode ?? mapping.linkMode ?? undefined,
        }

        // Without the target resource cached we cannot resolve the display field,
        // so persist what was chosen and let the server's own defaults apply.
        const policy = targetResource
          ? buildRelationColumnPolicy(targetResource, field.relationConfig.relationshipType, chosen)
          : null

        return {
          targetFieldKey,
          customFieldId: field.id ?? null,
          resolutionType: policy?.resolutionType ?? 'relation:match',
          matchField: policy?.matchField ?? chosen.matchField,
          relationConfig: {
            relatedEntityDefinitionId: field.relationConfig.relatedEntityDefinitionId,
            relationshipType: field.relationConfig.relationshipType,
            matchField: policy?.matchField ?? chosen.matchField,
            onNoMatch: policy?.onNoMatch ?? chosen.onNoMatch,
            linkMode: policy?.linkMode ?? chosen.linkMode,
          },
          options: field.options,
        }
      }

      // A scalar column's type is a CHOICE, so the stored one is carried across
      // every unrelated re-save. Recomputing `suggestResolutionType` here
      // unconditionally is what would silently revert a user's `select:create`
      // or `number:integer` the next time they touched the identity toggle.
      // It is re-validated against the target rather than trusted: after a
      // retarget the old type usually is not offered on the new field.
      const chosenType = overrides.resolutionType ?? mapping.resolutionType ?? undefined
      const validTypes = getValidResolutionTypes(field)
      const resolutionType =
        chosenType && validTypes.includes(chosenType as ResolutionType)
          ? chosenType
          : suggestResolutionType(field)

      return {
        targetFieldKey,
        customFieldId: field.id ?? null,
        resolutionType,
        options: field.options,
      }
    },
    [getResourceById]
  )

  const handleMappingChange = async (
    columnIndex: number,
    fieldKey: string | null,
    _resolutionType: string,
    matchField?: string
  ) => {
    // Find if another column is using this fieldKey (for replacement)
    const existingMapping = fieldKey
      ? mappings.find((m) => m.targetFieldKey === fieldKey && m.sourceColumnIndex !== columnIndex)
      : null

    // Get the target field to check if it's a relation
    const targetField = fieldKey ? fields?.find((f) => f.key === fieldKey) : undefined

    // Retargeting drops the column's identity and policy server-side, they
    // are statements about a field this column no longer feeds. Build from the
    // NEW target only, never from what the column used to carry.
    const payload = buildPayload(
      { matchField: null, onNoMatch: null, linkMode: null, resolutionType: null },
      targetField,
      {
        targetFieldKey: fieldKey,
        matchField,
      }
    )

    // Update local state - clear old mapping if replacing, then set new mapping
    setMappings((prev) =>
      prev.map((m): ColumnMappingUI => {
        // Clear the old column that had this field
        if (existingMapping && m.sourceColumnIndex === existingMapping.sourceColumnIndex) {
          return {
            ...m,
            targetFieldKey: null,
            targetType: 'skip',
            matchField: null,
            identityRole: null,
            mergeStrategy: null,
            onNoMatch: null,
            linkMode: null,
            isMapped: false,
          }
        }
        // Set the new mapping
        if (m.sourceColumnIndex === columnIndex) {
          return {
            ...m,
            targetFieldKey: fieldKey,
            targetType: fieldKey ? 'particle' : 'skip',
            resolutionType: payload.resolutionType,
            matchField: payload.relationConfig?.matchField ?? null,
            identityRole: null,
            mergeStrategy: null,
            onNoMatch: payload.relationConfig?.onNoMatch ?? null,
            linkMode: payload.relationConfig?.linkMode ?? null,
            isMapped: !!fieldKey,
          }
        }
        return m
      })
    )

    markSaving(columnIndex, true)
    try {
      // Save to server - clear old mapping first if replacing (the server
      // rejects two columns mapped to one field, so the clear must land first)
      if (existingMapping) {
        await saveColumnMapping.mutateAsync({
          jobId,
          columnIndex: existingMapping.sourceColumnIndex,
          targetFieldKey: null,
          customFieldId: null,
          resolutionType: existingMapping.resolutionType,
        })
      }

      await saveColumnMapping.mutateAsync({ jobId, columnIndex, ...payload })
    } catch (error) {
      toastError({
        title: 'Could not save mapping',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      markSaving(columnIndex, false)
      // Resync BOTH reads with what the server actually holds.
      await refreshMappingState()
    }
  }

  /**
   * Flag / unflag this column as (part of) the match key.
   *
   * Tri-state on the wire: `{ kind: 'match' }` sets it, `null` clears it,
   * omitting it leaves it alone. Nothing here omits it, this control exists
   * precisely to move it.
   */
  const handleToggleIdentifier = async (columnIndex: number, next: boolean) => {
    const mapping = mappings.find((m) => m.sourceColumnIndex === columnIndex)
    if (!mapping?.targetFieldKey) return
    const field = fields?.find((f) => f.key === mapping.targetFieldKey)

    setMappings((prev) =>
      prev.map((m) =>
        m.sourceColumnIndex === columnIndex
          ? { ...m, identityRole: next ? { kind: 'match' as const } : null }
          : m
      )
    )

    markSaving(columnIndex, true)
    try {
      await saveColumnMapping.mutateAsync({
        jobId,
        columnIndex,
        ...buildPayload(mapping, field, { targetFieldKey: mapping.targetFieldKey }),
        identityRole: next ? { kind: 'match' } : null,
      })
    } catch (error) {
      toastError({
        title: 'Could not update the match key',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      markSaving(columnIndex, false)
      await refreshMappingState()
    }
  }

  /** Persist a per-column policy change (merge strategy / relation policy). */
  const handlePolicyChange = async (columnIndex: number, patch: ColumnPolicyPatch) => {
    const mapping = mappings.find((m) => m.sourceColumnIndex === columnIndex)
    if (!mapping?.targetFieldKey) return
    const field = fields?.find((f) => f.key === mapping.targetFieldKey)

    setMappings((prev) =>
      prev.map((m) =>
        m.sourceColumnIndex === columnIndex
          ? {
              ...m,
              mergeStrategy: patch.mergeStrategy ?? m.mergeStrategy,
              onNoMatch: patch.onNoMatch ?? m.onNoMatch,
              linkMode: patch.linkMode ?? m.linkMode,
            }
          : m
      )
    )

    markSaving(columnIndex, true)
    try {
      await saveColumnMapping.mutateAsync({
        jobId,
        columnIndex,
        ...buildPayload(mapping, field, {
          targetFieldKey: mapping.targetFieldKey,
          onNoMatch: patch.onNoMatch,
          linkMode: patch.linkMode,
        }),
        // Omitted when unchanged, the tri-state leaves the stored value alone.
        mergeStrategy: patch.mergeStrategy,
      })
    } catch (error) {
      toastError({
        title: 'Could not save the column policy',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      markSaving(columnIndex, false)
      await refreshMappingState()
    }
  }

  /**
   * Change how a column's cells are READ.
   *
   * 🛑 The write is not the whole job. `processColumnValues` looks every
   * distinct value up in `ImportValueResolution` before resolving anything, so
   * a re-run after a type change would hit the cache for every value and leave
   * the old `error: No matching option` in place. `saveMappingProperty` drops
   * those rows when the type moves (`invalidateColumnResolutions`) and clears
   * `allowPlanGeneration`, which is what makes the review step re-queue
   * `resolveValuesJob` and actually re-resolve the column.
   */
  const handleResolutionTypeChange = async (columnIndex: number, next: ResolutionType) => {
    const mapping = mappings.find((m) => m.sourceColumnIndex === columnIndex)
    if (!mapping?.targetFieldKey) return
    const field = fields?.find((f) => f.key === mapping.targetFieldKey)

    setMappings((prev) =>
      prev.map((m) => (m.sourceColumnIndex === columnIndex ? { ...m, resolutionType: next } : m))
    )

    markSaving(columnIndex, true)
    try {
      await saveColumnMapping.mutateAsync({
        jobId,
        columnIndex,
        ...buildPayload(mapping, field, {
          targetFieldKey: mapping.targetFieldKey,
          resolutionType: next,
        }),
      })
    } catch (error) {
      toastError({
        title: 'Could not change how this column is read',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      markSaving(columnIndex, false)
      await refreshMappingState()
    }
  }

  const handleModeChange = async (nextMode: ImportStrategyMode) => {
    try {
      await setImportStrategy.mutateAsync({ jobId, mode: nextMode })
    } catch (error) {
      toastError({
        title: 'Could not change the import mode',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      await utils.dataImport.getJob.invalidate({ jobId })
    }
  }

  const handleAutoMap = async () => {
    try {
      const result = await autoMapColumns.mutateAsync({ jobId })

      // Immediate feedback; the invalidation below replaces this with the
      // server's own view, including the identity flags auto-map just set.
      setMappings((prev) =>
        prev.map((m): ColumnMappingUI => {
          const autoMapped = result.mappings.find((r) => r.columnIndex === m.sourceColumnIndex)
          if (!autoMapped) return m
          return {
            ...m,
            targetFieldKey: autoMapped.targetFieldKey,
            targetType: autoMapped.targetFieldKey ? 'particle' : 'skip',
            resolutionType: autoMapped.resolutionType,
            isMapped: !!autoMapped.targetFieldKey,
            suggestedField: autoMapped.targetFieldKey,
          }
        })
      )
    } catch (error) {
      toastError({
        title: 'Auto-mapping failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      await refreshMappingState()
    }
  }

  const mappedCount = mappings.filter((m) => m.isMapped).length

  /**
   * An incomplete mapping blocks Continue.
   *
   * A relation column with no match field is unresolvable, every value reports
   * "No match found" and, where the relation is required, every row fails. The
   * server now always persists an explicit match field, so this should be
   * unreachable; it stays because a state the engine rejects must not be a state
   * the UI calls finished.
   */
  const incompleteMappings = useMemo(
    () =>
      mappings.filter((m) =>
        isMappingIncomplete(
          m,
          fields?.find((f) => f.key === m.targetFieldKey)
        )
      ),
    [mappings, fields]
  )
  const canContinue = mappedCount > 0 && incompleteMappings.length === 0

  if (jobLoading || fieldsLoading) {
    return (
      <div className='flex flex-col items-center justify-center flex-1 min-h-0 h-full'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon' className='bg-background'>
              <Loader2 className='animate-spin' />
            </EmptyMedia>
            <EmptyTitle>Loading...</EmptyTitle>
            <EmptyDescription>Fetching column mappings</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className=''>
      {/* Header with mode selector and auto-map */}
      <div className='flex sm:items-center justify-between sticky top-0 px-4 border-b bg-muted/80 backdrop-blur py-3 sm:py-0 sm:h-12 z-10 flex-col sm:flex-row space-y-2 sm:space-y-0'>
        <div className='flex items-center gap-2'>
          <h3 className='font-medium'>Column Mappings</h3>
          <p className='text-sm text-muted-foreground'>
            {mappedCount} of {mappings.length} columns mapped
          </p>
          {incompleteMappings.length > 0 && (
            <span className='flex items-center gap-1 text-sm text-amber-600 dark:text-amber-500'>
              <AlertTriangle className='size-3.5' />
              {incompleteMappings.length} need a match field
            </span>
          )}
        </div>
        <div className='flex items-center gap-2 flex-row'>
          <ImportModeSelector
            mode={mode}
            identifierFieldKeys={identifierFieldKeys}
            disabled={setImportStrategy.isPending}
            onChange={handleModeChange}
          />
          <Button
            variant='outline'
            size='sm'
            onClick={handleAutoMap}
            loading={autoMapColumns.isPending}
            loadingText='Auto-mapping...'>
            <Wand2 />
            Auto-map Columns
          </Button>
          <Button onClick={onComplete} disabled={!canContinue} size='sm'>
            Continue to Review
          </Button>
        </div>
      </div>

      {/* Two-panel layout: mapping table + sample values preview */}
      <div className='flex gap-4 flex-col sm:flex-row'>
        {/* Left: Mapping table (CSV Column | Maps To) */}
        <div className='flex-1 min-w-0 shrink-0'>
          <ColumnMappingTable
            mappings={mappings}
            availableFields={fields ?? []}
            activeColumn={activeColumn}
            mode={mode}
            savingColumns={savingColumns}
            onSelectColumn={setSelectedColumn}
            onChange={handleMappingChange}
            onToggleIdentifier={handleToggleIdentifier}
            onPolicyChange={handlePolicyChange}
            onResolutionTypeChange={handleResolutionTypeChange}
          />
        </div>

        {/* Right: Sample values panel (shows on hover/click, defaults to first column) */}
        <div className='w-[300px] shrink-0 pe-6 mx-auto sm:mx-0'>
          <SampleValuesPanel mapping={mappings.find((m) => m.sourceColumnIndex === activeColumn)} />
        </div>
      </div>
    </div>
  )
}
