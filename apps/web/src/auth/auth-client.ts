// apps/web/src/auth/auth-client.ts

// import { WEBAPP_URL } from '@auxx/config/client'
import { passkeyClient, phoneNumberClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const client = createAuthClient({
  // baseURL: WEBAPP_URL,
  plugins: [
    passkeyClient(),
    phoneNumberClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = '/two-factor'
      },
    }),
  ],
})

export const { signIn, signOut, useSession, updateUser, signUp, verifyEmail, changeEmail } = client
