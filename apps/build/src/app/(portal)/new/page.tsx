// apps/build/src/app/(portal)/new/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Spinner } from '@auxx/ui/components/spinner'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import {
  FieldGroup,
  FieldSet,
  FieldDescription,
  Field,
  FieldLabel,
} from '@auxx/ui/components/field'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { api } from '~/trpc/react'
import { toastError } from '~/components/global/toast'

/** Slugify helper function */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Create new developer account page */
export default function NewPage() {
  const router = useRouter()
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

  // Check if slug exists (debounced)
  const { data: slugCheck, isLoading: isCheckingSlug } = api.developerAccounts.slugExists.useQuery(
    { slug: slug || '' },
    {
      enabled: slug.length >= 3,
      retry: false,
    }
  )

  // Create mutation
  const createAccount = api.developerAccounts.create.useMutation({
    onSuccess: (data) => {
      // Invalidate accounts list
      utils.developerAccounts.list.invalidate()
      // Redirect to onboarding flow for the new account
      router.push(`/${data.account.slug}/onboarding/first-app`)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create account',
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

    await createAccount.mutateAsync({
      title,
      slug,
    })
  }

  const slugError = slugCheck?.exists ? 'This slug is already taken' : null
  const slugValid = slug.length >= 3 && !slugCheck?.exists

  return (
    <div className="flex items-center flex-col flex-1 min-h-0 h-full">
      <form onSubmit={handleSubmit}>
        <div className="mx-auto min-w-md max-w-xl p-6 space-y-3">
          <Card className="shadow-md shadow-black/20 border-transparent">
            <CardHeader>
              <CardTitle className="text-2xl mb-0">Create a developer account</CardTitle>
            </CardHeader>
            <CardContent className="">
              <div className="w-full max-w-md">
                <FieldGroup>
                  <FieldSet>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="account-name">Account name</FieldLabel>
                        <Input
                          id="account-name"
                          placeholder="Evil Rabbit"
                          required
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                        <FieldDescription>
                          The auxx.Ai App Store displays this as your apps creator
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="slug">Slug</FieldLabel>
                        <InputGroup>
                          <InputGroupInput
                            id="slug"
                            placeholder="evil-rabbit"
                            className="!pl-0"
                            value={slug}
                            onChange={(e) => {
                              setSlug(slugify(e.target.value))
                              setSlugTouched(true)
                            }}
                            required
                          />
                          <InputGroupAddon>
                            <InputGroupText>build.auxx.ai/</InputGroupText>
                          </InputGroupAddon>
                          {slug.length >= 3 && (
                            <InputGroupAddon align="inline-end">
                              {isCheckingSlug ? (
                                <Spinner />
                              ) : slugValid ? (
                                <span className="text-green-600">✓</span>
                              ) : slugError ? (
                                <span className="text-red-600">✗</span>
                              ) : null}
                            </InputGroupAddon>
                          )}
                        </InputGroup>
                        {slugError && <p className="text-sm text-red-600 mt-1">{slugError}</p>}
                        <FieldDescription>
                          Slug is a unique identifier for your account
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                  </FieldSet>
                </FieldGroup>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between w-full">
            <Button
              type="submit"
              className="w-full"
              loading={createAccount.isPending}
              loadingText="Creating..."
              disabled={!title || !slug || slug.length < 3 || slugCheck?.exists || isCheckingSlug}>
              Continue
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
