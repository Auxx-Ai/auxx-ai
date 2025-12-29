// ~/app/(dashboard)/signatures/page.tsx
import React from 'react'
import { api } from '~/trpc/server'
// import { SignatureList } from '~/components/signatures/signature-list'
import { Button } from '@auxx/ui/components/button'
import { PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { SignatureList } from './_components/signature-list'
import SettingsPage from '~/components/global/settings-page'

export default async function SignaturesPage() {
  const signatures = await api.signature.getAll()

  // return (
  //   <div className='container py-10'>
  //     <div className='mb-6 flex items-center justify-between'>
  //       <h1 className='text-2xl font-bold'>Email Signatures</h1>
  //       <Link href='/app/settings/signatures/new'>
  //         <Button>
  //           <PlusIcon className='mr-2 h-4 w-4' />
  //           Add Signature
  //         </Button>
  //       </Link>
  //     </div>

  //     <SignatureList signatures={signatures} />
  //   </div>
  // )

  return (
    <SettingsPage
      title="Email Signatures"
      description="Give your teammates access to predefined signatures on email channels by creating shared signatures."
      button={
        <Link href="/app/settings/signatures/new">
          <Button variant="outline" size="sm">
            <PlusIcon className="h-4 w-4" />
            Add Signature
          </Button>
        </Link>
      }
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Signatures' }]}>
      {/* <div className="p-8"> */}
      <SignatureList signatures={signatures} />
      {/* </div> */}
    </SettingsPage>
  )
}
