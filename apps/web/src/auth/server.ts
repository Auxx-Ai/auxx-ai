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
import {
  bearer,
  captcha,
  customSession,
  oidcProvider,
  phoneNumber,
  twoFactor,
} from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { isValidPhoneNumber } from 'libphonenumber-js'

const logger = createScopedLogger('auth')
const isProduction = configService.get<string>('NODE_ENV') === 'production'

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
          logger.info('User created', { userId: user.id })
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
      logger.info('Sending password reset email', { userId: user.id })
      await enqueueEmailJob('reset-password', {
        recipient: { email: user.email!, name: user.name || 'User' },
        resetLink: url,
        source: 'auth.server',
      })
    },
    onPasswordReset: async ({ user }, request) => {
      logger.info('Password reset completed', { userId: user.id })

      // Invalidate all existing sessions for this user
      await database
        .delete(schema.session)
        .where(eq(schema.session.userId, user.id))
        .catch((error) => {
          logger.error('Failed to invalidate sessions on password reset', {
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          })
        })

      await enqueueEmailJob('password-reset-notify', {
        recipient: { email: user.email!, name: user.name! },
        source: 'auth.server',
      })
    },
  }, // enable email/password auth
  account: {
    encryptOAuthTokens: true,
  },
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
      logger.info('Sending verification email', { userId: user.id, email: user.email })

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
    customRules: {
      '/phone-number/send-otp': {
        window: 60,
        max: 3,
      },
      '/sign-up/email': {
        window: 3600, // 1 hour
        max: 5,
      },
      '/sign-in/email': {
        window: 60,
        max: 5,
      },
      '/forget-password': {
        window: 60,
        max: 3,
      },
      '/send-verification-email': {
        window: 60,
        max: 3,
      },
    },
    enabled: configService.get<string>('DISABLE_RATE_LIMITING') !== 'true',
  },

  user: {
    modelName: 'User',
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ user, newEmail, url, token }, request) => {
        logger.info('Sending email change verification', { userId: user.id })
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
      banned: { type: 'boolean' },
      forcePasswordChange: { type: 'boolean' },
    },
  },
  session: {
    expiresIn: 30 * 24 * 60 * 60, // 30 days
    cookieCache: { enabled: true, maxAge: 5 * 60 },
    cookieOptions: {
      httpOnly: true,
      secure: isProduction || !!configService.get<string>('DOMAIN'),
      sameSite: 'lax',
      domain: getCookieDomain(),
    },
  },
  plugins: [
    nextCookies(),
    bearer(),
    ...(configService.get<string>('TURNSTILE_SECRET_KEY')
      ? [
          captcha({
            provider: 'cloudflare-turnstile',
            secretKey: configService.get<string>('TURNSTILE_SECRET_KEY')!,
          }),
        ]
      : []),
    twoFactor({
      issuer: 'Auxx.Ai',
      otpOptions: {
        async sendOTP({ user, otp }) {
          logger.info('Sending 2FA OTP email', { userId: user.id })
          await enqueueEmailJob('two-factor-otp', {
            recipient: { email: user.email!, name: user.name || 'User' },
            otp,
            source: 'auth.server',
          })
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
      // Cast user to include additional fields
      const extendedUser = user as typeof user & {
        defaultOrganizationId?: string | null
        avatarAssetId?: string | null
        phoneNumberVerified?: boolean
        isSuperAdmin: boolean
        banned?: boolean
        forcePasswordChange?: boolean
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

      // Get user's authentication providers from cache (avoids 12+ redundant DB queries per page load)
      const { getUserCache } = await import('@auxx/lib/cache')
      const userProfile = await getUserCache().get(extendedUser.id, 'userProfile')

      const oauthProviders = userProfile?.providers ?? []
      const hasPassword = userProfile?.hasPassword ?? false
      const registrationMethod = userProfile?.registrationMethod ?? 'oauth'

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
          forcePasswordChange: extendedUser.forcePasswordChange ?? false,
        },
      }
    }),
    phoneNumber({
      sendOTP: async ({ phoneNumber, code }) => {
        logger.info('Sending phone OTP', { phoneNumber: phoneNumber.slice(-4) })
        // TODO: Implement SMS delivery (e.g. OpenPhone, Twilio)
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
      // Hash client secrets at rest (prevents plaintext exposure on DB breach)
      storeClientSecret: 'hashed',
      // Custom consent page
      consentPage: '/consent',
      // Trusted clients (first-party apps like SDK CLI)
      trustedClients: [
        {
          clientId: 'auxx-sdk-cli',
          // Public clients don't use clientSecret for auth (PKCE only), but better-auth
          // still needs it to sign the ID token. This secret is never sent by the SDK.
          clientSecret: configService.get<string>('SDK_CLIENT_SECRET')!,
          name: 'Auxx SDK CLI',
          type: 'public', // Public client - uses PKCE, not clientSecret for auth
          redirectUrls: [
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
          clientSecret: configService.get<string>('TEST_APP_CLIENT_SECRET')!,
          name: 'Test App Connection',
          type: 'web', // Web application - uses client_id + client_secret
          redirectUrls: [
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
