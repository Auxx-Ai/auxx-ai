// apps/web/src/app/(protected)/app/settings/custom-fields/page.tsx
'use client'

import { useState } from 'react'
import SettingsPage from '~/components/global/settings-page'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { EntityRow } from '~/components/custom-fields/ui/entity-row'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import { useResources } from '~/components/resources/hooks'

const BASE_URL = `/app/settings/custom-fields`

export default function CustomFieldsPage() {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)

  // Get all resources (system + custom) from unified registry
  const { resources, isLoading } = useResources()

  /** Navigate to entity fields page */
  function handleRowClick(slug: string) {
    router.push(`${BASE_URL}/${slug}`)
  }

  /** Open dialog in create mode */
  function handleCreateEntity() {
    setDialogOpen(true)
  }

  return (
    <SettingsPage
      title="Custom Entities & Fields"
      description="Manage all the custom entities and fields in your organization."
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Custom Fields' }]}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Fields</TableHead>
            <TableHead className="w-[100px]">
              <Button onClick={handleCreateEntity} size="sm" variant="outline">
                <Plus />
                Create
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* All resources (system + custom) from unified registry */}
          {!isLoading &&
            resources.map((resource) => (
              <EntityRow
                key={resource.id}
                label={resource.label}
                type={resource.type === 'system' || resource.entityType ? 'System' : 'Custom'}
                iconId={resource.icon}
                color={resource.color}
                onClick={() => handleRowClick(resource.apiSlug)}
              />
            ))}
        </TableBody>
      </Table>

      {dialogOpen && <EntityDefinitionDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </SettingsPage>
  )
}
