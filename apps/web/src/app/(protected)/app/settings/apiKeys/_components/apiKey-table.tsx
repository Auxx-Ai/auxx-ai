'use client'
import { Button } from '@auxx/ui/components/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { format } from 'date-fns'
import { ComponentIcon, PlusIcon } from 'lucide-react'
import React from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import { CreateAPIKeyButton, RevokeAPIKeyButton } from './create-api-key-button'

type Props = { initialData: any }

function ApiKeyTable({ initialData }: Props) {
  // const apiKeys = []
  const [isOpen, setIsOpen] = React.useState(false)
  const { data: apiKeys, isLoading } = api.apiKey.getAll.useQuery(
    {},
    {
      initialData: initialData,
    }
  )
  return (
    <SettingsPage
      title='API Keys'
      description='Connect to the Auxx.Ai API'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }]}
      button={<CreateAPIKeyButton open={isOpen} onOpenChange={setIsOpen} />}>
      {apiKeys && apiKeys.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-[200px]'>Name</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className='text-right'></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys.map((apiKey) => (
              <TableRow key={apiKey.id}>
                <TableCell className='font-medium'>{apiKey.name}</TableCell>
                <TableCell>{format(apiKey.createdAt, 'MM/dd/yyyy, h:mm a')}</TableCell>
                <TableCell className='text-right'>
                  <RevokeAPIKeyButton
                    id={apiKey.id}
                    buttonProps={{ variant: 'outline-solid', size: 'sm' }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : isLoading ? (
        <EmptyState
          icon={ComponentIcon}
          iconClassName='animate-spin'
          title='Loading...'
          description={<>Hang on tight while we load your api keys...</>}
          button={<div className='h-12'></div>}
        />
      ) : (
        <EmptyState
          icon={ComponentIcon}
          title='Create an API Key'
          description={<>Connect your application to Auxx.Ai</>}
          button={
            <Button
              size='sm'
              variant='outline'
              disabled={isLoading}
              onClick={() => setIsOpen(true)}>
              <PlusIcon className='h-4 w-4' />
              Create Api Key
            </Button>
          }
        />
      )}
    </SettingsPage>
  )
}

export default ApiKeyTable
