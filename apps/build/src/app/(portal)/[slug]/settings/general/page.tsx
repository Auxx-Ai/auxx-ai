// apps/build/src/app/(portal)/[slug]/settings/general/page.tsx

'use client'
import { Button } from '@auxx/ui/components/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
} from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Building2, Check, Copy } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useCopyClipboard } from '@/hooks/use-copy-clipboard'
import { toastError } from '~/components/global/toast'
import { useDeveloperAccount } from '~/components/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import SettingsHeader from '../_components/settings-header'

/**
 * Form schema for account settings
 */
const accountSettingsSchema = z.object({
  title: z.string().min(1, 'Account name is required'),
})

type AccountSettingsFormValues = z.infer<typeof accountSettingsSchema>

function SettingsGeneralPage() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const { copy, copied } = useCopyClipboard()

  // Get developer account from dehydrated state
  const account = useDeveloperAccount(params.slug)

  // tRPC mutation
  const updateAccount = api.developerAccounts.update.useMutation({
    onSuccess: () => {
      router.refresh() // Refresh to update dehydrated state
    },
    onError: (error) => {
      if (error.data?.code === 'FORBIDDEN') {
        toastError({
          title: 'Permission denied',
          description: 'You do not have permission to edit this developer account',
        })
      } else if (error.data?.code === 'NOT_FOUND') {
        toastError({
          title: 'Account not found',
          description: 'The developer account you are trying to edit does not exist',
        })
      } else {
        toastError({
          title: 'Update failed',
          description: error.message,
        })
      }
    },
  })

  // Form setup with pre-loaded values
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<AccountSettingsFormValues>({
    resolver: standardSchemaResolver(accountSettingsSchema),
    defaultValues: {
      title: account?.title || '',
    },
  })

  /**
   * Submit handler
   */
  const onSubmit = (data: AccountSettingsFormValues) => {
    if (!account) return

    updateAccount.mutate({
      developerAccountId: account.id,
      data: {
        title: data.title,
      },
    })
  }

  if (!account) {
    return <div>Developer account not found</div>
  }

  return (
    <>
      <SettingsHeader title='General' icon={<Building2 className='size-4' />} />
      <div className='flex-1 overflow-y-auto min-h-0'>
        <div className='p-6 lg:py-12 max-w-3xl mx-auto'>
          <div className='flex flex-col space-y-10'>
            <div className='space-y-0'>
              <div className='text-xl font-semibold'>General</div>
              <div className='text-base'>Change general settings for your developer account</div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)}>
              <FieldGroup>
                <FieldSet>
                  {/* Logo Section */}
                  <div className='flex flex-row gap-5'>
                    <div>
                      <div className='border rounded-2xl bg-primary-50 size-16'>
                        {account.logoUrl && (
                          <img
                            src={account.logoUrl}
                            alt={account.title}
                            className='size-full rounded-2xl object-cover'
                          />
                        )}
                      </div>
                    </div>
                    <div className='flex flex-col items-start gap-1'>
                      <div className='text-base font-semibold'>Logo</div>
                      <Button variant='outline' size='sm' type='button'>
                        Upload logo
                      </Button>
                      <div className='text-xs text-muted-foreground'>
                        *.png files up to 10MB at least 560px by 560px
                      </div>
                    </div>
                  </div>

                  <FieldSeparator />

                  {/* Name and Slug Fields */}
                  <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                    <Field data-invalid={!!errors.title}>
                      <FieldLabel htmlFor='account-name'>Name</FieldLabel>
                      <Input
                        id='account-name'
                        placeholder='My Company'
                        aria-invalid={!!errors.title}
                        {...register('title')}
                      />
                      <FieldDescription>
                        The name of your developer account or organization
                      </FieldDescription>
                      {errors.title && <FieldError>{errors.title.message}</FieldError>}
                    </Field>

                    <Field>
                      <FieldLabel htmlFor='account-slug'>Slug</FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          id='account-slug'
                          value={account.slug}
                          readOnly
                          className='bg-muted'
                        />
                        <InputGroupAddon align='inline-end'>
                          <InputGroupButton
                            aria-label='Copy slug'
                            title='Copy slug'
                            size='icon-xs'
                            onClick={() => copy(account.slug)}>
                            {copied ? <Check /> : <Copy />}
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                      <FieldDescription>
                        Your unique developer account identifier (cannot be changed)
                      </FieldDescription>
                    </Field>
                  </div>
                </FieldSet>

                <FieldSet>
                  {/* Save Button */}
                  <Field orientation='horizontal' className='justify-end'>
                    <Button
                      size='sm'
                      type='submit'
                      loading={updateAccount.isPending}
                      loadingText='Saving...'
                      disabled={!isDirty || updateAccount.isPending}>
                      Save changes
                    </Button>
                  </Field>
                </FieldSet>
              </FieldGroup>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}

export default SettingsGeneralPage
