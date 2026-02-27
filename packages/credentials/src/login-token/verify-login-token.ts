// packages/credentials/src/login-token/verify-login-token.ts

import { errors, importSPKI, jwtVerify } from 'jose'
import { err, ok, type Result } from 'neverthrow'
import { configService } from '../config'
import type { LoginTokenError, LoginTokenPayload, VerifiedLoginToken } from './types'

/**
 * Verify a cross-app login token using the Ed25519 public key.
 * Call this from satellite apps — only requires the public key.
 *
 * @param token - The JWT login token
 * @param expectedAudience - This satellite's origin (e.g. https://build.auxx.ai)
 */
export async function verifyLoginToken(
  token: string,
  expectedAudience: string
): Promise<Result<VerifiedLoginToken, LoginTokenError>> {
  // No fallback — fail fast if public key is not configured
  const publicKeyPem = configService.get<string>('LOGIN_TOKEN_PUBLIC_KEY')
  if (!publicKeyPem) {
    return err({ code: 'MISSING_PUBLIC_KEY', message: 'LOGIN_TOKEN_PUBLIC_KEY not configured' })
  }

  try {
    const publicKey = await importSPKI(publicKeyPem.replace(/\\n/g, '\n'), 'EdDSA')

    const { payload } = await jwtVerify(token, publicKey, {
      audience: expectedAudience,
      clockTolerance: 30, // 30 seconds clock skew tolerance
    })

    if (payload.type !== 'login_token') {
      return err({ code: 'INVALID_TOKEN', message: 'Invalid token type' })
    }

    const p = payload as unknown as LoginTokenPayload

    return ok({
      userId: p.sub,
      email: p.email,
      targetOrigin: p.aud,
      issuerOrigin: p.iss,
      returnTo: p.returnTo,
      jti: p.jti,
    })
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      return err({ code: 'TOKEN_EXPIRED', message: 'Login token has expired' })
    }
    if (
      error instanceof errors.JWTClaimValidationFailed &&
      (error as errors.JWTClaimValidationFailed).claim === 'aud'
    ) {
      return err({ code: 'AUDIENCE_MISMATCH', message: 'Token audience does not match this app' })
    }

    return err({
      code: 'INVALID_TOKEN',
      message: `Invalid login token: ${(error as Error).message}`,
    })
  }
}
