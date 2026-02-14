// apps/web/src/app/(protected)/app/settings/general/_components/list-passkeys.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Fingerprint, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { client } from '~/auth/auth-client'

/**
 * Component for managing user passkeys - listing, adding, and deleting passkeys
 * Includes automatic list refresh after add/delete operations
 */
export function ListPasskeys() {
  const { data, refetch } = client.useListPasskeys()
  const [isOpen, setIsOpen] = useState(false)
  const [passkeyName, setPasskeyName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null)

  /**
   * Handles adding a new passkey
   */
  const handleAddPasskey = async () => {
    if (!passkeyName) {
      toastError({ description: 'Passkey name is required' })
      return
    }
    setIsLoading(true)
    const res = await client.passkey.addPasskey({ name: passkeyName })
    setIsLoading(false)
    if (res?.error) {
      toastError({ description: res?.error.message })
    } else {
      toastSuccess({ description: 'Passkey added successfully. You can now use it to login.' })
      setPasskeyName('')
      refetch() // Refetch the passkeys list
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant='outline' size='sm'>
          <Fingerprint />
          <span>Passkeys {data?.length ? ` (${data?.length})` : ''}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className='sm:max-w-[425px] w-11/12'>
        <DialogHeader>
          <DialogTitle>Passkeys</DialogTitle>
          <DialogDescription className='sr-only'>List of passkeys</DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          {data?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((passkey) => (
                  <TableRow key={passkey.id}>
                    <TableCell>{passkey.name || 'My Passkey'}</TableCell>
                    <TableCell className='text-right'>
                      <button
                        onClick={async () => {
                          const res = await client.passkey.deletePasskey({
                            id: passkey.id,
                            fetchOptions: {
                              onRequest: () => {
                                setDeletingPasskeyId(passkey.id)
                              },
                              onSuccess: () => {
                                toastSuccess({ description: 'Passkey deleted successfully' })
                                setDeletingPasskeyId(null)
                                refetch() // Refetch the passkeys list
                              },
                              onError: (error) => {
                                toastError({ description: error.error.message })
                                setDeletingPasskeyId(null)
                              },
                            },
                          })
                        }}>
                        {deletingPasskeyId === passkey.id ? (
                          <Loader2 size={15} className='animate-spin' />
                        ) : (
                          <Trash2 size={15} className='cursor-pointer text-red-600' />
                        )}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          <div className='flex flex-col gap-2'>
            <div className='flex flex-col gap-2'>
              <Input
                id='passkey-name'
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                placeholder='My Passkey'
              />
            </div>
            <Button
              type='submit'
              variant='outline'
              onClick={handleAddPasskey}
              className='w-full'
              loading={isLoading}
              loadingText='Creating...'>
              <Fingerprint />
              {data?.length ? 'Add Passkey' : 'Create Passkey'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
