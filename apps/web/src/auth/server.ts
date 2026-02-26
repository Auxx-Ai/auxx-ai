// src/server/auth/config.ts

import {
  DEV_PORTAL_URL,
  getCookieDomain,
  getPasskeyRpId,
  getTrustedOrigins,
  WEBAPP_URL,
} from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { database, schema } from '@auxx/database' // Drizzle database for services
import { enqueueEmailJob } from '@auxx/lib/jobs'
import { seedNewUserDatabase } from '@auxx/lib/seed'
import { getUserById } from '@auxx/lib/users'
import { createScopedLogger } from '@auxx/logger'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth' // core lib
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { bearer, customSession, oidcProvider, phoneNumber, twoFactor } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { isValidPhoneNumber } from 'libphonenumber-js'

const logger = createScopedLogger('auth')
const isDev = configService.get<string>('NODE_ENV') === 'development'

// async function sendViaOpenPhone(to: string, text: string) {
//   const res = await fetch('https://api.openphone.com/v1/messages', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${process.env.OPENPHONE_API_KEY}`,
//     },
//     body: JSON.stringify({ to, from: process.env.OPENPHONE_NUMBER, text }),
//   })

//   if (!res.ok) {
//     // grab the body for more context
//     const body = await res.text()
//     throw new Error(`Failed to send SMS (${res.status}): ${body}`)
//   }
// }
const trustedOrigins = getTrustedOrigins()

// export auth.api
export const auth = betterAuth({
  database: drizzleAdapter(database, { provider: 'pg', schema }), // use your dialect
  secret: configService.get<string>('BETTER_AUTH_SECRET')!, // encryption secret
  baseURL: WEBAPP_URL,
  trustedOrigins,
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Modify the user object before it is created
          logger.info('Creating user', { userId: user.id })
          return {
            data: {
              ...user,
              lastLoginAt: new Date(),
              preferredTimezone: 'UTC',
            },
          }
        },
        after: async (user) => {
          console.warn('AFTER CREATING:', user)
          await seedNewUserDatabase(user)
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    // disableSignUp: false,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url, token }, request) => {
      if (isDev) {
        logger.debug('sendResetPassword', { user, url, token, request })
      }
      await enqueueEmailJob('reset-password', {
        recipient: { email: user.email!, name: user.name || 'User' },
        resetLink: url,
        source: 'auth.server',
      })
    },
    onPasswordReset: async ({ user }, request) => {
      if (isDev) {
        logger.debug('pass', { user, request })
      }
      await enqueueEmailJob('password-reset-notify', {
        recipient: { email: user.email!, name: user.name! },
        source: 'auth.server',
      })
    },
  }, // enable email/password auth
  socialProviders: {
    google: {
      clientId: configService.get<string>('AUTH_GOOGLE_ID')!,
      clientSecret: configService.get<string>('AUTH_GOOGLE_SECRET')!,
      mapProfileToUser: (profile) => {
        return { firstName: profile.given_name, lastName: profile.family_name }
      },
      accessType: 'offline',
      prompt: 'select_account consent',
    },
    github: {
      clientId: configService.get<string>('AUTH_GITHUB_ID')!,
      clientSecret: configService.get<string>('AUTH_GITHUB_SECRET')!,
    },
    // add other providers as needed
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url, token }, request) => {
      console.log('sendVerificationEmail', user)
      if (isDev) {
        logger.info('sendVerificationEmail', { user, url, token, request })
      }

      await enqueueEmailJob('verification', {
        recipient: { email: user.email!, name: user.name || 'User' },
        verificationLink: url,
        source: 'auth.server',
      })
    },
    onEmailVerification: async (user, request) => {},
  },
  rateLimit: {
    // Global defaults (per IP+path)
    window: 60, // 60‑second window
    max: 10, // at most 10 requests per window
    // tighten it up for our OTP sends:
    customRules: {
      '/phone-number/send-otp': {
        window: 60, // 1 minute
        max: 3, // only 3 sends per minute
      },
    },
    // In dev this is off by default—flip it on to test:
    enabled: !isDev,
  },

  user: {
    modelName: 'User',
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ user, newEmail, url, token }, request) => {
        if (isDev) {
          logger.debug('sendChangeEmailVerification', { user, newEmail, token, url, request })
        }

        await enqueueEmailJob('email-change-verification', {
          recipient: { email: user.email!, name: user.name || 'User' },
          newEmail,
          verificationLink: url,
          source: 'auth.server',
        })
      },
    },

    additionalFields: {
      completedOnboarding: { type: 'boolean' },
      isSuperAdmin: { type: 'boolean' },
      defaultOrganizationId: { type: 'string' },
      avatarAssetId: { type: 'string' },
      lastLoginAt: { type: 'date' },
      preferredTimezone: { type: 'string' },
      // memberStatus: { type: 'string' },
    },
  },
  session: {
    expiresIn: 30 * 24 * 60 * 60, // 30 days
    cookieCache: { enabled: true, maxAge: 5 * 60 },
    cookieOptions: {
      httpOnly: true,
      secure: !isDev,
      sameSite: 'lax',
      domain: getCookieDomain(),
    },
  },
  plugins: [
    nextCookies(),
    bearer(),
    twoFactor({
      issuer: 'Auxx.Ai',
      otpOptions: {
        async sendOTP({ user, otp }) {
          console.log('sendOTP', { user, otp })
          // await resend.emails.send({
          //   from,
          //   to: user.email,
          //   subject: 'Your OTP',
          //   html: `Your OTP is ${otp}`,
          // })
        },
      },
    }),

    passkey({
      schema: {
        passkey: {
          modelName: 'Passkey',
        },
      },
      rpID: getPasskeyRpId(),
      rpName: 'Auxx.Ai',
      origin: WEBAPP_URL!,

      // passkeyOptions: {
      //   userVerification: 'preferred',
      // },
    }),
    customSession(async ({ user, session }) => {
      // logger.info('customSession', { user })
      // Cast user to include additional fields
      const extendedUser = user as typeof user & {
        defaultOrganizationId?: string | null
        avatarAssetId?: string | null
        phoneNumberVerified?: boolean
        isSuperAdmin: boolean
        lastLoginAt?: Date | null
        preferredTimezone?: string | null
      }

      if (extendedUser && !extendedUser.defaultOrganizationId) {
        const freshUser = await getUserById(extendedUser.id)
        Object.assign(extendedUser, freshUser ?? {})

        // console.log('new user with org id', extendedUser)
      }

      // Update lastLoginAt only if cache is expired (respects session.cookieCache.maxAge)
      // This prevents database writes on every request while still tracking login activity
      const shouldUpdateLogin =
        !extendedUser.lastLoginAt ||
        new Date().getTime() - new Date(extendedUser.lastLoginAt).getTime() > 3600000 // 1 hour

      if (shouldUpdateLogin) {
        const { eq } = await import('drizzle-orm')
        // Fire-and-forget to avoid blocking the session response
        database
          .update(schema.User)
          .set({
            lastLoginAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.User.id, extendedUser.id))
          .catch((error) => {
            logger.error('Failed to update lastLoginAt', {
              userId: extendedUser.id,
              error: error instanceof Error ? error.message : String(error),
            })
          })

        // Update in-memory to prevent multiple updates within the same session
        extendedUser.lastLoginAt = new Date()
      }

      // Fetch avatar URL if user has an avatar asset
      const avatarUrl: string | null = extendedUser.image || null
      // if (extendedUser.avatarAssetId && extendedUser.defaultOrganizationId) {
      //   const { MediaAssetService } = await import('@auxx/lib/files')
      //   const mediaAssetService = new MediaAssetService(
      //     extendedUser.defaultOrganizationId,
      //     extendedUser.id,
      //     database
      //   )
      //   avatarUrl = await mediaAssetService.getDownloadUrl(extendedUser.avatarAssetId)
      // }

      // Get user's authentication providers
      const accounts = await database
        .select({ providerId: schema.account.providerId })
        .from(schema.account)
        .where(eq(schema.account.userId, extendedUser.id))

      const providers = accounts.map((account) => account.providerId)
      const hasPassword = providers.includes('credential')
      const oauthProviders = providers.filter((p) => p !== 'credential')

      // Determine registration method
      const authMethodCount =
        (hasPassword ? 1 : 0) +
        (oauthProviders.length > 0 ? 1 : 0) +
        (extendedUser.phoneNumberVerified ? 1 : 0)

      let registrationMethod: 'oauth' | 'email' | 'phone' | 'mixed' = 'oauth'

      if (authMethodCount > 1) {
        registrationMethod = 'mixed'
      } else if (hasPassword) {
        registrationMethod = 'email'
      } else if (extendedUser.phoneNumberVerified) {
        registrationMethod = 'phone'
      }

      return {
        ...session,
        user: {
          ...extendedUser,
          image: avatarUrl, // Replace image with avatarUrl from MediaAssetService
          providers: oauthProviders,
          registrationMethod,
          hasPassword,
          preferredTimezone: extendedUser.preferredTimezone || 'UTC',
          lastLoginAt: extendedUser.lastLoginAt,
        },
      }
    }),
    phoneNumber({
      sendOTP: async ({ phoneNumber, code }) => {
        console.log('sendOTP', { phoneNumber, code })
        // await sendViaOpenPhone(phoneNumber, `Your verification code is: ${code}`)
      },
      // callbackOnVerification: async ({ phoneNumber, user }) => {
      //   await auth.adapter.updateUser(user.id, { phoneNumber, phoneNumberVerified: true })
      // },
      signUpOnVerification: {
        getTempEmail: (phone) => `${phone}@temp.myapp.com`,
        getTempName: (phone) => `User ${phone.slice(-4)}`,
      },
      phoneNumberValidator: (phone) => {
        return isValidPhoneNumber(phone, 'US')
        // const phoneRegex = /^\+?[1-9]\d{1,14}$/
        // return phoneRegex.test(phone)
      },
      requireVerification: true,
      otpLength: 6,
      expiresIn: 300,
    }),
    oidcProvider({
      // Custom consent page
      consentPage: '/consent',
      // Trusted clients (first-party apps like SDK CLI)
      trustedClients: [
        {
          clientId: 'auxx-sdk-cli',
          // Public clients don't use clientSecret for auth (PKCE only), but better-auth
          // still needs it to sign the ID token. This secret is never sent by the SDK.
          clientSecret:
            configService.get<string>('SDK_CLIENT_SECRET') || 'auxx-sdk-cli-secret-for-jwt-signing',
          name: 'Auxx SDK CLI',
          type: 'public', // Public client - uses PKCE, not clientSecret for auth
          redirectURLs: [
            'http://localhost:3000/callback',
            'http://localhost:3001/callback',
            'http://localhost:3002/callback',
            'http://localhost:3003/callback',
            'http://localhost:3004/callback',
            'http://localhost:3005/callback',
            'http://localhost:3006/callback',
            'http://localhost:3007/callback',
            'http://localhost:3008/callback',
            'http://localhost:3009/callback',
            'http://localhost:3010/callback',
            'http://127.0.0.1:3000/callback',
            'http://127.0.0.1:3001/callback',
            'http://127.0.0.1:3002/callback',
            'http://127.0.0.1:3003/callback',
            'http://127.0.0.1:3004/callback',
            'http://127.0.0.1:3005/callback',
            'http://127.0.0.1:3006/callback',
            'http://127.0.0.1:3007/callback',
            'http://127.0.0.1:3008/callback',
            'http://127.0.0.1:3009/callback',
            'http://127.0.0.1:3010/callback',
          ],
          disabled: false,
          skipConsent: true,
          metadata: { publicClient: true, firstParty: true },
        },
        {
          clientId: 'test-app-connection',
          clientSecret:
            configService.get<string>('TEST_APP_CLIENT_SECRET') || 'test-app-connection-secret',
          name: 'Test App Connection',
          type: 'web', // Web application - uses client_id + client_secret
          redirectURLs: [
            `${WEBAPP_URL}/api/apps/test-app/oauth2/callback`,
            `${DEV_PORTAL_URL}/api/apps/test-app/oauth2/callback`,
          ],
          disabled: false,
          skipConsent: false, // Show consent screen for testing
          metadata: { testing: true, firstParty: true },
        },
      ],
      // Define custom scopes for developer access
      scopes: ['developer', 'apps:read', 'apps:write', 'versions:publish'],
      // Login page for OAuth flow
      loginPage: '/login',
      // Disable dynamic client registration (only use trusted clients)
      allowDynamicClientRegistration: false,
    }),
  ],

  // optional: plugins like captcha(), twoFactor(), etc.
})

// ({
//   ...authConfig,
//   // optional: add your own custom routes
// })
