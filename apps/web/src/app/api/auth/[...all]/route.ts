// import { handlers } from "~/server/auth";

// export const { GET, POST } = handlers;

import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '~/auth/server'

export const { POST, GET } = toNextJsHandler(auth)
