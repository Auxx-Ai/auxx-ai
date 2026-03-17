// apps/web/src/components/workflow/dialogs/entity-requirements-step.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Check, Database, X } from 'lucide-react'
import { useMemo } from 'react'
import { useResources } from '~/components/resources/hooks'

interface RequiredEntity {
  entityTemplateId: string
  name: string
  apiSlug: string
  icon?: string
  color?: string
  fieldMapping: Record<string, string>
  requiredFields: string[]
  companionTemplateIds?: string[]
  required: boolean
}

interface EntityRequirementsStepProps {
  requiredEntities: RequiredEntity[]
  onInstallEntities: (templateIds: string[]) => void
  onSkip: () => void
  onContinue: () => void
  isInstalling?: boolean
}

/**
 * Shows entity readiness status for a workflow template.
 * Uses client-side resolution via useResources() (same as EntityTemplateDialog).
 */
export function EntityRequirementsStep({
  requiredEntities,
  onInstallEntities,
  onSkip,
  onContinue,
  isInstalling,
}: EntityRequirementsStepProps) {
  const { getResourceById } = useResources()

  // Client-side resolution: check which entities exist using the same
  // approach as EntityTemplateDialog (apiSlug lookup via useResources)
  const entityStatuses = useMemo(() => {
    return requiredEntities.map((req) => {
      const isSystem = req.entityTemplateId.startsWith('__system:')

      if (isSystem) {
        // System entities always exist
        return { ...req, status: 'ready' as const }
      }

      // Check if entity exists by apiSlug (same as EntityTemplateDialog conflict detection)
      const existing = getResourceById(req.apiSlug)
      if (existing) {
        return { ...req, status: 'ready' as const }
      }

      return { ...req, status: 'missing' as const }
    })
  }, [requiredEntities, getResourceById])

  const missingEntities = entityStatuses.filter((e) => e.status === 'missing')
  const hasMissing = missingEntities.length > 0

  return (
    <div className='space-y-4'>
      <div>
        <h3 className='text-sm font-medium'>Entity Requirements</h3>
        <p className='text-xs text-muted-foreground mt-1'>
          This workflow uses custom entities. Review their status below.
        </p>
      </div>

      <div className='space-y-2'>
        {entityStatuses.map((entity) => {
          const isSystem = entity.entityTemplateId.startsWith('__system:')

          return (
            <div
              key={entity.entityTemplateId}
              className='flex items-center gap-3 rounded-lg border p-2.5'>
              {entity.icon ? (
                <EntityIcon iconId={entity.icon} color={entity.color} size='xs' inverse />
              ) : (
                <Database className='size-4 text-muted-foreground shrink-0' />
              )}

              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2'>
                  <span className='text-sm font-medium truncate'>
                    {entity.name || entity.entityTemplateId || entity.apiSlug}
                  </span>
                  {isSystem && (
                    <Badge variant='secondary' className='text-xs'>
                      System
                    </Badge>
                  )}
                  {!entity.required && (
                    <Badge variant='outline' className='text-xs'>
                      Optional
                    </Badge>
                  )}
                </div>
              </div>

              {entity.status === 'missing' ? (
                <Badge variant='destructive' className='text-xs shrink-0'>
                  <X className='size-3' /> Not found
                </Badge>
              ) : (
                <Badge variant='secondary' className='text-xs shrink-0'>
                  <Check className='size-3' /> Ready
                </Badge>
              )}
            </div>
          )
        })}
      </div>

      {/* Actions: only show buttons when there are issues */}
      {hasMissing ? (
        <div className='flex gap-2'>
          <Button
            size='sm'
            onClick={() => onInstallEntities(missingEntities.map((e) => e.entityTemplateId))}
            loading={isInstalling}
            loadingText='Installing...'>
            Install Entities
          </Button>
          <Button variant='outline' size='sm' onClick={onSkip}>
            Skip
          </Button>
        </div>
      ) : (
        // All resolved — no button here, parent's "Use this template" handles creation
        <div className='flex items-center gap-2 text-xs text-emerald-600'>
          <Check className='size-3.5' />
          <span>All entities are ready</span>
        </div>
      )}
    </div>
  )
}
