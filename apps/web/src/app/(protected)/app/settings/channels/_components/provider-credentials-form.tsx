// apps/web/src/app/(protected)/app/settings/channels/_components/provider-credentials-form.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
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
import { ArrowLeft, Check, Copy, ExternalLink } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

const credentialSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  redirectUriConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'Please confirm you have added the redirect URI' }),
  }),
})

type CredentialFormValues = z.infer<typeof credentialSchema>

interface ProviderCredentialsFormProps {
  provider: 'google' | 'outlook'
  onCredentialsSaved: () => void
  onBack: () => void
}

export default function ProviderCredentialsForm({
  provider,
  onCredentialsSaved,
  onBack,
}: ProviderCredentialsFormProps) {
  const { docsUrl } = useEnv()
  const { copied, copy } = useCopy({ toastMessage: 'Redirect URI copied to clipboard' })

  const { data: status, isLoading } = api.channel.getProviderCredentialStatus.useQuery({
    provider,
  })

  const setCredentials = api.channel.setProviderCredentials.useMutation({
    onError: (error) => {
      toastError({ title: 'Error saving credentials', description: error.message })
    },
  })

  const form = useForm<CredentialFormValues>({
    resolver: standardSchemaResolver(credentialSchema),
    defaultValues: {
      clientId: '',
      clientSecret: '',
      redirectUriConfirmed: undefined as any,
    },
  })

  const redirectUri = status ? `${window.location.origin}${status.callbackPath}` : ''

  const handleSubmit = async (values: CredentialFormValues) => {
    await setCredentials.mutateAsync({
      provider,
      clientId: values.clientId,
      clientSecret: values.clientSecret,
    })
    onCredentialsSaved()
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center p-8'>
        <div className='text-sm text-muted-foreground'>Loading...</div>
      </div>
    )
  }

  // If credentials already exist, show summary with option to change
  if (status?.hasCustomCredentials) {
    return (
      <div className='flex flex-col space-y-4 p-3'>
        <div className='flex flex-col space-y-1.5'>
          <div className='font-semibold leading-none tracking-tight'>
            Connect {status.displayName}
          </div>
          <div className='text-sm text-muted-foreground'>
            Using your {status.displayName} credentials
          </div>
        </div>
        <div className='rounded-md border p-3'>
          <div className='text-sm'>
            <span className='text-muted-foreground'>Client ID: </span>
            <span className='font-mono text-xs'>
              {status.clientId
                ? `${status.clientId.slice(0, 12)}...${status.clientId.slice(-6)}`
                : '(set)'}
            </span>
          </div>
        </div>
        <div className='flex justify-between'>
          <Button type='button' variant='outline' onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <Button variant='info' onClick={onCredentialsSaved}>
            Connect
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className='flex flex-col space-y-4 p-3'>
        <div className='flex flex-col space-y-1.5'>
          <div className='font-semibold leading-none tracking-tight'>
            Connect {status?.displayName ?? provider}
          </div>
          <div className='text-sm text-muted-foreground'>
            To connect {status?.displayName ?? provider}, provide your own OAuth credentials.
          </div>
        </div>

        {status?.helpDocsPath && (
          <a
            href={docsUrl ? `${docsUrl}${status.helpDocsPath}` : status.helpDocsPath}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-1 text-sm text-primary-500 hover:underline'>
            How to set up {status?.displayName ?? provider} credentials
            <ExternalLink className='size-3.5' />
          </a>
        )}

        <FormField
          control={form.control}
          name='clientId'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client ID</FormLabel>
              <FormControl>
                <Input placeholder='Enter your OAuth Client ID' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='clientSecret'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client Secret</FormLabel>
              <FormControl>
                <Input type='password' placeholder='Enter your OAuth Client Secret' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {redirectUri && (
          <div className='space-y-1.5'>
            <FormLabel>Redirect URI</FormLabel>
            <div className='text-xs text-muted-foreground'>
              Add this redirect URI to your OAuth app configuration
            </div>
            <InputGroup>
              <InputGroupInput value={redirectUri} readOnly />
              <InputGroupAddon align='inline-end'>
                <InputGroupButton
                  className='mr-1 rounded-xl'
                  aria-label='Copy redirect URI'
                  title='Copy'
                  size='icon-xs'
                  onClick={() => copy(redirectUri)}>
                  {copied ? <Check /> : <Copy />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
        )}

        <FormField
          control={form.control}
          name='redirectUriConfirmed'
          render={({ field }) => (
            <FormItem>
              <label className='flex items-start gap-2 cursor-pointer'>
                <Checkbox
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked ? true : undefined)}
                  className='mt-0.5'
                />
                <span className='text-sm text-muted-foreground'>
                  I have added the redirect URI above to my OAuth app configuration
                </span>
              </label>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className='flex justify-between pt-2'>
          <Button type='button' variant='outline' onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <Button
            type='submit'
            variant='info'
            loading={setCredentials.isPending}
            loadingText='Saving...'>
            Save & Connect
          </Button>
        </div>
      </form>
    </Form>
  )
}
