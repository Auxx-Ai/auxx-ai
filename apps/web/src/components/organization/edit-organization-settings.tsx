// apps/web/src/components/organization/edit-organization-settings.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { toastError } from '@auxx/ui/components/toast'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Building, Check, Copy } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useDemo } from '~/hooks/use-demo'
import { useOrganization } from '~/hooks/use-organization'
import { useDehydratedStateContext } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

const orgSettingsSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.').max(100),
  handle: z.string(),
})

type OrgSettingsValues = z.infer<typeof orgSettingsSchema>

export function EditOrganizationSettings() {
  const organization = useOrganization()
  const { isDemo } = useDemo()
  const { patchOrganization } = useDehydratedStateContext()
  const { copied, copy } = useCopy({ toastMessage: 'Slug copied to clipboard' })

  const form = useForm<OrgSettingsValues>({
    resolver: standardSchemaResolver(orgSettingsSchema),
    defaultValues: { name: '', handle: '' },
    mode: 'onChange',
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable
  useEffect(() => {
    if (organization) {
      form.reset({
        name: organization.name || '',
        handle: isDemo ? 'demo-workspace' : organization.handle || '',
      })
    }
  }, [organization, isDemo])

  const updateOrganization = api.organization.update.useMutation({
    onSuccess: (_data, variables) => {
      if (organization) {
        patchOrganization(organization.id, { name: variables.name })
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to update organization', description: error.message })
    },
  })

  function onSubmit(data: OrgSettingsValues) {
    updateOrganization.mutate({ name: data.name })
  }

  if (!organization) return null

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground'>
        <Building className='size-4' /> General Settings
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='max-w-xl space-y-4'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder='Organization name' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='handle'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <InputGroup>
                      <InputGroupInput
                        value={field.value}
                        readOnly
                        disabled
                        className='font-mono'
                      />
                      {field.value && (
                        <InputGroupAddon align='inline-end'>
                          <InputGroupButton
                            aria-label='Copy Slug'
                            title='Copy'
                            size='icon-xs'
                            onClick={() => copy(field.value)}>
                            {copied ? <Check /> : <Copy />}
                          </InputGroupButton>
                        </InputGroupAddon>
                      )}
                    </InputGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <Button
            type='submit'
            size='sm'
            variant='outline'
            loading={updateOrganization.isPending}
            loadingText='Updating...'>
            Update organization
          </Button>
        </form>
      </Form>
    </div>
  )
}
