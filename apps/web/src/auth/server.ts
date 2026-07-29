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
import { recordAudit } from '@auxx/lib/audit-log'
import { getUserCache, onCacheEvent } from '@auxx/lib/cache'
import type { DehydratedUser } from '@auxx/lib/dehydration'
import { enqueueEmailJob } from '@auxx/lib/jobs'
import { seedNewUserDatabase } from '@auxx/lib/seed'
import { getUserById } from '@auxx/lib/users'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth' // core lib
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
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
import { requestAuditContext } from '~/server/api/audit-context'

const logger = createScopedLogger('auth')
const isProduction = configService.get<string>('NODE_ENV') === 'production'

/**
 * In-process front for the hourly login-throttle gate in `customSession`.
 * That callback runs on every getSession, and the Redis `SET NX` it guards
 * with used to fire on 100% of authenticated calls to claim a signal that is
 * meaningful at most once/hour/user. Once a window is claimed (by any
 * instance), remember its expiry locally and skip the Redis round-trip;
 * Redis NX stays the authoritative cross-instance gate on local miss.
 */
const loginThrottleLocal = new Map<string, number>()
const LOGIN_THROTTLE_WINDOW_SECONDS = 3600

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

/**
 * Better-auth paths that demo users must not access.
 * These bypass tRPC entirely (client SDK → /api/auth/[...all]).
 */
const DEMO_BLOCKED_AUTH_PATHS = new Set([
  // Core auth mutations
  '/change-password',
  '/change-email',
  // Passkey (WebAuthn two-step: generate-options → verify)
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
  // Two-factor
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/verify-totp',
  '/two-factor/get-totp-uri',
])

/**
 * Auth paths that must always be rejected for AGENT users.
 * Agents never log in. Any path that could mutate auth state for an
 * agent is blocked here as a defense-in-depth measure on top of the
 * customSession + databaseHooks rejections below.
 */
const AGENT_BLOCKED_AUTH_PATHS = new Set([
  '/sign-in',
  '/sign-in/email',
  '/sign-in/social',
  '/sign-up',
  '/sign-up/email',
  '/forget-password',
  '/reset-password',
  '/change-password',
  '/change-email',
  '/send-verification-email',
  '/verify-email',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/verify-totp',
  '/two-factor/get-totp-uri',
  '/phone-number/send-otp',
  '/phone-number/verify',
])

/**
 * Security-sensitive auth paths with no native better-auth lifecycle hook.
 * 2FA + passkey mutations are audited from the `hooks.after` wrapper, keyed on the
 * request path and only when the endpoint returned successfully (not an APIError).
 */
const SECURITY_AUDIT_PATHS: Record<string, string> = {
  '/two-factor/enable': '2fa.enabled',
  '/two-factor/disable': '2fa.disabled',
  '/passkey/verify-registration': 'passkey.added',
  '/passkey/delete-passkey': 'passkey.removed',
}

/**
 * Auth paths whose failures are recorded as `auth.signin_failed` (security). The
 * `hooks.after` wrapper runs even on failure, so we audit when one of these returns an
 * APIError. Email/password is the brute-force surface; 2FA verify covers failed second
 * factors. OAuth failures mostly surface at the callback, so coverage there is partial.
 */
const SIGNIN_FAILURE_PATHS = new Set([
  '/sign-in/email',
  '/sign-in/social',
  '/two-factor/verify-totp',
])

// export auth.api
export const auth = betterAuth({
  database: drizzleAdapter(database, { provider: 'pg', schema }), // use your dialect
  secret: configService.get<string>('BETTER_AUTH_SECRET')!, // encryption secret
  baseURL: WEBAPP_URL,
  trustedOrigins,
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // An invited signup must create the account under the invited address.
      // This runs BEFORE the user row exists, which is the point: once the user
      // is created, `seedNewUserDatabase` has already committed an organization
      // and a Stripe trial, and a mismatch can only be cleaned up after the
      // fact. Enforced server-side because locking the form field is cosmetic —
      // and because letting the invitee redirect the grant to an address of
      // their choosing would make the link a bearer token for the organization.
      // `invitationToken` is not a declared `user.additionalFields` entry, so
      // better-auth strips it before the insert; it exists only for this check.
      if (ctx.path === '/sign-up/email') {
        const body = ctx.body as { email?: unknown; invitationToken?: unknown } | undefined
        const invitationToken =
          typeof body?.invitationToken === 'string' ? body.invitationToken : null
        if (invitationToken) {
          const { getInvitationPreview, normalizeEmail } = await import('@auxx/lib/members')
          const preview = await getInvitationPreview({ token: invitationToken })
          if (!preview.valid) {
            logger.warn('Rejecting signup: invitation token not usable', {
              reason: preview.reason,
            })
            throw new APIError('BAD_REQUEST', {
              message:
                preview.reason === 'expired'
                  ? 'This invitation has expired. Ask an admin to send a new one.'
                  : 'This invitation link is no longer valid. Ask an admin to send a new one.',
            })
          }
          const submitted = typeof body?.email === 'string' ? normalizeEmail(body.email) : ''
          if (submitted !== preview.email) {
            logger.warn('Rejecting signup: email does not match the invitation')
            throw new APIError('BAD_REQUEST', {
              message: `This invitation is for ${preview.email}. Create your account with that address, or ask an admin to invite ${submitted || 'your address'} instead.`,
            })
          }
        }
      }

      // `ctx.request` is only populated for HTTP-driven calls. Server-side
      // `auth.api.*` invocations (e.g. the demo create-session route) pass only
      // `headers`, leaving `ctx.request` undefined — so resolve from `ctx.headers`.
      const requestHeaders = ctx.headers ?? ctx.request?.headers
      if (!requestHeaders) return

      // Agent guard: if a request resolves to an AGENT user OR targets a
      // path that mutates auth state, look up the resolved user and reject.
      if (AGENT_BLOCKED_AUTH_PATHS.has(ctx.path)) {
        const session = await auth.api.getSession({ headers: requestHeaders })
        const sessionUser = session?.user as
          | (typeof session extends null ? never : { id: string })
          | undefined
        if (sessionUser?.id) {
          const dbUser = await getUserById(sessionUser.id)
          if (dbUser && (dbUser as { userType?: string }).userType === 'AGENT') {
            logger.info('[agent-guard] Rejecting auth path for AGENT user', {
              path: ctx.path,
              userId: dbUser.id,
            })
            throw new APIError('FORBIDDEN', {
              message: 'Agents cannot perform authentication actions.',
            })
          }
        }
      }

      if (!DEMO_BLOCKED_AUTH_PATHS.has(ctx.path)) return

      // Session isn't resolved yet in before hooks — resolve from request headers
      const session = await auth.api.getSession({ headers: requestHeaders })
      if (!session?.user) return

      const user = session.user as typeof session.user & {
        defaultOrganizationId?: string | null
      }
      if (!user.defaultOrganizationId) return

      const { getOrgCache } = await import('@auxx/lib/cache')
      const orgProfile = await getOrgCache().get(user.defaultOrganizationId, 'orgProfile')

      if (orgProfile?.demoExpiresAt) {
        logger.info('[demo-guard] BLOCKING demo user', {
          path: ctx.path,
          orgId: user.defaultOrganizationId,
        })
        throw new APIError('FORBIDDEN', {
          message:
            'This action is not available in demo mode. Sign up for a free account to manage your security settings.',
        })
      }
    }),
    // Audit 2FA / passkey changes — these endpoints have no native lifecycle hook,
    // so we observe them here. The after hook runs even on failure, so we skip
    // any request whose endpoint returned an APIError.
    after: createAuthMiddleware(async (ctx) => {
      // Failed sign-in attempts (security). The after hook runs on failure too, so a
      // sign-in path that returned an APIError is a rejected authentication. No
      // authenticated identity exists, so we log the attempted email + IP/UA for review
      // rather than a real actor. Internal visibility keeps the noise out of the customer
      // feed; no email→userId lookup, to avoid DB amplification during a brute-force burst.
      if (SIGNIN_FAILURE_PATHS.has(ctx.path) && ctx.context.returned instanceof APIError) {
        const attemptedEmail = (ctx.body as { email?: unknown } | undefined)?.email
        await recordAudit({
          organizationId: null,
          category: 'auth',
          action: 'auth.signin_failed',
          actorType: 'user',
          actorId: null,
          targetType: 'User',
          targetId: null,
          visibility: 'internal',
          metadata: {
            attemptedEmail: typeof attemptedEmail === 'string' ? attemptedEmail : null,
            reason: ctx.context.returned.message ?? null,
            path: ctx.path,
          },
          context: requestAuditContext(ctx.request?.headers),
        })
        return
      }

      const action = SECURITY_AUDIT_PATHS[ctx.path]
      if (!action) return
      if (ctx.context.returned instanceof APIError) return

      const headers = ctx.request?.headers
      const session = headers ? await auth.api.getSession({ headers }) : null
      const actor = session?.user as
        | { id: string; defaultOrganizationId?: string | null }
        | undefined
      if (!actor?.id) return

      await recordAudit({
        organizationId: actor.defaultOrganizationId ?? null,
        category: 'security',
        action,
        actorType: 'user',
        actorId: actor.id,
        targetType: 'User',
        targetId: actor.id,
        context: requestAuditContext(headers),
      })
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Reject if a caller tries to create an AGENT user via the auth API.
          // Agents must be created exclusively via createAgent() in @auxx/lib/agents.
          if ((user as { userType?: string }).userType === 'AGENT') {
            logger.warn('Rejecting AGENT user creation via auth API', { email: user.email })
            throw new APIError('FORBIDDEN', {
              message: 'Agent users cannot be created via the authentication API.',
            })
          }
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
    account: {
      create: {
        after: async (account) => {
          // Invalidate user profile cache when a new OAuth provider is linked
          // so the session reflects the updated providers list immediately
          logger.info('Account linked', {
            userId: account.userId,
            provider: account.providerId,
          })
          const user = await getUserById(account.userId)
          if (user && (user as { userType?: string }).userType === 'AGENT') {
            logger.warn('Refusing to attach Account to AGENT user', {
              userId: account.userId,
              provider: account.providerId,
            })
            throw new APIError('FORBIDDEN', {
              message: 'Agent users cannot link authentication accounts.',
            })
          }
          if (user?.defaultOrganizationId) {
            await onCacheEvent('user.updated', {
              orgId: user.defaultOrganizationId,
              userId: account.userId,
            })
          }

          // No request context here — databaseHooks don't receive the HTTP request.
          await recordAudit({
            organizationId: user?.defaultOrganizationId ?? null,
            category: 'auth',
            action: 'oauth.linked',
            actorType: 'user',
            actorId: account.userId,
            targetType: 'User',
            targetId: account.userId,
            metadata: { provider: account.providerId },
          })
        },
      },
    },
    session: {
      create: {
        // Fires once per real authentication (every provider, after 2FA), so this is the
        // authoritative "user signed in" record — distinct from the throttled `auth.login`
        // session-activity heartbeat in customSession. better-auth persists ipAddress/userAgent
        // on the Session row, so we keep IP/UA here even though databaseHooks get no HTTP request.
        after: async (session) => {
          const user = await getUserById(session.userId)
          await recordAudit({
            organizationId: user?.defaultOrganizationId ?? null,
            category: 'auth',
            action: 'auth.signin',
            actorType: 'user',
            actorId: session.userId,
            targetType: 'User',
            targetId: session.userId,
            context: {
              ipAddress: session.ipAddress ?? null,
              userAgent: session.userAgent ?? null,
              sessionId: session.id,
            },
          })
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
      if ((user as { userType?: string }).userType === 'AGENT') {
        logger.warn('Refusing password reset for AGENT user', { userId: user.id })
        throw new APIError('FORBIDDEN', {
          message: 'Password reset is not available for this account.',
        })
      }
      logger.info('Sending password reset email', { userId: user.id })
      await enqueueEmailJob('reset-password', {
        recipient: { email: user.email!, name: user.name || 'User' },
        resetLink: url,
        source: 'auth.server',
      })

      await recordAudit({
        organizationId:
          (user as { defaultOrganizationId?: string | null }).defaultOrganizationId ?? null,
        category: 'auth',
        action: 'password.reset_requested',
        actorType: 'user',
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        context: requestAuditContext(request?.headers),
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

      const organizationId =
        (user as { defaultOrganizationId?: string | null }).defaultOrganizationId ?? null
      const context = requestAuditContext(request?.headers)
      await recordAudit({
        organizationId,
        category: 'auth',
        action: 'password.reset_completed',
        actorType: 'user',
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        context,
      })
      await recordAudit({
        organizationId,
        category: 'security',
        action: 'sessions.invalidated',
        actorType: 'user',
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        reason: 'password_reset',
        context,
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
      // Skip verification email for demo users — prevents SES bounces to non-existent addresses
      const demoDomain = configService.get<string>('DEMO_EMAIL_DOMAIN', 'demo.auxx.ai')
      if (user.email?.endsWith(`@${demoDomain}`)) {
        logger.info('Skipping verification email for demo user', { email: user.email })
        return
      }

      logger.info('Sending verification email', { userId: user.id, email: user.email })

      await enqueueEmailJob('verification', {
        recipient: { email: user.email!, name: user.name || 'User' },
        verificationLink: url,
        source: 'auth.server',
      })
    },
    onEmailVerification: async (user, request) => {
      await recordAudit({
        organizationId:
          (user as { defaultOrganizationId?: string | null }).defaultOrganizationId ?? null,
        category: 'auth',
        action: 'email.verified',
        actorType: 'user',
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        context: requestAuditContext(request?.headers),
      })
    },
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
        if ((user as { userType?: string }).userType === 'AGENT') {
          logger.warn('Refusing email change for AGENT user', { userId: user.id })
          throw new APIError('FORBIDDEN', {
            message: 'Email change is not available for this account.',
          })
        }
        logger.info('Sending email change verification', { userId: user.id })
        await enqueueEmailJob('email-change-verification', {
          recipient: { email: user.email!, name: user.name || 'User' },
          newEmail,
          verificationLink: url,
          source: 'auth.server',
        })

        await recordAudit({
          organizationId:
            (user as { defaultOrganizationId?: string | null }).defaultOrganizationId ?? null,
          category: 'auth',
          action: 'email.change_requested',
          actorType: 'user',
          actorId: user.id,
          targetType: 'User',
          targetId: user.id,
          newState: { newEmail },
          context: requestAuditContext(request?.headers),
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
      signupSource: { type: 'string' },
    },
  },
  session: {
    expiresIn: 30 * 24 * 60 * 60, // 30 days
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    // SameSite=None + Secure in every environment, including local dev.
    // Chrome/Firefox/Safari all treat http://localhost as a secure context,
    // so `Secure` cookies are accepted there. This keeps dev-prod parity
    // and lets the chrome-extension origin attach the session cookie via CORS.
    useSecureCookies: true,
    defaultCookieAttributes: {
      httpOnly: true,
      secure: true,
      sameSite: 'none' as const,
      ...(getCookieDomain() ? { domain: getCookieDomain() } : {}),
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
    customSession(async ({ user, session }, ctx) => {
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

      // Load the cached user profile (Redis-backed, ~1-day TTL) instead of a per-request
      // `getUserById` DB SELECT. This callback runs on every getSession (every page load,
      // tRPC call, API route), so that query was the hottest read in the app. The profile
      // carries existence, userType, and auth metadata. `userProfileProvider.compute`
      // throws when the user no longer exists, so a throw means the session references a
      // deleted user — invalidate it. The cache is flushed on user delete/ban/etc.
      // (getUserCache().invalidateUser), so revocation stays prompt.
      let userProfile: DehydratedUser
      try {
        userProfile = await getUserCache().get(extendedUser.id, 'userProfile')
      } catch (error) {
        logger.warn('Session references non-existent user, invalidating', {
          userId: extendedUser.id,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }

      // Agents never have sessions. If a session was somehow created against
      // an AGENT user, invalidate it.
      if (userProfile.userType === 'AGENT') {
        logger.warn('Session references AGENT user, invalidating', {
          userId: extendedUser.id,
        })
        return null
      }

      // `userProfile` (Redis-backed, invalidated on every default-org change via
      // `setUserDefaultOrganization`) is the source of truth for the active org. Always take it
      // from the profile rather than the better-auth session, whose 5-min cookie cache otherwise
      // serves a stale `defaultOrganizationId` for up to 5 minutes after an org switch.
      extendedUser.defaultOrganizationId = userProfile.defaultOrganizationId

      // Track the "active login" signal (lastLoginAt write + auth.login audit) at most
      // once/hour per user. Gate on a dedicated Redis NX key, NOT a cached/cookie
      // lastLoginAt: the fire-and-forget write below doesn't refresh those, so gating on
      // them re-fires every request (the audit-row spam we saw). `getRedisClient(false)`
      // returns undefined on outage → we skip the side effect (without claiming the
      // local window, so the next call retries) rather than block session hydration.
      let isFirstLoginThisHour = false
      const localWindowExpiry = loginThrottleLocal.get(extendedUser.id)
      if (!localWindowExpiry || localWindowExpiry <= Date.now()) {
        const redis = await getRedisClient(false)
        if (redis) {
          isFirstLoginThisHour =
            (await redis.set(
              `auth:login-throttle:${extendedUser.id}`,
              '1',
              'NX',
              'EX',
              LOGIN_THROTTLE_WINDOW_SECONDS
            )) === 'OK'
          // Claimed (by us or another instance) — skip the Redis round-trip for the
          // rest of the hour. Bound the map instead of tracking per-entry eviction.
          if (loginThrottleLocal.size >= 10_000) loginThrottleLocal.clear()
          loginThrottleLocal.set(extendedUser.id, Date.now() + LOGIN_THROTTLE_WINDOW_SECONDS * 1000)
        }
      }

      if (isFirstLoginThisHour) {
        const { eq } = await import('drizzle-orm')
        const now = new Date()
        // Fire-and-forget to avoid blocking the session response.
        database
          .update(schema.User)
          .set({ lastLoginAt: now, updatedAt: now })
          .where(eq(schema.User.id, extendedUser.id))
          .catch((error) => {
            logger.error('Failed to update lastLoginAt', {
              userId: extendedUser.id,
              error: error instanceof Error ? error.message : String(error),
            })
          })
        extendedUser.lastLoginAt = now

        // Throttled to ≤ once/hour — the "active login" signal. Fire-and-forget.
        void recordAudit({
          organizationId: extendedUser.defaultOrganizationId ?? null,
          category: 'auth',
          action: 'auth.login',
          actorType: 'user',
          actorId: extendedUser.id,
          targetType: 'User',
          targetId: extendedUser.id,
          context: requestAuditContext(ctx?.request?.headers),
        })
      }

      // Avatar URL — keep the cookie value (the MediaAssetService path remains a TODO).
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

      return {
        ...session,
        user: {
          ...extendedUser,
          image: avatarUrl,
          providers: userProfile.providers,
          registrationMethod: userProfile.registrationMethod,
          hasPassword: userProfile.hasPassword,
          preferredTimezone: extendedUser.preferredTimezone || 'UTC',
          lastLoginAt: extendedUser.lastLoginAt ?? userProfile.lastLoginAt,
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
