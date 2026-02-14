'use client'
import { Button } from '@auxx/ui/components/button'
import { CardContent, CardDescription, CardTitle } from '@auxx/ui/components/card'
import { ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
// ~/app/(protected)/app/settings/integrations/_components/integration-card.tsx
import type React from 'react'

interface IntegrationCardProps {
  type: string
  title: string
  description: string
  icon?: React.ReactNode
  disabled?: boolean
  disabledReason?: string
  comingSoon?: boolean
}

import { getIntegrationProviderIcon } from './integration-table'

/**
 * Get provider icon based on provider type
 */
// const getDefaultIcon = (type: string) => {
//   switch (type.toLowerCase()) {
//     case 'google':
//       return <GoogleIcon className="h-8 w-8 text-red-500" />
//     case 'outlook':
//       return <Mail className="h-8 w-8 text-blue-500" />
//     case 'facebook':
//       return <Facebook className="h-8 w-8 text-blue-600" />
//     case 'instagram':
//       return <Instagram className="h-8 w-8 text-pink-500" />
//     case 'openphone':
//       return <Phone className="h-8 w-8 text-green-500" />
//     default:
//       return <Mail className="h-8 w-8 text-gray-500" />
//   }
// }

/**
 * IntegrationCard component
 * Displays a card for an integration type with connect button
 */
export default function IntegrationCard({
  type,
  title,
  description,
  icon,
  disabled = false,
  disabledReason,
  comingSoon = false,
}: IntegrationCardProps) {
  const router = useRouter()

  const handleConnect = () => {
    if (disabled || comingSoon) return
    router.push(`/app/settings/integrations/new/${type.toLowerCase()}`)
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs ${comingSoon ? 'opacity-70' : ''}`}>
      <div className='flex flex-col space-y-1.5 p-3'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center space-x-2'>
            {icon || getIntegrationProviderIcon(type, 'size-8')}
            <CardTitle>{title}</CardTitle>
          </div>
          {comingSoon && (
            <div className='shrink-0 rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800'>
              Coming soon
            </div>
          )}
        </div>
        <CardDescription className='line-clamp-2 h-10'>{description}</CardDescription>
      </div>
      <CardContent className='pb-2'>
        {disabled && disabledReason && (
          <p className='text-sm text-muted-foreground'>{disabledReason}</p>
        )}
      </CardContent>
      <div className='flex items-center p-3 pt-0'>
        <Button
          onClick={handleConnect}
          disabled={disabled || comingSoon}
          className='w-full'
          variant={comingSoon ? 'outline' : 'outline'}>
          {comingSoon ? 'Coming Soon' : 'Connect'}
          {!comingSoon && <ExternalLink className='ml-2 h-4 w-4' />}
        </Button>
      </div>
    </div>
  )
}
