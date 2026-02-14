import { env } from '@auxx/config/server'
import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('api-playground')

export async function GET() {
  // const session = await auth()
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    return NextResponse.json({ status: 401 })
  }
  const result = {}

  return NextResponse.json({ result }, { status: 200 })
  // } catch (error) {
  //   console.error('error occured', error)
  //   return NextResponse.json({ status: 400 })
  // }
}
