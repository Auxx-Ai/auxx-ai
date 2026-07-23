'use client'
import { OrganizationRole, SeatType } from '@auxx/database/enums'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { SeatTypeSelect } from '~/components/permissions/ui/seat-type-select'
import { api } from '~/trpc/react'

const formSchema = z.object({
  email: z.email({ error: 'Please enter a valid email address.' }),
  role: z.enum(OrganizationRole, { error: 'Please select a valid role.' }),
  seatType: z.enum(SeatType, { error: 'Please select a valid seat type.' }),
})
interface InviteFormProps {
  organizationId: string
  onInviteSuccess?: () => void // Optional: Callback to close popover, etc.
}
export default function InviteForm({ organizationId, onInviteSuccess }: InviteFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inviteUser = api.member.invite.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Invitation sent',
        description: 'The user has been invited to your organization.',
      })
      form.reset()
      onInviteSuccess?.()
      router.refresh()
    },
    onError: (error) => {
      toastError({
        title: 'Error',
        description: error.message,
        // variant: 'destructive',
      })
      setIsSubmitting(false)
    },
  })
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: { email: '', role: OrganizationRole.USER, seatType: SeatType.full },
  })
  const seatType = form.watch('seatType')
  const isFieldSeat = seatType === SeatType.worker
  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!organizationId) {
      toastError({
        title: 'Error',
        description: 'No organization selected.',
        // variant: 'destructive',
      })
      return
    }
    setIsSubmitting(true)
    try {
      await inviteUser.mutateAsync({
        email: values.email,
        // Invariant §2.A: a field seat is always a Member.
        role: values.seatType === SeatType.worker ? OrganizationRole.USER : values.role,
        seatType: values.seatType,
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

              <FormField
                control={form.control}
                name='seatType'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Seat</FormLabel>
                    <FormControl>
                      <SeatTypeSelect
                        value={field.value}
                        onChange={(value) => {
                          field.onChange(value)
                          // A field seat is always a Member — force role.
                          if (value === SeatType.worker)
                            form.setValue('role', OrganizationRole.USER)
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Field seats only see their schedule and assigned jobs, and can be priced below
                      a full seat.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                    <FormDescription>
                      {isFieldSeat
                        ? 'Field seats are always members.'
                        : 'Admins can manage the organization and invite others. Users have standard access.'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
