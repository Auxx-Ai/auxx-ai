// apps/web/src/types/auth.d.ts

declare module 'better-auth/types' {
  interface User {
    completedOnboarding?: boolean
    defaultOrganizationId?: string | null
    avatarAssetId?: string | null
    phoneNumberVerified?: boolean
    firstName?: string | null
    lastName?: string | null
    providers?: string[]
    registrationMethod?: 'oauth' | 'email' | 'phone' | 'mixed'
    hasPassword?: boolean
  }

  interface Session {
    user: User & {
      providers?: string[]
      registrationMethod?: 'oauth' | 'email' | 'phone' | 'mixed'
      hasPassword?: boolean
    }
  }
}