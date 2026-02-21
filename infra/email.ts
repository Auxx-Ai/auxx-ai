// infra/email.ts
/// <reference path="../.sst/platform/config.d.ts" />

import { emailDomain } from './dns'

/**
 * Email configuration for Auxx.ai
 * Only provisions AWS SES when EMAIL_PROVIDER === 'ses'.
 */
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'mailgun'
const useSes = EMAIL_PROVIDER === 'ses'

export const email = useSes
  ? new sst.aws.Email('AuxxAiEmail', {
      sender: $interpolate`noreply@${emailDomain}`,
      dns: false, // We manage DNS separately via Route53
      // dmarc: $interpolate`v=DMARC1; p=none; sp=none; rua=mailto:dmarc@${emailDomain}`,
      dmarc: 'v=DMARC1; p=quarantine; adkim=s; aspf=s;',
    })
  : (undefined as any)

/**
 * Link map for functions that need SES. Empty when SES is not enabled.
 */
export const emailLink = useSes ? { Email: email } : {}
