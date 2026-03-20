// apps/web/src/components/workflow/dialogs/entity-requirements-step.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Check, Database, Download } from 'lucide-react'
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
  onInstallEntity: (templateId: string) => void
}

/**
 * Shows entity readiness status for a workflow template.
 * Uses client-side resolution via useResources() (same as EntityTemplateDialog).
 */
export function EntityRequirementsStep({
  requiredEntities,
  onInstallEntity,
}: EntityRequirementsStepProps) {
  const { resources, getResourceById } = useResources()

  // Client-side resolution: check which entities exist using the same
  // approach as EntityTemplateDialog (apiSlug lookup via useResources).
  // `resources` is included as a dependency because `getResourceById` is a
  // stable function ref from Zustand and won't trigger recomputation alone.
  const entityStatuses = useMemo(() => {
    return requiredEntities.map((req) => {
      const isSystem = req.entityTemplateId.startsWith('__system:')

      if (isSystem) {
        return { ...req, status: 'ready' as const }
      }

      const existing = getResourceById(req.apiSlug)
      if (existing) {
        return { ...req, status: 'ready' as const }
      }

      return { ...req, status: 'missing' as const }
    })
  }, [requiredEntities, resources, getResourceById])

  return (
    <div className='space-y-2'>
      {entityStatuses.map((entity) => (
        <div
          key={entity.entityTemplateId}
          className='flex items-center justify-between rounded-lg border p-2'>
          <div className='flex items-center gap-2'>
            {entity.icon ? (
              <EntityIcon iconId={entity.icon} color={entity.color} size='xs' inverse />
            ) : (
              <Database className='size-4 text-muted-foreground shrink-0' />
            )}
            <span className='text-sm'>
              {entity.name || entity.entityTemplateId || entity.apiSlug}
            </span>
            {!entity.required && (
              <Badge variant='outline' className='text-xs'>
                Optional
              </Badge>
            )}
          </div>

          {entity.status === 'missing' ? (
            <Button
              variant='outline'
              size='sm'
              className='h-6 text-xs'
              onClick={() => onInstallEntity(entity.entityTemplateId)}>
              <Download className='size-3' />
              Install
            </Button>
          ) : (
            <Badge variant='gray'>
              <Check className='mr-1' />
              Installed
            </Badge>
          )}
        </div>
      ))}
    </div>
  )
}
