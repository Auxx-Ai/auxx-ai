// apps/web/src/app/(protected)/app/settings/channels/_components/imap-connect-form.tsx
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
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { ArrowLeft, CheckCircle, Loader2, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '~/trpc/react'

const imapConnectSchema = z
  .object({
    email: z.string().email(),
    authMode: z.enum(['direct', 'ldap']).default('direct'),

    // IMAP
    imapHost: z.string().min(1, 'IMAP host is required'),
    imapPort: z.coerce.number().int().min(1).max(65535).default(993),
    imapSecure: z.boolean().default(true),
    imapUsername: z.string().min(1, 'Username is required'),
    imapPassword: z.string().min(1, 'Password is required'),
    imapAllowUnauthorizedCerts: z.boolean().default(false),

    // SMTP
    smtpHost: z.string().min(1, 'SMTP host is required'),
    smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
    smtpSecure: z.boolean().default(false),
    smtpSameCredentials: z.boolean().default(true),
    smtpUsername: z.string().optional(),
    smtpPassword: z.string().optional(),
    smtpAllowUnauthorizedCerts: z.boolean().default(false),

    // LDAP
    ldapUrl: z.string().optional(),
    ldapBindDN: z.string().optional(),
    ldapBindPassword: z.string().optional(),
    ldapSearchBase: z.string().optional(),
    ldapSearchFilter: z.string().optional().default('(mail={{email}})'),
    ldapUsernameAttribute: z.string().optional().default('uid'),
    ldapEmailAttribute: z.string().optional().default('mail'),
    ldapAllowUnauthorizedCerts: z.boolean().default(false),
  })
  .refine(
    (data) => {
      if (!data.smtpSameCredentials) {
        return !!data.smtpUsername && !!data.smtpPassword
      }
      return true
    },
    {
      message: 'SMTP username and password are required',
      path: ['smtpUsername'],
    }
  )
  .refine(
    (data) => {
      if (data.authMode === 'ldap') {
        return (
          !!data.ldapUrl && !!data.ldapBindDN && !!data.ldapBindPassword && !!data.ldapSearchBase
        )
      }
      return true
    },
    {
      message: 'All LDAP fields are required when using LDAP authentication',
      path: ['ldapUrl'],
    }
  )

type ImapFormValues = z.infer<typeof imapConnectSchema>

interface ImapConnectFormProps {
  onBack: () => void
}

export default function ImapConnectForm({ onBack }: ImapConnectFormProps) {
  const router = useRouter()
  const [testResults, setTestResults] = useState<{
    imap: boolean | null
    smtp: boolean | null
    ldap: boolean | null
  }>({ imap: null, smtp: null, ldap: null })

  const form = useForm<ImapFormValues>({
    resolver: standardSchemaResolver(imapConnectSchema),
    defaultValues: {
      email: '',
      authMode: 'direct',
      imapHost: '',
      imapPort: 993,
      imapSecure: true,
      imapUsername: '',
      imapPassword: '',
      imapAllowUnauthorizedCerts: false,
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: false,
      smtpSameCredentials: true,
      smtpUsername: '',
      smtpPassword: '',
      smtpAllowUnauthorizedCerts: false,
      ldapUrl: '',
      ldapBindDN: '',
      ldapBindPassword: '',
      ldapSearchBase: '',
      ldapSearchFilter: '(mail={{email}})',
      ldapUsernameAttribute: 'uid',
      ldapEmailAttribute: 'mail',
      ldapAllowUnauthorizedCerts: false,
    },
  })

  const authMode = form.watch('authMode')
  const smtpSameCredentials = form.watch('smtpSameCredentials')

  const connectImap = api.integration.connectImap.useMutation({
    onSuccess: () => {
      router.push('/app/settings/channels')
    },
    onError: (error) => {
      toastError({ title: 'Connection failed', description: error.message })
    },
  })

  const testConnection = api.integration.testImapConnection.useMutation({
    onSuccess: (data) => {
      setTestResults({
        imap: data.imap,
        smtp: data.smtp,
        ldap: data.ldap,
      })
    },
    onError: (error) => {
      toastError({ title: 'Test failed', description: error.message })
    },
  })

  const onSubmit = (data: ImapFormValues) => {
    connectImap.mutate(data)
  }

  const onTest = () => {
    const values = form.getValues()
    setTestResults({ imap: null, smtp: null, ldap: null })
    testConnection.mutate(values)
  }

  const handleImapSecurityChange = (value: string) => {
    if (value === 'tls') {
      form.setValue('imapSecure', true)
      form.setValue('imapPort', 993)
    } else {
      form.setValue('imapSecure', false)
      form.setValue('imapPort', 143)
    }
  }

  const handleSmtpSecurityChange = (value: string) => {
    if (value === 'tls') {
      form.setValue('smtpSecure', true)
      form.setValue('smtpPort', 465)
    } else {
      form.setValue('smtpSecure', false)
      form.setValue('smtpPort', 587)
    }
  }

  return (
    <div className='flex flex-col space-y-6'>
      <div className='flex items-center space-x-2'>
        <div className='font-semibold leading-none tracking-tight'>Connect IMAP Email Server</div>
      </div>
      <p className='text-sm text-muted-foreground'>
        Connect your self-hosted or enterprise email server using IMAP and SMTP.
      </p>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          {/* Email Address */}
          <FormField
            control={form.control}
            name='email'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email Address</FormLabel>
                <FormControl>
                  <Input placeholder='support@example.com' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Auth Mode */}
          <FormField
            control={form.control}
            name='authMode'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Authentication Mode</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    className='flex gap-4'>
                    <div className='flex items-center space-x-2'>
                      <RadioGroupItem value='direct' id='auth-direct' />
                      <label htmlFor='auth-direct' className='text-sm'>
                        Direct (IMAP login)
                      </label>
                    </div>
                    <div className='flex items-center space-x-2'>
                      <RadioGroupItem value='ldap' id='auth-ldap' />
                      <label htmlFor='auth-ldap' className='text-sm'>
                        LDAP (directory authentication)
                      </label>
                    </div>
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* IMAP Server Section */}
          <div className='space-y-4'>
            <h3 className='text-sm font-medium border-b pb-2'>IMAP Server (Incoming)</h3>
            <div className='grid grid-cols-3 gap-3'>
              <FormField
                control={form.control}
                name='imapHost'
                render={({ field }) => (
                  <FormItem className='col-span-1'>
                    <FormLabel>Host</FormLabel>
                    <FormControl>
                      <Input placeholder='imap.example.com' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='imapPort'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl>
                      <Input type='number' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Security</FormLabel>
                <Select
                  defaultValue={form.getValues('imapSecure') ? 'tls' : 'starttls'}
                  onValueChange={handleImapSecurityChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='tls'>TLS (993)</SelectItem>
                    <SelectItem value='starttls'>STARTTLS (143)</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            </div>

            <FormField
              control={form.control}
              name='imapUsername'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input placeholder='support@example.com' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='imapPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type='password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='imapAllowUnauthorizedCerts'
              render={({ field }) => (
                <FormItem className='flex items-center space-x-2'>
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className='!mt-0'>Allow self-signed certificates</FormLabel>
                </FormItem>
              )}
            />
          </div>

          {/* SMTP Server Section */}
          <div className='space-y-4'>
            <h3 className='text-sm font-medium border-b pb-2'>SMTP Server (Outgoing)</h3>
            <div className='grid grid-cols-3 gap-3'>
              <FormField
                control={form.control}
                name='smtpHost'
                render={({ field }) => (
                  <FormItem className='col-span-1'>
                    <FormLabel>Host</FormLabel>
                    <FormControl>
                      <Input placeholder='smtp.example.com' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='smtpPort'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl>
                      <Input type='number' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Security</FormLabel>
                <Select
                  defaultValue={form.getValues('smtpSecure') ? 'tls' : 'starttls'}
                  onValueChange={handleSmtpSecurityChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='tls'>TLS (465)</SelectItem>
                    <SelectItem value='starttls'>STARTTLS (587)</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            </div>

            <FormField
              control={form.control}
              name='smtpSameCredentials'
              render={({ field }) => (
                <FormItem className='flex items-center space-x-2'>
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className='!mt-0'>Use same credentials as IMAP</FormLabel>
                </FormItem>
              )}
            />

            {!smtpSameCredentials && (
              <>
                <FormField
                  control={form.control}
                  name='smtpUsername'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SMTP Username</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='smtpPassword'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SMTP Password</FormLabel>
                      <FormControl>
                        <Input type='password' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <FormField
              control={form.control}
              name='smtpAllowUnauthorizedCerts'
              render={({ field }) => (
                <FormItem className='flex items-center space-x-2'>
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className='!mt-0'>Allow self-signed certificates</FormLabel>
                </FormItem>
              )}
            />
          </div>

          {/* LDAP Section (conditional) */}
          {authMode === 'ldap' && (
            <div className='space-y-4'>
              <h3 className='text-sm font-medium border-b pb-2'>LDAP Settings</h3>

              <FormField
                control={form.control}
                name='ldapUrl'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>LDAP URL</FormLabel>
                    <FormControl>
                      <Input placeholder='ldaps://ldap.example.com:636' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ldapBindDN'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bind DN</FormLabel>
                    <FormControl>
                      <Input placeholder='cn=admin,dc=example,dc=com' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ldapBindPassword'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bind Password</FormLabel>
                    <FormControl>
                      <Input type='password' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ldapSearchBase'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Search Base</FormLabel>
                    <FormControl>
                      <Input placeholder='ou=users,dc=example,dc=com' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ldapSearchFilter'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Search Filter</FormLabel>
                    <FormControl>
                      <Input placeholder='(mail={{email}})' {...field} />
                    </FormControl>
                    <FormDescription>
                      {'Use {{email}} as placeholder for the user email'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ldapAllowUnauthorizedCerts'
                render={({ field }) => (
                  <FormItem className='flex items-center space-x-2'>
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className='!mt-0'>Allow self-signed certificates</FormLabel>
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Test Results */}
          {(testResults.imap !== null || testResults.smtp !== null) && (
            <div className='rounded-md border p-3 space-y-2'>
              <h4 className='text-sm font-medium'>Connection Test Results</h4>
              <div className='flex gap-4 text-sm'>
                <span className='flex items-center gap-1'>
                  {testResults.imap ? (
                    <CheckCircle className='h-4 w-4 text-green-500' />
                  ) : (
                    <XCircle className='h-4 w-4 text-red-500' />
                  )}
                  IMAP
                </span>
                <span className='flex items-center gap-1'>
                  {testResults.smtp ? (
                    <CheckCircle className='h-4 w-4 text-green-500' />
                  ) : (
                    <XCircle className='h-4 w-4 text-red-500' />
                  )}
                  SMTP
                </span>
                {authMode === 'ldap' && (
                  <span className='flex items-center gap-1'>
                    {testResults.ldap ? (
                      <CheckCircle className='h-4 w-4 text-green-500' />
                    ) : (
                      <XCircle className='h-4 w-4 text-red-500' />
                    )}
                    LDAP
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className='flex justify-between'>
            <Button type='button' variant='outline' onClick={onBack}>
              <ArrowLeft />
              Back
            </Button>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={onTest}
                disabled={testConnection.isPending}>
                {testConnection.isPending && <Loader2 className='animate-spin' />}
                Test Connection
              </Button>
              <Button
                type='submit'
                variant='info'
                loading={connectImap.isPending}
                loadingText='Connecting...'>
                Connect
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}
