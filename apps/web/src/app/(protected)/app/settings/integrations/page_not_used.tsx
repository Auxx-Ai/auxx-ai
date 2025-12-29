import Link from 'next/link'
import React from 'react'
import SettingsPage from '~/components/global/settings-page'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { ShopifyIcon } from '~/constants/menu'

type Props = {}

const INTEGRATION_PROVIDERS = [
  {
    title: 'Google',
    description: 'View your Gmail sync seettings and more ',
    icon: <ShopifyIcon />,
    slug: 'google',
  },
  {
    title: 'Shopify',
    description: 'Sync with your Shopify store and view your sync history ',
    icon: <ShopifyIcon />,
    slug: 'shopify',
  },
]

function IntegrationsPage({}: Props) {
  return (
    <SettingsPage
      title="Integrations"
      description="View all your integrations"
      backLink="/app/settings"
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Integrations' }]}>
      <div className="flex flex-col gap-y-5 pt-5">
        {INTEGRATION_PROVIDERS.map((integration) => (
          <Link href={`/app/settings/integrations/${integration.slug}`} key={integration.title}>
            <Card>
              <CardHeader>
                <div className="flex justify-between">
                  <div>
                    <CardTitle>{integration.title}</CardTitle>
                    <CardDescription>{integration.description}</CardDescription>
                  </div>
                  <div className="">{integration.icon}</div>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </SettingsPage>
  )
}

export default IntegrationsPage
