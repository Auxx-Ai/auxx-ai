// apps/web/src/app/(protected)/app/settings/signatures/page.tsx

import { Button } from '@auxx/ui/components/button'
import { PlusIcon } from 'lucide-react'
import Link from 'next/link'
import SettingsPage from '~/components/global/settings-page'
import { SignatureList } from '~/components/signatures/ui'

/**
 * Signatures settings page.
 * Lists all signatures with options to create, edit, and delete.
 */
export default function SignaturesPage() {
  return (
    <SettingsPage
      title='Email Signatures'
      description='Give your teammates access to predefined signatures on email channels by creating shared signatures.'
      button={
        <Link href='/app/settings/signatures/new'>
          <Button variant='outline' size='sm'>
            <PlusIcon className='h-4 w-4' />
            Add Signature
          </Button>
        </Link>
      }
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Signatures' }]}>
      <SignatureList />
    </SettingsPage>
  )
}
