// packages/credentials/src/login-token/types.ts

/** Login token JWT payload */
export interface LoginTokenPayload {
  /** User ID */
  sub: string
  /** User email */
  email: string
  /** Target app origin (e.g. https://build.auxx.ai) — satellite must reject if mismatched */
  aud: string
  /** Issuing app origin (e.g. https://app.auxx.ai) */
  iss: string
  /** Unique token ID for replay protection */
  jti: string
  /** Path to redirect to after exchange */
  returnTo: string
  /** Token type discriminator */
  type: 'login_token'
  /** Issued at (set by jose) */
  iat: number
  /** Expiration (set by jose) */
  exp: number
}

export interface IssueLoginTokenOptions {
  userId: string
  email: string
  /** Full origin of the target satellite app */
  targetOrigin: string
  /** Issuer origin (apps/web URL) */
  issuerOrigin: string
  /** Relative path to redirect to after exchange */
  returnTo: string
  /** Override expiry (default: '10m') */
  expiresIn?: string
}

export interface IssueLoginTokenResult {
  token: string
  jti: string
  expiresIn: string
}

export interface VerifiedLoginToken {
  userId: string
  email: string
  targetOrigin: string
  issuerOrigin: string
  returnTo: string
  jti: string
}

export type LoginTokenError =
  | { code: 'INVALID_TOKEN'; message: string }
  | { code: 'TOKEN_EXPIRED'; message: string }
  | { code: 'AUDIENCE_MISMATCH'; message: string }
  | { code: 'MISSING_PRIVATE_KEY'; message: string }
  | { code: 'MISSING_PUBLIC_KEY'; message: string }
