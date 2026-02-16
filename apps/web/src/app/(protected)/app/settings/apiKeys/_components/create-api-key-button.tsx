'use client'
import type { ApiKey } from '@auxx/database/types'
import { Button, type ButtonProps } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
// import { PointerDownOutsideEvent } from 'radix-ui'
import { PlusIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { CopyInput } from '~/components/global/copy-input'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

type PointerDownOutsideEvent = CustomEvent<{
  originalEvent: PointerEvent
}>
export const createApiKeyBody = z.object({
  id: z.string().nullish().optional(),
  name: z.string().optional(),
  hashedKey: z.string().nullish().optional(),
})
export type CreateApiKeyBody = z.infer<typeof createApiKeyBody>
type CreateAPIKeyButtonProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}
export function CreateAPIKeyButton({
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  trigger,
}: CreateAPIKeyButtonProps) {
  const utils = api.useUtils()
  const posthog = useAnalytics()
  const form = useForm<CreateApiKeyBody>({
    resolver: standardSchemaResolver(createApiKeyBody),
    defaultValues: { name: '', hashedKey: '' },
  })
  const [internalOpen, setInternalOpen] = useState(false)
  // const [isConnecting, setIsConnecting] = useState(false)
  const [secret, setSecret] = useState('')
  const isControlled = externalOpen !== undefined
  const open = isControlled ? externalOpen : internalOpen
  // Handle open state changes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      form.reset()
      setSecret('')
    }
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    externalOnOpenChange?.(newOpen)
  }
  const createApiKey = api.apiKey.create.useMutation({
    onSuccess: async (data) => {
      setSecret(data.secretKey)
      toastSuccess({ description: 'API key created' })
      posthog?.capture('api_key_created')
      utils.apiKey.getAll.invalidate()
    },
    onError: (error) => {
      toastError({ description: error.message })
    },
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: createApiKey.mutateAsync is stable
  const onSubmit = useCallback(async (values: CreateApiKeyBody) => {
    await createApiKey.mutateAsync(values)
  }, [])
  const onEscapeOrOutsideClick = (e: KeyboardEvent | PointerDownOutsideEvent) => {
    if (secret || form.formState.isSubmitting) {
      e.preventDefault()
    }
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant='outline' size='sm'>
          <PlusIcon className='h-4 w-4' />
          Create API Key
        </Button>
      </DialogTrigger>

      <DialogContent
        onEscapeKeyDown={onEscapeOrOutsideClick}
        onPointerDownOutside={onEscapeOrOutsideClick}>
        <DialogHeader className='mb-4'>
          <DialogTitle>Create new secret key</DialogTitle>
          <DialogDescription>
            This will create a new secret key for your account. You will need to use this secret key
            to authenticate your requests to the API.
          </DialogDescription>
        </DialogHeader>
        {secret ? (
          <>
            <DialogDescription className='mb-2'>
              This will only be shown once. Please copy it. Your secret key is:
            </DialogDescription>
            <CopyInput value={secret} />
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem className='flex flex-col gap-1'>
                    <FormLabel>Name (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder='My secret key' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className='flex items-center justify-end'>
                <Button
                  type='submit'
                  size='sm'
                  disabled={form.formState.isSubmitting}
                  variant='outline'
                  loading={form.formState.isSubmitting}
                  loadingText='Creating...'>
                  Create
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
export function RevokeAPIKeyButton({
  id,
  buttonProps,
}: {
  id: ApiKey['id']
  buttonProps?: ButtonProps
}) {
  const utils = api.useUtils()
  const revokeApiKey = api.apiKey.delete.useMutation({
    onSuccess: async () => {
      await utils.apiKey.getAll.invalidate()
      toastSuccess({ description: 'API key revoked' })
    },
    onError: (error) => {
      toastError({ description: error.message })
    },
  })
  return (
    <Button
      onClick={() => revokeApiKey.mutateAsync({ id })}
      {...buttonProps}
      disabled={revokeApiKey.isPending}>
      Revoke
    </Button>
  )
}
