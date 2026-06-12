// apps/build/src/app/(portal)/[slug]/settings/api-keys/page.tsx

'use client'

import { KeyRound } from 'lucide-react'
import { useParams } from 'next/navigation'
import { api } from '~/trpc/react'
import SettingsHeader from '../_components/settings-header'
import { ApiKeyList } from './_components/api-key-list'
import { CreateApiKeyDialog } from './_components/create-api-key-dialog'

function ApiKeysSettingsPage() {
  const params = useParams<{ slug: string }>()

  const { data, isLoading } = api.apiKeys.list.useQuery(
    { developerSlug: params.slug },
    { enabled: !!params.slug }
  )

  return (
    <>
      <SettingsHeader title='API Keys' icon={<KeyRound className='size-4' />} />
      <div className='flex-1 overflow-y-auto min-h-0'>
        <div className='p-6 lg:py-12 max-w-3xl mx-auto'>
          <div className='flex flex-col space-y-6'>
            <div className='space-y-0'>
              <div className='text-xl font-semibold'>API Keys</div>
              <div className='text-base'>
                Create developer keys to publish apps from CI. Set the key as{' '}
                <code>AUXX_API_KEY</code> in your workflow.
              </div>
            </div>

            <div className='flex items-center justify-end'>
              <CreateApiKeyDialog developerSlug={params.slug} />
            </div>

            {isLoading ? (
              <div className='text-sm text-muted-foreground py-8 text-center'>Loading keys...</div>
            ) : (
              <ApiKeyList developerSlug={params.slug} keys={data ?? []} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default ApiKeysSettingsPage
