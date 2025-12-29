import { gmail_v1 } from 'googleapis'
import { getGmailClient } from '@auxx/lib/google/client'
import { unwatchGmail, watchGmail } from '@auxx/lib/google/watch'
import { UserModel } from '@auxx/database/models'
import { captureException } from '~/utils/error'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('google/watch')
/**
 * THE DAILY CRON JOB WILL CALL THIS FOR EVERY USER THAT IS PREMIUM AND NEEDS TO REFRESH THEIR WATCH GMAIL P HUB
 */
export async function watchEmails(userId: string, gmail: gmail_v1.Gmail) {
  const res = await watchGmail(gmail)

  if (res.expiration) {
    const expirationDate = new Date(+res.expiration)
    const userModel = new UserModel()
    const res = await userModel.update(userId, { watchEmailsExpirationDate: expirationDate as any })
    if (!res.ok) throw res.error
    return expirationDate
  }
  logger.error('Error watching inbox', { userId })
}

async function unwatch(gmail: gmail_v1.Gmail) {
  logger.info('Unwatching emails')
  await unwatchGmail(gmail)
}

export async function unwatchEmails({
  userId,
  access_token,
  refresh_token,
}: {
  userId: string
  access_token: string | null
  refresh_token: string | null
}) {
  try {
    const gmail = getGmailClient({
      accessToken: access_token ?? undefined,
      refreshToken: refresh_token ?? undefined,
    })
    await unwatch(gmail)
  } catch (error) {
    if (error instanceof Error && error.message.includes('invalid_grant')) {
      logger.error('Error unwatching emails, invalid grant', { userId })
      return
    }

    logger.error('Error unwatching emails', { userId, error })
    captureException(error)
  }

  const userModel = new UserModel()
  const res = await userModel.update(userId, { watchEmailsExpirationDate: null as any })
  if (!res.ok) throw res.error
}
