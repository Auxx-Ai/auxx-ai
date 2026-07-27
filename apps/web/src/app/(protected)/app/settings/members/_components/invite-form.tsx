// apps/web/src/app/(protected)/app/settings/members/_components/invite-form.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '~/trpc/react'
import {
  defaultInviteProfile,
  InviteProfileSelect,
  roleLabel,
  seatClassLabel,
  useInvitableProfiles,
} from './invite-profile-select'

const formSchema = z.object({
  email: z.email({ error: 'Please enter a valid email address.' }),
  /** Optional: with no profiles readable the invitation binds nothing and the
   * member resolves to the system template for their role (§1.3). */
  permissionProfileId: z.string().optional(),
})
interface InviteFormProps {
  organizationId: string
  onInviteSuccess?: () => void // Optional: Callback to close popover, etc.
}
export default function InviteForm({ organizationId, onInviteSuccess }: InviteFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { profiles } = useInvitableProfiles()
  const inviteUser = api.member.invite.useMutation({
    onSuccess: () => {
      form.reset()
      onInviteSuccess?.()
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
      setIsSubmitting(false)
    },
  })
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: { email: '', permissionProfileId: undefined },
  })
  const permissionProfileId = form.watch('permissionProfileId')
  const selectedProfile = profiles.find((profile) => profile.id === permissionProfileId)

  // Start on the Member baseline once the profile list arrives.
  useEffect(() => {
    if (permissionProfileId || profiles.length === 0) return
    const fallback = defaultInviteProfile(profiles)
    if (fallback) form.setValue('permissionProfileId', fallback.id)
  }, [form, permissionProfileId, profiles])

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!organizationId) {
      toastError({ title: 'Error', description: 'No organization selected.' })
      return
    }
    setIsSubmitting(true)
    try {
      await inviteUser.mutateAsync({
        email: values.email,
        // No `role`: the profile declares both the seat class and the rank it
        // confers (plan 21 §2.a.3), so the server derives both from it and caps
        // against them. The input default (`USER`) only matters for the
        // no-profile fallback (§1.3).
        permissionProfileId: values.permissionProfileId ?? null,
      })
      setIsSubmitting(false)
    } catch (error) {
      // Error is handled in the mutation callbacks
    }
  }
  return (
    <div className='mx-auto max-w-md py-10'>
      <Card>
        <CardHeader>
          <CardTitle>Invite Team Members</CardTitle>
          <CardDescription>Add people to your organization.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
              <FormField
                control={form.control}
                name='email'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder='colleague@example.com' {...field} />
                    </FormControl>
                    <FormDescription>
                      Enter the email address of the person you want to invite.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {profiles.length > 0 ? (
                <FormField
                  control={form.control}
                  name='permissionProfileId'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Permission profile</FormLabel>
                      <FormControl>
                        <InviteProfileSelect
                          value={field.value}
                          profiles={profiles}
                          onChange={(profile) => field.onChange(profile.id)}
                        />
                      </FormControl>
                      <FormDescription>
                        {selectedProfile
                          ? `${seatClassLabel(selectedProfile.seat)} · ${roleLabel(selectedProfile.role)} — what this invitation consumes and grants.`
                          : 'Sets what this member can do. Its seat class and rank are what the invitation consumes and grants.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              <div className='flex justify-between'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => router.push('/app/settings/members')}>
                  Cancel
                </Button>
                <Button type='submit' disabled={isSubmitting}>
                  {isSubmitting ? 'Sending...' : 'Send Invitation'}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
