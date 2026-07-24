// apps/web/src/app/(protected)/app/settings/custom-fields/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { ChevronDown, LayoutTemplate, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import { EntityRow } from '~/components/custom-fields/ui/entity-row'
import { EntityTemplateDialog } from '~/components/custom-fields/ui/entity-template-dialog'
import SettingsPage from '~/components/global/settings-page'
import { useResources } from '~/components/resources/hooks'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

const BASE_URL = `/app/settings/custom-fields`

/** Entity types that shouldn't appear in the custom fields list */
const HIDDEN_ENTITY_TYPES = ['signature', 'inbox', 'entity_group', 'tag']

export default function CustomFieldsPage() {
  // Reachable by any def-admin (not just OWNER/ADMIN) — the list is filtered to
  // the defs the member administers (perms v2 doc 09). Creating a *new* def is
  // org-level, so the Create actions stay admin-only below.
  const { isAdminOrOwner } = useUser({ requireOrganization: true })
  const { canAdministerDef } = useAccess()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const { isAtLimit, getLimit } = useFeatureFlags()

  // Get all resources (system + custom) from unified registry
  const { resources, customResources, isLoading } = useResources()
  const userCreatedEntityCount = customResources?.filter((r) => !r.entityType).length ?? 0
  const atEntityLimit = isAtLimit(FeatureKey.entities, userCreatedEntityCount)
  const entityLimit = getLimit(FeatureKey.entities)

  /** Navigate to entity fields page */
  function handleRowClick(slug: string) {
    router.push(`${BASE_URL}/${slug}`)
  }

  /** Open dialog in create mode or show limit dialog */
  function handleCreateFromBlank() {
    if (atEntityLimit) {
      setLimitDialogOpen(true)
    } else {
      setDialogOpen(true)
    }
  }

  /** Open template dialog or show limit dialog */
  function handleCreateFromTemplate() {
    if (atEntityLimit) {
      setLimitDialogOpen(true)
    } else {
      setTemplateDialogOpen(true)
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
            <TableHead className='hidden sm:table-cell'>Fields</TableHead>
            <TableHead className='w-[100px]'>
              {isAdminOrOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size='sm' variant='outline'>
                      <Plus />
                      Create
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem onClick={handleCreateFromBlank}>
                      <Plus /> Create Entity
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleCreateFromTemplate}
                      className='data-highlighted:bg-[#ffaa40]/10'>
                      <LayoutTemplate className='text-[#ffaa40]' />{' '}
                      <AnimatedGradientText>Create from template</AnimatedGradientText>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* All resources (system + custom) from unified registry, excluding hidden system types */}
          {!isLoading &&
            resources
              .filter((r) => !r.entityType || !HIDDEN_ENTITY_TYPES.includes(r.entityType))
              // Def-admin scoping: a member sees only the defs they administer.
              // Admins administer every def, so their list is unchanged.
              .filter((r) => canAdministerDef(r.entityDefinitionId))
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

      {templateDialogOpen && (
        <EntityTemplateDialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen} />
      )}

      {limitDialogOpen && (
        <LimitReachedDialog
          open={limitDialogOpen}
          onOpenChange={setLimitDialogOpen}
          icon={Plus}
          title='Entity Limit Reached'
          description={`You've reached the maximum of ${entityLimit} custom entities on your current plan.`}
        />
      )}
    </SettingsPage>
  )
}
