// apps/web/src/app/(protected)/app/settings/members/_components/invite-popover.tsx
'use client'
import { OrganizationRole } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
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
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '~/trpc/react'
import {
  defaultInviteProfile,
  InviteProfileSelect,
  seatClassLabel,
  useInvitableProfiles,
} from './invite-profile-select'

const formSchema = z.object({
  email: z.email({ error: 'Please enter a valid email address.' }),
  role: z.enum(OrganizationRole, { error: 'Please select a valid role.' }),
  /** Optional: with no profiles readable the invitation binds nothing and the
   * member resolves to the system template for their role (§1.3). */
  permissionProfileId: z.string().optional(),
})
interface InviteFormProps {
  children?: ReactNode
}
export default function InviteFormPopover({ children }: InviteFormProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { profiles } = useInvitableProfiles()
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: { email: '', role: OrganizationRole.USER, permissionProfileId: undefined },
  })
  const permissionProfileId = form.watch('permissionProfileId')
  const selectedProfile = profiles.find((profile) => profile.id === permissionProfileId)
  // A field-seat profile is always a Member (§2.A) — the role select is locked.
  const isFieldSeat = selectedProfile?.seat === 'worker'

  // Start on the Member baseline once the profile list arrives.
  useEffect(() => {
    if (permissionProfileId || profiles.length === 0) return
    const fallback = defaultInviteProfile(profiles)
    if (fallback) form.setValue('permissionProfileId', fallback.id)
  }, [form, permissionProfileId, profiles])

  const inviteUser = api.member.invite.useMutation({
    onSuccess: () => {
      form.reset()
      setIsOpen(false)
      // The Members list is client-fetched, so invalidate rather than relying on
      // router.refresh (which only re-runs server components).
      utils.member.invitations.invalidate()
      utils.member.activeCount.invalidate()
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
      setIsSubmitting(false)
    },
  })
  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true)
    try {
      await inviteUser.mutateAsync({
        email: values.email,
        // Invariant §2.A: a field seat is always a Member.
        role: isFieldSeat ? OrganizationRole.USER : values.role,
        // The profile declares the seat class, so no seatType is sent — the
        // server derives it from the profile and caps against that class.
        permissionProfileId: values.permissionProfileId ?? null,
      })
      setIsSubmitting(false)
    } catch (error) {
      // Error is handled in the mutation callbacks
    }
  }
  const defaultTrigger = (
    <Button variant='outline' size='icon'>
      <Plus className='h-4 w-4' />
      <span className='sr-only'>Invite Team Member</span>
    </Button>
  )
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{children || defaultTrigger}</PopoverTrigger>
      <PopoverContent className='w-80' side='bottom' align='end'>
        <div className='grid gap-4'>
          <div className='space-y-2'>
            <h4 className='font-medium leading-none'>Invite Team Members</h4>
            <p className='text-sm text-muted-foreground'>Add people to your organization</p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
              <FormField
                control={form.control}
                name='email'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder='colleague@example.com' {...field} />
                    </FormControl>
                    <FormDescription className='text-xs'>
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
                          onChange={(profile) => {
                            field.onChange(profile.id)
                            if (profile.seat === 'worker')
                              form.setValue('role', OrganizationRole.USER)
                          }}
                        />
                      </FormControl>
                      <FormDescription className='text-xs'>
                        {selectedProfile
                          ? `${seatClassLabel(selectedProfile.seat)} — this is the seat the invitation consumes.`
                          : 'Sets what this member can do. Its seat class is what the invitation consumes.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              <FormField
                control={form.control}
                name='role'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isFieldSeat}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='Select a role' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={OrganizationRole.ADMIN} disabled={isFieldSeat}>
                          Admin
                        </SelectItem>
                        <SelectItem value={OrganizationRole.USER}>User</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription className='text-xs'>
                      {isFieldSeat
                        ? 'Field seats are always members.'
                        : 'Admins can manage the organization and invite others.'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='flex justify-end space-x-2'>
                <Button type='button' variant='outline' size='sm' onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button type='submit' size='sm' disabled={isSubmitting}>
                  {isSubmitting ? 'Sending...' : 'Send Invitation'}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </PopoverContent>
    </Popover>
  )
}
