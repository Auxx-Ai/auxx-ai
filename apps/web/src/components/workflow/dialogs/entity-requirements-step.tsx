// apps/web/src/components/workflow/dialogs/entity-requirements-step.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { AlertTriangle, Check, CircleDashed, Database, X } from 'lucide-react'

/** Client-safe subset of RequiredEntity (mirrors server type) */
interface RequiredEntity {
  entityTemplateId: string
  fieldMapping: Record<string, string>
  requiredFields: string[]
  companionTemplateIds?: string[]
  required: boolean
}

/** Client-safe subset of EntityResolutionResult (mirrors server type) */
interface EntityResolutionResult {
  entityIdMap: Record<string, string>
  fieldIdMap: Record<string, Record<string, string>>
  missingFields: Array<{
    entityTemplateId: string
    entityDefId: string
    missingFieldNames: string[]
  }>
  missingEntities: string[]
  allResolved: boolean
}

interface EntityRequirementsStepProps {
  requiredEntities: RequiredEntity[]
  readiness: EntityResolutionResult
  /** Map of entityTemplateId → display name (from template registry, resolved server-side) */
  entityNames: Record<string, string>
  onInstallEntities: (templateIds: string[]) => void
  onSkip: () => void
  onContinue: () => void
  isInstalling?: boolean
}

/**
 * Shows entity readiness status for a workflow template.
 * Displayed between template selection and workflow creation.
 */
export function EntityRequirementsStep({
  requiredEntities,
  readiness,
  entityNames,
  onInstallEntities,
  onSkip,
  onContinue,
  isInstalling,
}: EntityRequirementsStepProps) {
  const hasMissingEntities = readiness.missingEntities.length > 0
  const hasMissingFields = readiness.missingFields.length > 0

  return (
    <div className='space-y-4'>
      <div>
        <h3 className='text-sm font-medium'>Entity Requirements</h3>
        <p className='text-xs text-muted-foreground mt-1'>
          This workflow uses custom entities. Review their status below.
        </p>
      </div>

      <div className='space-y-2'>
        {requiredEntities.map((req) => {
          const isSystem = req.entityTemplateId.startsWith('__system:')
          const isResolved = req.entityTemplateId in readiness.entityIdMap
          const hasMissing = readiness.missingFields.some(
            (m) => m.entityTemplateId === req.entityTemplateId
          )
          const isMissingEntity = readiness.missingEntities.includes(req.entityTemplateId)
          const name =
            entityNames[req.entityTemplateId] ?? req.entityTemplateId.replace('__system:', '')

          return (
            <div
              key={req.entityTemplateId}
              className='flex items-center gap-3 rounded-lg border p-2.5'>
              <Database className='size-4 text-muted-foreground shrink-0' />

              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2'>
                  <span className='text-sm font-medium truncate'>{name}</span>
                  {isSystem && (
                    <Badge variant='secondary' className='text-xs'>
                      System
                    </Badge>
                  )}
                  {!req.required && (
                    <Badge variant='outline' className='text-xs'>
                      Optional
                    </Badge>
                  )}
                </div>
              </div>

              {/* Status badge */}
              {isMissingEntity ? (
                <Badge variant='destructive' className='text-xs shrink-0'>
                  <X className='size-3' />
                  Not found
                </Badge>
              ) : hasMissing ? (
                <Badge
                  variant='outline'
                  className='text-xs shrink-0 border-amber-300 text-amber-700'>
                  <AlertTriangle className='size-3' />
                  Missing fields
                </Badge>
              ) : isResolved ? (
                <Badge variant='secondary' className='text-xs shrink-0'>
                  <Check className='size-3' />
                  Ready
                </Badge>
              ) : (
                <Badge variant='outline' className='text-xs shrink-0'>
                  <CircleDashed className='size-3' />
                  Unknown
                </Badge>
              )}
            </div>
          )
        })}
      </div>

      {/* Missing fields detail */}
      {!hasMissingEntities && hasMissingFields && (
        <div className='rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-50/10 p-3 space-y-2'>
          <p className='text-xs text-amber-700'>
            Some entities are missing fields required by this workflow:
          </p>
          {readiness.missingFields.map((m) => (
            <p key={m.entityTemplateId} className='text-xs'>
              <strong>{entityNames[m.entityTemplateId] ?? m.entityTemplateId}</strong>
              {': '}
              {m.missingFieldNames.join(', ')}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      {hasMissingEntities ? (
        <div className='flex gap-2'>
          <Button
            size='sm'
            onClick={() => onInstallEntities(readiness.missingEntities)}
            loading={isInstalling}
            loadingText='Installing...'>
            Install Entities
          </Button>
          <Button variant='outline' size='sm' onClick={onSkip}>
            Skip
          </Button>
        </div>
      ) : hasMissingFields ? (
        <div className='flex gap-2'>
          <Button size='sm' onClick={onContinue}>
            Continue Anyway
          </Button>
        </div>
      ) : (
        <Button size='sm' onClick={onContinue}>
          Create Workflow
        </Button>
      )}
    </div>
  )
}
