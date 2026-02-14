// components/settings/organization/appearance-settings-form.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Separator } from '@auxx/ui/components/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Loader2, RefreshCcw, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'

interface AppearanceSettingsFormProps {
  organizationId: string
}

interface AppearanceFormValues {
  primaryColor: string
  secondaryColor: string
  font: string
  logoUrl: string | null
  // Override flags
  allowPrimaryColorOverride: boolean
  allowSecondaryColorOverride: boolean
  allowFontOverride: boolean
  allowLogoOverride: boolean
}

export function AppearanceSettingsForm({ organizationId }: AppearanceSettingsFormProps) {
  const {
    orgSettingsWithMetadata,
    isLoading,
    batchUpdateOrganizationSettings,
    isBatchUpdatingOrgSettings,
  } = useSettings({ organizationId, scope: 'APPEARANCE' })

  useUser({
    requireOrganization: true, // Require organization membership
    requireRoles: ['ADMIN', 'OWNER'], // Ensure user is an admin or owner
  })

  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const form = useForm<AppearanceFormValues>({
    defaultValues: {
      primaryColor: '#4f46e5',
      secondaryColor: '#0ea5e9',
      font: 'Inter',
      logoUrl: null,
      allowPrimaryColorOverride: false,
      allowSecondaryColorOverride: false,
      allowFontOverride: false,
      allowLogoOverride: false,
    },
  })

  // Load settings from the server
  useEffect(() => {
    if (orgSettingsWithMetadata && !isLoading) {
      const settings = orgSettingsWithMetadata.reduce(
        (acc, setting) => {
          const { key, value, allowUserOverride } = setting

          if (key === 'appearance.primaryColor') {
            acc.primaryColor = value as string
            acc.allowPrimaryColorOverride = allowUserOverride
          } else if (key === 'appearance.secondaryColor') {
            acc.secondaryColor = value as string
            acc.allowSecondaryColorOverride = allowUserOverride
          } else if (key === 'appearance.font') {
            acc.font = value as string
            acc.allowFontOverride = allowUserOverride
          } else if (key === 'appearance.logo') {
            acc.logoUrl = value as string | null
            acc.allowLogoOverride = allowUserOverride
            if (value) {
              setLogoPreview(value as string)
            }
          }

          return acc
        },
        {} as Partial<AppearanceFormValues>
      )

      form.reset({ ...form.getValues(), ...settings })
    }
  }, [orgSettingsWithMetadata, isLoading, form])

  const onSubmit = async (data: AppearanceFormValues) => {
    // Handle logo upload if there's a new file
    let logoUrl = data.logoUrl

    if (logoFile) {
      // Here you would typically upload the file to your storage service
      // and get back a URL. This is a placeholder for that logic.
      // Example: logoUrl = await uploadLogo(logoFile);
      logoUrl = logoPreview // For demo purposes, using the preview URL
    }

    const settings = [
      {
        key: 'appearance.primaryColor',
        value: data.primaryColor,
        allowUserOverride: data.allowPrimaryColorOverride,
      },
      {
        key: 'appearance.secondaryColor',
        value: data.secondaryColor,
        allowUserOverride: data.allowSecondaryColorOverride,
      },
      { key: 'appearance.font', value: data.font, allowUserOverride: data.allowFontOverride },
      { key: 'appearance.logo', value: logoUrl, allowUserOverride: data.allowLogoOverride },
    ]

    batchUpdateOrganizationSettings(settings)
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    if (file) {
      setLogoFile(file)

      // Create preview URL
      const reader = new FileReader()
      reader.onloadend = () => {
        setLogoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const removeLogo = () => {
    setLogoFile(null)
    setLogoPreview(null)
    form.setValue('logoUrl', null)
  }

  // Preview component for seeing changes in real-time
  const ThemePreview = () => (
    <div className='rounded-lg border p-6'>
      <h3 className='mb-4 text-lg font-medium'>Theme Preview</h3>
      <div className='space-y-4'>
        <div className='flex space-x-4'>
          <div
            className='h-16 w-16 rounded-lg'
            style={{ backgroundColor: form.watch('primaryColor') }}
          />
          <div
            className='h-16 w-16 rounded-lg'
            style={{ backgroundColor: form.watch('secondaryColor') }}
          />
        </div>
        <div>
          <p style={{ fontFamily: form.watch('font') }}>
            This is a text preview in {form.watch('font')}
          </p>
        </div>
        {logoPreview && (
          <div>
            <p className='mb-2 text-sm text-gray-500'>Logo Preview:</p>
            <img
              src={logoPreview}
              alt='Logo preview'
              className='max-h-[100px] max-w-[200px] rounded border object-contain p-2'
            />
          </div>
        )}
        <div className='flex space-x-4'>
          <Button style={{ backgroundColor: form.watch('primaryColor'), color: 'white' }}>
            Primary Button
          </Button>
          <Button style={{ backgroundColor: form.watch('secondaryColor'), color: 'white' }}>
            Secondary Button
          </Button>
        </div>
      </div>
    </div>
  )

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-8'>
        <Loader2 className='h-8 w-8 animate-spin text-gray-400' />
      </div>
    )
  }

  return (
    <div className='space-y-8'>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
          <Tabs defaultValue='colors' className='w-full'>
            <TabsList>
              <TabsTrigger value='colors'>Colors</TabsTrigger>
              <TabsTrigger value='typography'>Typography</TabsTrigger>
              <TabsTrigger value='branding'>Branding</TabsTrigger>
            </TabsList>

            <TabsContent value='colors' className='space-y-4 pt-4'>
              <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='primaryColor'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Color</FormLabel>
                      <div className='flex items-center space-x-2'>
                        <div
                          className='h-8 w-8 rounded-full border'
                          style={{ backgroundColor: field.value }}
                        />
                        <FormControl>
                          <Input type='color' {...field} className='h-10 w-16' />
                        </FormControl>
                        <FormControl>
                          <Input
                            {...field}
                            className='w-32'
                            maxLength={7}
                            pattern='^#[0-9A-Fa-f]{6}$'
                          />
                        </FormControl>
                      </div>
                      <FormDescription>
                        Main color used for primary elements like buttons.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='allowPrimaryColorOverride'
                  render={({ field }) => (
                    <FormItem className='mt-8 flex flex-row items-start space-x-3 space-y-0'>
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className='space-y-1 leading-none'>
                        <FormLabel>Allow User Override</FormLabel>
                        <FormDescription>
                          Let users customize this setting for their own account.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <Separator className='my-4' />

              <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='secondaryColor'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secondary Color</FormLabel>
                      <div className='flex items-center space-x-2'>
                        <div
                          className='h-8 w-8 rounded-full border'
                          style={{ backgroundColor: field.value }}
                        />
                        <FormControl>
                          <Input type='color' {...field} className='h-10 w-16' />
                        </FormControl>
                        <FormControl>
                          <Input
                            {...field}
                            className='w-32'
                            maxLength={7}
                            pattern='^#[0-9A-Fa-f]{6}$'
                          />
                        </FormControl>
                      </div>
                      <FormDescription>
                        Secondary color used for highlights and accents.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='allowSecondaryColorOverride'
                  render={({ field }) => (
                    <FormItem className='mt-8 flex flex-row items-start space-x-3 space-y-0'>
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className='space-y-1 leading-none'>
                        <FormLabel>Allow User Override</FormLabel>
                        <FormDescription>
                          Let users customize this setting for their own account.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            <TabsContent value='typography' className='space-y-4 pt-4'>
              <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='font'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Font Family</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select a font' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='Inter'>Inter</SelectItem>
                          <SelectItem value='Roboto'>Roboto</SelectItem>
                          <SelectItem value='Open Sans'>Open Sans</SelectItem>
                          <SelectItem value='Montserrat'>Montserrat</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Primary font family used throughout the application.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='allowFontOverride'
                  render={({ field }) => (
                    <FormItem className='mt-8 flex flex-row items-start space-x-3 space-y-0'>
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className='space-y-1 leading-none'>
                        <FormLabel>Allow User Override</FormLabel>
                        <FormDescription>
                          Let users customize this setting for their own account.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            <TabsContent value='branding' className='space-y-4 pt-4'>
              <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                <div>
                  <FormLabel htmlFor='logo'>Organization Logo</FormLabel>
                  <div className='mt-2 flex items-center'>
                    <div className='w-full rounded border p-4'>
                      {logoPreview ? (
                        <div className='flex flex-col items-center'>
                          <img
                            src={logoPreview}
                            alt='Logo preview'
                            className='max-h-[100px] max-w-[200px] object-contain'
                          />
                          <div className='mt-4 flex space-x-2'>
                            <Button
                              type='button'
                              variant='outline'
                              size='sm'
                              onClick={() => document.getElementById('logo-upload')?.click()}>
                              <RefreshCcw className='mr-1 h-4 w-4' />
                              Change
                            </Button>
                            <Button
                              type='button'
                              variant='destructive'
                              size='sm'
                              onClick={removeLogo}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className='flex flex-col items-center'>
                          <div className='flex h-32 w-32 items-center justify-center rounded-lg border-2 border-dashed text-gray-400'>
                            <div className='flex flex-col items-center'>
                              <Upload className='mb-2 h-8 w-8' />
                              <span>No logo</span>
                            </div>
                          </div>
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            className='mt-4'
                            onClick={() => document.getElementById('logo-upload')?.click()}>
                            Upload Logo
                          </Button>
                        </div>
                      )}
                      <input
                        id='logo-upload'
                        type='file'
                        className='hidden'
                        accept='image/*'
                        onChange={handleLogoChange}
                      />
                    </div>
                  </div>
                  <FormDescription className='mt-2'>
                    Upload your organization logo (PNG, JPG, SVG). Recommended size: 200x100px.
                  </FormDescription>
                </div>

                <FormField
                  control={form.control}
                  name='allowLogoOverride'
                  render={({ field }) => (
                    <FormItem className='mt-8 flex flex-row items-start space-x-3 space-y-0'>
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className='space-y-1 leading-none'>
                        <FormLabel>Allow User Override</FormLabel>
                        <FormDescription>
                          Let users set their own logo. (Not recommended)
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>
          </Tabs>

          <ThemePreview />

          <div className='flex justify-start'>
            <Button
              type='submit'
              variant='outline'
              disabled={isBatchUpdatingOrgSettings}
              className='w-full sm:w-auto'>
              {isBatchUpdatingOrgSettings && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Save Changes
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
