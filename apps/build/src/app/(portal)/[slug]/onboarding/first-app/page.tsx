'use client'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { Spinner } from '@auxx/ui/components/spinner'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toastError } from '@/components/global/toast'
import { SimpleLayout } from '@/components/layouts/simple-layout'
import { api } from '@/trpc/react'
import { useAddApp } from '~/components/providers/dehydrated-state-provider'

// import { AccountsCard } from './_components/accounts-card'
/** Slugify helper function */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function OnboardingAppPage() {
  // const session = await getSession()
  const router = useRouter()
  const params = useParams()
  const developerSlug = params.slug as string

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  // Auto-generate slug from title
  useEffect(() => {
    if (!slugTouched && title) {
      setSlug(slugify(title))
    }
  }, [title, slugTouched])

  const utils = api.useUtils()
  const addApp = useAddApp()

  // Check if slug exists (debounced)
  const { data: slugCheck, isLoading: isCheckingSlug } = api.apps.slugExists.useQuery(
    { slug: slug || '' },
    {
      enabled: slug.length >= 3,
      retry: false,
    }
  )

  // Create mutation
  const createApp = api.apps.create.useMutation({
    onSuccess: (data) => {
      // Add the new app to dehydrated state immediately
      addApp(data.app)
      // Invalidate developer account's first app query
      utils.developerAccounts.getFirstApp.invalidate({ slug: developerSlug })
      // Redirect to the new app (no need for router.refresh() since we updated state)
      router.push(`/${developerSlug}/apps/${data.app.slug}`)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create app',
        description: error.message,
      })
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!title || !slug) {
      toastError({ title: 'Please fill in all fields' })
      return
    }

    if (slug.length < 3) {
      toastError({ title: 'Slug must be at least 3 characters' })
      return
    }

    if (slugCheck?.exists) {
      toastError({ title: 'This slug is already taken' })
      return
    }

    await createApp.mutateAsync({
      title,
      slug: slug,
      developerSlug,
    })
  }

  const slugError = slugCheck?.exists ? 'This slug is already taken' : null
  const slugValid = slug.length >= 3 && !slugCheck?.exists

  // return <div>Lalala</div>
  return (
    <SimpleLayout title='Create App'>
      <div className='flex items-center flex-col flex-1 min-h-0 h-full'>
        <form onSubmit={handleSubmit}>
          <div className='mx-auto min-w-md max-w-xl p-6 space-y-3'>
            <Card className='shadow-md shadow-black/20 border-transparent'>
              <CardHeader>
                <CardTitle className='text-2xl mb-0'>Create app</CardTitle>
              </CardHeader>
              <CardContent className=''>
                <div className='w-full max-w-md'>
                  <FieldGroup>
                    <FieldSet>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor='app-name'>App name</FieldLabel>
                          <Input
                            id='app-name'
                            placeholder='Evil Rabbit'
                            required
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor='slug'>Slug</FieldLabel>
                          <InputGroup>
                            <InputGroupInput
                              id='slug'
                              placeholder='evil-rabbit'
                              className=''
                              value={slug}
                              onChange={(e) => {
                                setSlug(slugify(e.target.value))
                                setSlugTouched(true)
                              }}
                              required
                            />
                            {slug.length >= 3 && (
                              <InputGroupAddon align='inline-end'>
                                {isCheckingSlug ? (
                                  <Spinner />
                                ) : slugValid ? (
                                  <span className='text-green-600'>✓</span>
                                ) : slugError ? (
                                  <span className='text-red-600'>✗</span>
                                ) : null}
                              </InputGroupAddon>
                            )}
                          </InputGroup>
                          {slugError && <p className='text-sm text-red-600 mt-1'>{slugError}</p>}
                          <FieldDescription>
                            Slug is a unique identifier for your app
                          </FieldDescription>
                        </Field>
                      </FieldGroup>
                    </FieldSet>
                  </FieldGroup>
                </div>
              </CardContent>
            </Card>

            <div className='flex items-center justify-between w-full'>
              <Button
                type='submit'
                className='w-full'
                loading={createApp.isPending}
                loadingText='Creating...'
                disabled={
                  !title || !slug || slug.length < 3 || slugCheck?.exists || isCheckingSlug
                }>
                Create app
              </Button>
            </div>
          </div>
        </form>
      </div>
    </SimpleLayout>
  )
}
