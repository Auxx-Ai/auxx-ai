// packages/credentials/src/login-token/issue-login-token.ts

import { randomUUID } from 'node:crypto'
import { importPKCS8, SignJWT } from 'jose'
import { err, ok, type Result } from 'neverthrow'
import { configService } from '../config'
import type { IssueLoginTokenOptions, IssueLoginTokenResult, LoginTokenError } from './types'

const DEFAULT_EXPIRY = '10m'

/**
 * Issue a cross-app login token signed with Ed25519.
 * Only call this from apps/web — requires the private key.
 */
export async function issueLoginToken(
  options: IssueLoginTokenOptions
): Promise<Result<IssueLoginTokenResult, LoginTokenError>> {
  const {
    userId,
    email,
    targetOrigin,
    issuerOrigin,
    returnTo,
    expiresIn = DEFAULT_EXPIRY,
  } = options

  // No fallback — fail fast if private key is not configured
  const privateKeyPem = configService.get<string>('LOGIN_TOKEN_PRIVATE_KEY')
  if (!privateKeyPem) {
    return err({ code: 'MISSING_PRIVATE_KEY', message: 'LOGIN_TOKEN_PRIVATE_KEY not configured' })
  }

  try {
    const privateKey = await importPKCS8(privateKeyPem.replace(/\\n/g, '\n'), 'EdDSA')
    const jti = randomUUID()

    const token = await new SignJWT({
      email,
      returnTo,
      type: 'login_token',
    } as Record<string, unknown>)
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(userId)
      .setAudience(targetOrigin)
      .setIssuer(issuerOrigin)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey)

    return ok({ token, jti, expiresIn })
  } catch (error) {
    return err({
      code: 'INVALID_TOKEN',
      message: `Failed to issue login token: ${(error as Error).message}`,
    })
  }
}
