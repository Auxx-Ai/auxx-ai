import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import { FormEmojiPicker } from '@auxx/ui/components/emoji-picker'

// Form schema
const formSchema = z.object({
  emoji: z.string().nullable(),
  title: z.string().min(1, 'Title is required'),
  slug: z.string().optional(),
})

type FormValues = z.infer<typeof formSchema>

interface ArticleRenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  article: { id: string; title: string; emoji?: string | null; slug: string }
  onSubmit: (values: FormValues) => Promise<void>
}

export function ArticleRenameDialog({
  open,
  onOpenChange,
  article,
  onSubmit,
}: ArticleRenameDialogProps) {
  const [isLoading, setIsLoading] = useState(false)

  // Initialize form with current article values
  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      emoji: article.emoji || null,
      title: article.title,
      slug: article.slug,
    },
  })

  const handleSubmit = async (values: FormValues) => {
    setIsLoading(true)
    try {
      await onSubmit(values)
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to rename article:', error)
    } finally {
      setIsLoading(false)
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pb-6">
          <DialogTitle>Rename Article</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="flex items-start space-x-4">
              <div className="shrink-0">
                <FormField
                  control={form.control}
                  name="emoji"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FormEmojiPicker value={field.value || '📄'} onChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grow space-y-2">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          className="border-0 p-0 shadow-none focus-visible:ring-0 md:text-xl"
                          placeholder="Article title..."
                          {...field}
                          disabled={isLoading}
                          autoComplete="off"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem className="mt-0 space-y-0">
                      <FormControl>
                        <div className="not-first:*:mt-2">
                          <div className="relative flex items-center px-3">
                            <div className="pointer-events-none text-sm text-muted-foreground peer-disabled:opacity-50">
                              /
                            </div>
                            <div className="shrink-1 grow-1 flex flex-row items-center">
                              <input
                                className="peer border-0 p-0 text-sm text-foreground shadow-none outline-hidden focus-visible:ring-0"
                                placeholder="google.com"
                                {...field}
                                disabled={isLoading}
                                autoComplete="off"
                              />
                            </div>
                            {/* <span className='pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-sm text-muted-foreground peer-disabled:opacity-50'>
                              https://
                            </span> */}
                          </div>
                        </div>

                        {/* <Input
                          placeholder='article-slug'
                          className='border-0 p-0 text-sm text-muted-foreground shadow-none focus-visible:ring-0'
                          {...field}
                          disabled={isLoading}
                          autoComplete='off'
                        /> */}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}>
                Cancel <Kbd shortcut="esc" variant="outline" size="sm" />
              </Button>
              <Button type="submit" size="sm" disabled={isLoading} loading={isLoading} loadingText="Saving...">
                Save Changes <KbdSubmit variant="default" size="sm" />
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
