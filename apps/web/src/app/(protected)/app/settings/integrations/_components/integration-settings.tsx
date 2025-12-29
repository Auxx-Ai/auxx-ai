'use client'
// ~/app/(protected)/app/settings/integrations/_components/integration-settings.tsx
import React, { useState } from 'react'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Switch } from '@auxx/ui/components/switch'
import { useIntegration } from '~/hooks/use-integration'
import { Mail, User, Clock, MailCheck, RefreshCw } from 'lucide-react'
import { Separator } from '@auxx/ui/components/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

interface IntegrationSettingsProps {
  integration: any // Replace with stronger typing when available
}

// Form schema for common email settings
const emailSettingsSchema = z.object({
  displayName: z.string().optional(),
  signature: z.string().optional(),
  autoBcc: z.email().optional().or(z.literal('')),
  undoSendTime: z.coerce.number().min(0).max(30).default(5),
})

type EmailSettingsFormValues = z.infer<typeof emailSettingsSchema>

// Form schema for phone settings
const phoneSettingsSchema = z.object({
  displayName: z.string().optional(),
  signatureText: z.string().optional(),
  autoReply: z.boolean().default(false),
  autoReplyMessage: z.string().optional(),
})

type PhoneSettingsFormValues = z.infer<typeof phoneSettingsSchema>

/**
 * IntegrationSettings component
 * Manages provider-specific settings for an integration
 */
export default function IntegrationSettings({ integration }: IntegrationSettingsProps) {
  const { syncMessages } = useIntegration()
  const [isSyncing, setIsSyncing] = useState(false)

  // Initialize the appropriate form based on provider type
  const isEmailProvider = ['google', 'outlook'].includes(integration.provider.toLowerCase())
  const isPhoneProvider = integration.provider.toLowerCase() === 'openphone'
  const isSocialProvider = ['facebook', 'instagram'].includes(integration.provider.toLowerCase())

  // Extract settings from integration.metadata if available
  const initialSettings = integration.metadata?.settings || {}

  // Email settings form
  const emailForm = useForm<EmailSettingsFormValues>({
    resolver: standardSchemaResolver(emailSettingsSchema),
    defaultValues: {
      displayName: initialSettings.displayName || '',
      signature: initialSettings.signature || '',
      autoBcc: initialSettings.autoBcc || '',
      undoSendTime: initialSettings.undoSendTime || 5,
    },
  })

  // Phone settings form
  const phoneForm = useForm<PhoneSettingsFormValues>({
    resolver: standardSchemaResolver(phoneSettingsSchema),
    defaultValues: {
      displayName: initialSettings.displayName || '',
      signatureText: initialSettings.signatureText || '',
      autoReply: initialSettings.autoReply || false,
      autoReplyMessage: initialSettings.autoReplyMessage || '',
    },
  })

  // Handle email settings form submission
  const onEmailSubmit = (values: EmailSettingsFormValues) => {
    console.log('Email settings saved:', values)
    // TODO: Implement saving settings via API
  }

  // Handle phone settings form submission
  const onPhoneSubmit = (values: PhoneSettingsFormValues) => {
    console.log('Phone settings saved:', values)
    // TODO: Implement saving settings via API
  }

  // Handle sync button click
  const handleSync = (days: number) => {
    setIsSyncing(true)
    syncMessages.mutate(
      { integrationId: integration.id, days: days },
      {
        onSettled: () => {
          setIsSyncing(false)
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      {/* Sync card - visible for all integration types */}
      <Card>
        <CardHeader>
          <CardTitle>Sync Messages</CardTitle>
          <CardDescription>Manually sync messages from this integration</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              By default, new messages are synced automatically. You can manually trigger a sync to
              retrieve older messages.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => handleSync(7)}
                disabled={isSyncing || syncMessages.isPending}>
                <RefreshCw />
                Last 7 days
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSync(30)}
                disabled={isSyncing || syncMessages.isPending}>
                <RefreshCw />
                Last 30 days
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSync(90)}
                disabled={isSyncing || syncMessages.isPending}>
                <RefreshCw />
                Last 90 days
              </Button>
            </div>

            {integration.lastSyncedAt && (
              <p className="text-xs text-muted-foreground">
                Last synced: {new Date(integration.lastSyncedAt).toLocaleString()}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Email-specific settings */}
      {isEmailProvider && (
        <Form {...emailForm}>
          <form onSubmit={emailForm.handleSubmit(onEmailSubmit)}>
            <Card>
              <CardHeader>
                <CardTitle>Email Settings</CardTitle>
                <CardDescription>Configure your email preferences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={emailForm.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <div className="flex items-center space-x-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <Input placeholder="Your Name" {...field} />
                        </div>
                      </FormControl>
                      <FormDescription>This name will be shown as the sender</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={emailForm.control}
                  name="signature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Signature</FormLabel>
                      <FormControl>
                        <div className="flex items-center space-x-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <Input placeholder="Signature text" {...field} />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Simple signature to append to outgoing emails
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={emailForm.control}
                  name="autoBcc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Auto BCC</FormLabel>
                      <FormControl>
                        <div className="flex items-center space-x-2">
                          <MailCheck className="h-4 w-4 text-muted-foreground" />
                          <Input type="email" placeholder="email@example.com" {...field} />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Automatically BCC this email on all outgoing messages
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={emailForm.control}
                  name="undoSendTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Undo Send Time</FormLabel>
                      <FormControl>
                        <div className="flex items-center space-x-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <Select
                            value={field.value.toString()}
                            onValueChange={(value) => field.onChange(parseInt(value))}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select time" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">No delay</SelectItem>
                              <SelectItem value="5">5 seconds</SelectItem>
                              <SelectItem value="10">10 seconds</SelectItem>
                              <SelectItem value="20">20 seconds</SelectItem>
                              <SelectItem value="30">30 seconds</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </FormControl>
                      <FormDescription>Time window to undo sending an email</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter>
                <Button type="submit">Save Settings</Button>
              </CardFooter>
            </Card>
          </form>
        </Form>
      )}

      {/* Phone-specific settings */}
      {isPhoneProvider && (
        <Form {...phoneForm}>
          <form onSubmit={phoneForm.handleSubmit(onPhoneSubmit)}>
            <Card>
              <CardHeader>
                <CardTitle>Phone Settings</CardTitle>
                <CardDescription>Configure your phone preferences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={phoneForm.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <div className="flex items-center space-x-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <Input placeholder="Your Name" {...field} />
                        </div>
                      </FormControl>
                      <FormDescription>This name will be shown to recipients</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={phoneForm.control}
                  name="signatureText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message Signature</FormLabel>
                      <FormControl>
                        <Input placeholder="Signature text" {...field} />
                      </FormControl>
                      <FormDescription>Text to append to outgoing messages</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <FormField
                  control={phoneForm.control}
                  name="autoReply"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Auto-Reply</FormLabel>
                        <FormDescription>
                          Automatically respond to incoming messages
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {phoneForm.watch('autoReply') && (
                  <FormField
                    control={phoneForm.control}
                    name="autoReplyMessage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Auto-Reply Message</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Thanks for your message. I'll get back to you shortly."
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>Message to send as an automatic reply</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
              <CardFooter>
                <Button type="submit">Save Settings</Button>
              </CardFooter>
            </Card>
          </form>
        </Form>
      )}

      {/* Social media-specific settings */}
      {isSocialProvider && (
        <Card>
          <CardHeader>
            <CardTitle>{integration.provider} Settings</CardTitle>
            <CardDescription>
              Configure your {integration.provider} integration preferences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Advanced settings for this integration are configured through the{' '}
              {integration.provider} platform.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
