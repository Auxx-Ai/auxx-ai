// apps/web/src/components/kb/ui/articles/add-tab-dialog.tsx
'use client'

import { ArticleKind } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useArticleMutations } from '../../hooks/use-article-mutations'

const tabSchema = z.object({
  title: z.string().min(1, 'Title is required'),
})

type TabFormValues = z.infer<typeof tabSchema>

interface AddTabDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  onCreated?: (id: string) => void
}

export function AddTabDialog({
  open,
  onOpenChange,
  knowledgeBaseId,
  onCreated,
}: AddTabDialogProps) {
  const { createArticle, isCreating } = useArticleMutations(knowledgeBaseId)
  const form = useForm<TabFormValues>({
    resolver: standardSchemaResolver(tabSchema),
    defaultValues: { title: '' },
  })

  useEffect(() => {
    if (open) form.reset({ title: '' })
  }, [open, form])

  const handleSubmit = async (values: TabFormValues) => {
    const created = await createArticle({
      title: values.title,
      articleKind: ArticleKind.tab,
      parentId: null,
    })
    if (created) {
      onCreated?.(created.id)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tab</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className='flex flex-col gap-4'
            id='add-tab-form'>
            <FormField
              control={form.control}
              name='title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder='Documentation' autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button type='submit' form='add-tab-form' loading={isCreating}>
            Create tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
