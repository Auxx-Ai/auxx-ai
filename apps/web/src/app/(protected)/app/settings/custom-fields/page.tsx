// apps/web/src/app/(protected)/app/settings/custom-fields/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import { EntityRow } from '~/components/custom-fields/ui/entity-row'
import SettingsPage from '~/components/global/settings-page'
import { useResources } from '~/components/resources/hooks'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

const BASE_URL = `/app/settings/custom-fields`

/** Entity types that shouldn't appear in the custom fields list */
const HIDDEN_ENTITY_TYPES = ['signature', 'inbox', 'entity_group', 'tag']

export default function CustomFieldsPage() {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const { isAtLimit, getLimit } = useFeatureFlags()

  // Get all resources (system + custom) from unified registry
  const { resources, customResources, isLoading } = useResources()
  const userCreatedEntityCount = customResources?.filter((r) => !r.entityType).length ?? 0
  const atEntityLimit = isAtLimit(FeatureKey.entities, userCreatedEntityCount)
  const entityLimit = getLimit(FeatureKey.entities)
  console.log(
    'CustomFieldsPage: resources',
    customResources?.length,
    'limit',
    entityLimit,
    'atLimit',
    atEntityLimit
  )
  /** Navigate to entity fields page */
  function handleRowClick(slug: string) {
    router.push(`${BASE_URL}/${slug}`)
  }

  /** Open dialog in create mode or show limit dialog */
  function handleCreateEntity() {
    if (atEntityLimit) {
      setLimitDialogOpen(true)
    } else {
      setDialogOpen(true)
    }
  }

  return (
    <SettingsPage
      title='Custom Entities & Fields'
      description='Manage all the custom entities and fields in your organization.'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Custom Fields' }]}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Fields</TableHead>
            <TableHead className='w-[100px]'>
              <Button onClick={handleCreateEntity} size='sm' variant='outline'>
                <Plus />
                Create
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* All resources (system + custom) from unified registry, excluding hidden system types */}
          {!isLoading &&
            resources
              .filter((r) => !r.entityType || !HIDDEN_ENTITY_TYPES.includes(r.entityType))
              .map((resource) => (
                <EntityRow
                  key={resource.id}
                  label={resource.label}
                  type={resource.entityType ? 'System' : 'Custom'}
                  iconId={resource.icon}
                  color={resource.color}
                  onClick={() => handleRowClick(resource.apiSlug)}
                />
              ))}
        </TableBody>
      </Table>

      {dialogOpen && <EntityDefinitionDialog open={dialogOpen} onOpenChange={setDialogOpen} />}

      <LimitReachedDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
        icon={Plus}
        title='Entity Limit Reached'
        description={`You've reached the maximum of ${entityLimit} custom entities on your current plan.`}
      />
    </SettingsPage>
  )
}
