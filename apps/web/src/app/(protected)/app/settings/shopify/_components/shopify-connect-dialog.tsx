import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
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
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Store } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

// Zod schema for validation
const shopDomainSchema = z.object({
  shopDomain: z
    .string()
    .min(1, { error: 'Shop domain is required' })
    .regex(/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)?myshopify\.com$/, {
      error: 'Please enter a valid myshopify.com domain',
    }),
})

type ShopDomainSchema = z.infer<typeof shopDomainSchema>

interface ShopifyConnectDialogProps {
  // Allow the dialog to be controlled from outside
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // Function to get auth URL
  getAuthUrl: (params: { shopDomain: string }) => void
  // Optional trigger element
  trigger?: React.ReactNode
}

export function ShopifyConnectDialog({
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  getAuthUrl,
  trigger,
}: ShopifyConnectDialogProps) {
  // Internal state for when not controlled externally
  const [internalOpen, setInternalOpen] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  // Determine if we're using internal or external state
  const isControlled = externalOpen !== undefined
  const open = isControlled ? externalOpen : internalOpen

  // Handle open state changes
  const handleOpenChange = (newOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    externalOnOpenChange?.(newOpen)
  }

  // Form definition
  const form = useForm<ShopDomainSchema>({
    resolver: standardSchemaResolver(shopDomainSchema),
    defaultValues: { shopDomain: '' },
  })

  const onSubmit = (values: ShopDomainSchema) => {
    setIsConnecting(true)
    try {
      const domain = values.shopDomain.trim().toLowerCase()
      // Add myshopify.com if missing
      const shopDomain = domain.includes('.myshopify.com') ? domain : `${domain}.myshopify.com`

      getAuthUrl({ shopDomain })
      // Don't close the dialog here as the auth process might redirect the user
    } catch (error) {
      console.error('Error connecting to Shopify:', error)
      setIsConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button variant='outline' className='flex items-center gap-2'>
            <Store className='h-5 w-5' />
            Connect Shopify Store
          </Button>
        </DialogTrigger>
      )}

      <DialogContent size='sm'>
        <DialogHeader className='mb-4'>
          <DialogTitle className='flex items-center gap-2'>
            <Store className='h-5 w-5' />
            Connect Shopify Store
          </DialogTitle>
          <DialogDescription>
            Connect your Shopify store to sync products, orders, and inventory.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='shopDomain'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Shopify Store Domain</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder='yourstorename.myshopify.com'
                      className='w-full'
                    />
                  </FormControl>
                  <FormDescription>Enter your Shopify store domain.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button variant='ghost' size='sm' type='button' onClick={() => handleOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            type='submit'
            size='sm'
            variant='outline'
            disabled={isConnecting}
            onClick={form.handleSubmit(onSubmit)}
            loading={isConnecting}
            loadingText='Connecting...'>
            Connect Shopify Store <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
