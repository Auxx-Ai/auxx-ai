// src/app/onboarding/page.tsx
'use client'
import { OrganizationType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
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
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { updateUser } from '~/auth/auth-client' // Adjust the import based on your auth setup
import { AvatarUpload } from '~/components/file-upload/ui/avatar-upload'
import { api } from '~/trpc/react'

const formSchema = z.object({
  orgType: z.enum([OrganizationType.INDIVIDUAL, OrganizationType.TEAM]),
  name: z.string().min(2, { error: 'Name must be at least 2 characters.' }),
  website: z.url().optional().or(z.literal('')),
})
export default function Onboarding() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const updateOrganization = api.organization.update.useMutation({
    // onSuccess: () => {
    // router.push('/app/settings')
    // },
  })
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: { orgType: OrganizationType.INDIVIDUAL, name: '', website: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  })
  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true)
    try {
      await updateOrganization.mutateAsync({
        name: values.name,
        type: values.orgType,
        website: values.website || undefined,
      })
      await updateUser({ completedOnboarding: true })
      router.push('/app') // Redirect to the main app dashboard
    } catch (error) {
      console.error('Failed to create organization:', error)
      setIsSubmitting(false)
    }
  }
  return (
    <div className='grid grid-cols-2  w-full '>
      {/* Left column: Onboarding form */}
      <Card className='relative border-none bg-transparent shadow-none border-primary-200 p-14'>
        <CardHeader>
          <CardTitle className='text-xl font-normal'>Let's get to know you</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
              <AvatarUpload />
              <FormField
                control={form.control}
                name='orgType'
                render={({ field }) => (
                  <FormItem className='space-y-3'>
                    <FormLabel>How will you use this app?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className='flex flex-col space-y-1'>
                        <FormItem className='flex items-center space-x-3 space-y-0'>
                          <FormControl>
                            <RadioGroupItem value={OrganizationType.INDIVIDUAL} />
                          </FormControl>
                          <FormLabel className='font-normal'>Individual - Just for me</FormLabel>
                        </FormItem>
                        <FormItem className='flex items-center space-x-3 space-y-0'>
                          <FormControl>
                            <RadioGroupItem value={OrganizationType.TEAM} />
                          </FormControl>
                          <FormLabel className='font-normal'>
                            Team - For my organization or team
                          </FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormDescription>
                      {field.value === OrganizationType.INDIVIDUAL
                        ? 'You can always invite team members later.'
                        : "You'll be able to invite team members after setup."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {form.watch('orgType') === OrganizationType.INDIVIDUAL
                        ? 'Your name'
                        : 'Organization name'}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={
                          form.watch('orgType') === OrganizationType.INDIVIDUAL
                            ? 'John Doe'
                            : 'Acme Corp'
                        }
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='website'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder='https://example.com' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type='submit' className='w-full' disabled={isSubmitting}>
                {isSubmitting ? 'Setting up...' : 'Continue'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      {/* Right column: Placeholder for future content or illustration */}
      <div className='flex items-center justify-center '>
        {/* Replace with illustration, info, or onboarding tips */}
        <span className='text-muted-foreground text-lg'>Welcome to Auxx.ai! 🚀</span>
      </div>
    </div>
  )
}
