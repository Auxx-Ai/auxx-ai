import React from 'react'
import { api } from '~/trpc/server'
import { DeleteOrganizationSection } from '../../_components/delete-organization'
import Link from 'next/link'
import { Button } from '@auxx/ui/components/button'
import SettingsPage from '~/components/global/settings-page'

type Props = { params: Promise<{ organizationId: string }> }

async function DeleteOrganizationPage({ params }: Props) {
  const { organizationId } = await params

  const org = await api.organization.byId({ id: organizationId })

  return (
    <SettingsPage title="Delete Organization" description="This action cannot be undone.">
      <div className="p-6">
        <DeleteOrganizationSection organization={org} />

        <Link href={`/app/settings/organization`}>
          <Button variant="outline" className="mt-4">
            Back to Organization Settings
          </Button>
        </Link>
      </div>
    </SettingsPage>
  )
}

export default DeleteOrganizationPage
