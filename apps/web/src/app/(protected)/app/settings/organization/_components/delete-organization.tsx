// src/app/(protected)/app/settings/organization/_components/delete-organization-section.tsx

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@auxx/ui/components/alert-dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useSession, signOut } from '~/auth/auth-client'

interface DeleteOrganizationSectionProps {
  organization: { id: string; name: string }
}

export function DeleteOrganizationSection({ organization }: DeleteOrganizationSectionProps) {
  const router = useRouter()
  const { data: session } = useSession() // Get session to access user email

  // getSession()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const deleteMutation = api.organization.deleteOrganization.useMutation({
    onSuccess: async () => {
      // Make onSuccess async
      toastSuccess({
        title: 'Organization Deletion Initiated',
        description: `${organization.name || 'The organization'} is being deleted. You will now be logged out.`,
        duration: 5000, // Give user a bit more time to read before logout
      })
      setIsDialogOpen(false)

      // Use a short delay to allow the toast to be seen briefly
      await new Promise((resolve) => setTimeout(resolve, 1500)) // Wait 1.5 seconds

      // Call signOut - redirects to sign-in page by default
      signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push('/login?message=org_deleted') // redirect to login page
          },
        },
      })
      // You can specify a callbackUrl if you want them to land elsewhere after logout
      // await signOut({ callbackUrl: '/login?message=org_deleted' }) // Example redirect with message

      // Note: Code after signOut might not execute reliably as the page will navigate away.
      // router.push('/app'); // No longer needed, signOut handles navigation
      // router.refresh(); // No longer needed
    },
    onError: (error) => {
      toastError({ title: 'Deletion Failed', description: error.message })
      // Don't log out on error
    },
  })

  const handleConfirmDelete = () => {
    setInputError(null) // Clear previous errors
    if (!session?.user?.email) {
      setInputError('Could not retrieve your email address. Please try again.')
      return
    }
    if (!confirmationEmail) {
      setInputError('Please enter your email address to confirm.')
      return
    }
    if (confirmationEmail.toLowerCase() !== session.user.email.toLowerCase()) {
      setInputError('The entered email does not match your logged-in email.')
      return
    }

    // If all checks pass, call the mutation
    deleteMutation.mutate({ organizationId: organization.id, confirmationEmail: confirmationEmail })
  }

  const handleOpenChange = (open: boolean) => {
    setIsDialogOpen(open)
    if (!open) {
      // Reset state when dialog closes
      setConfirmationEmail('')
      setInputError(null)
    }
  }

  return (
    <div className="group flex items-center border py-2 px-3 hover:bg-destructive/2 transition-colors duration-200 rounded-2xl border-destructive/50">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <div className="size-8 border border-destructive/10 bg-destructive/2 rounded-lg flex items-center justify-center group-hover:bg-destructive/5 transition-colors overflow-hidden shrink-0">
            <AlertTriangle className="size-4 text-destructive" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm text-destructive">Delete Organization</span>
            <span className="text-xs text-destructive/80">
              Permanently delete "{organization.name || 'this organization'}" and all associated
              data, including members, tickets, settings, and integrations. This action cannot be
              undone.
            </span>
          </div>
        </div>

        <AlertDialog open={isDialogOpen} onOpenChange={handleOpenChange}>
          <AlertDialogTrigger asChild>
            {/* Add logic here if only Owners should see this button */}
            <Button variant="destructive" size="sm">
              <Trash2 />
              Delete Organization
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                Are you absolutely sure?
              </AlertDialogTitle>
              <div className="text-sm">
                <strong className="my-3 block rounded-md bg-destructive/10 p-3 text-destructive">
                  WARNING: If this is the ONLY organization any member belongs to (including
                  yourself), their ENTIRE USER ACCOUNT on this platform will be PERMANENTLY DELETED
                  along with the organization.
                  <br />
                  <br /> This includes their login methods and all associated data. Ensure all
                  members are aware or have joined other organizations if they wish to retain their
                  accounts.
                </strong>
                <span>
                  This action is permanent and cannot be undone. This will delete the organization "
                  {organization.name || 'this organization'}" and all its data, including:
                </span>
                <ul className="mt-2 list-disc pl-5">
                  <li>All member access</li>
                  <li>Tickets, emails, contacts</li>
                  <li>Settings and integrations</li>
                  <li>Products, orders, etc. (if applicable)</li>
                </ul>
                <div className="mt-4 space-y-2">
                  <Label htmlFor="confirmationEmail" className="font-semibold mb-1">
                    To confirm, please type your email address:{' '}
                    <span className="font-normal text-muted-foreground">
                      ({session?.user?.email})
                    </span>
                  </Label>
                  <Input
                    id="confirmationEmail"
                    type="email"
                    value={confirmationEmail}
                    onChange={(e) => setConfirmationEmail(e.target.value)}
                    placeholder="your.email@example.com"
                    disabled={deleteMutation.isPending}
                    className={
                      inputError ? 'border-destructive focus-visible:ring-destructive' : ''
                    }
                  />
                  {inputError && <p className="text-xs text-destructive">{inputError}</p>}
                </div>
              </div>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={
                  deleteMutation.isPending ||
                  !confirmationEmail ||
                  confirmationEmail.toLowerCase() !== session?.user?.email?.toLowerCase()
                }
                loading={deleteMutation.isPending}
                loadingText="Deleting...">
                Delete Permanently
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
