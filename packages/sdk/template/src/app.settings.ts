// packages/sdk/template/src/app.settings.ts

import { type SettingsSchema, Settings } from '@auxx/sdk'

/**
 * App Settings Schema
 * Define settings that can be configured by users and organizations
 *
 * Settings can be accessed in your app using:
 * - getOrganizationSetting(key) - Get organization-level setting
 * - getUserSetting(key) - Get user-level setting
 * - setOrganizationSetting(key, value) - Update organization setting
 * - setUserSetting(key, value) - Update user setting
 */
export const appSettingsSchema = {
  /**
   * Organization-level settings
   * These settings apply to the entire organization
   */
  organization: {
    // ========================================
    // COMPREHENSIVE TEST SCHEMA
    // Testing all field types, nesting, and validation
    // ========================================

    // Top-level string with length validation
    appName: Settings.string({
      label: 'Application Name',
      description: 'Display name for this application',
      default: 'My App',
      minLength: 3,
      maxLength: 50,
    }),

    // Top-level number with min/max constraints
    maxRetries: Settings.number({
      label: 'Max Retries',
      description: 'Maximum number of retry attempts',
      default: 3,
      min: 0,
      max: 10,
    }),

    // Top-level boolean
    enableNotifications: Settings.boolean({
      label: 'Enable Notifications',
      description: 'Send email notifications for important events',
      default: true,
    }),

    // Top-level optional boolean
    debugMode: Settings.boolean({
      label: 'Debug Mode',
      description: 'Enable verbose logging',
      default: false,
    }).optional(),

    // Select field with enum validation
    timezone: Settings.select({
      options: ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'] as const,
      default: 'UTC',
      label: 'Timezone',
      description: 'Default timezone for timestamps',
    }),

    // 1-level nested struct
    email: Settings.struct(
      {
        fromName: Settings.string({
          label: 'From Name',
          default: 'Support Team',
        }),
        fromAddress: Settings.string({
          label: 'From Email',
          default: 'support@example.com',
          pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', // Email regex
        }),
      },
      {
        label: 'Email Settings',
        description: 'Configure email sender information',
      }
    ),

    // 2-level nested struct (CRITICAL TEST - deeply nested)
    smtp: Settings.struct(
      {
        server: Settings.struct(
          {
            host: Settings.string({
              label: 'SMTP Host',
              default: 'smtp.gmail.com',
              minLength: 1,
            }),
            port: Settings.number({
              label: 'SMTP Port',
              default: 587,
              min: 1,
              max: 65535,
            }),
            secure: Settings.boolean({
              label: 'Use TLS',
              default: true,
            }),
          },
          {
            label: 'Server Configuration',
          }
        ),
        auth: Settings.struct(
          {
            username: Settings.string({
              label: 'Username',
              minLength: 1,
            }),
            password: Settings.string({
              label: 'Password',
              minLength: 8,
            }),
          },
          {
            label: 'Authentication',
          }
        ).optional(), // Optional nested struct
      },
      {
        label: 'SMTP Configuration',
        description: 'Configure SMTP server for sending emails',
      }
    ),

    // Optional webhook secret
    webhookSecret: Settings.string({
      label: 'Webhook Secret',
      description: 'Secret for validating webhook signatures',
      minLength: 16,
    }).optional(),
  },

  /**
   * User-level settings
   * These settings are specific to each user
   */
  user: {
    // theme: select({
    //   options: ['light', 'dark', 'auto'] as const,
    //   default: 'auto',
    //   label: 'Theme',
    //   description: 'Color theme preference',
    // }),

    // notifications: struct({
    //   email: boolean({ label: 'Email Notifications', default: true }),
    //   desktop: boolean({ label: 'Desktop Notifications', default: true }),
    //   sound: boolean({ label: 'Sound Alerts', default: false }),
    // }),

    // // Optional custom signature
    // emailSignature: string({
    //   label: 'Email Signature',
    //   description: 'Your personal email signature',
    // }).optional(),
  },
} satisfies SettingsSchema

export default appSettingsSchema
