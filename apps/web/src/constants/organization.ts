import { z } from 'zod'

export const organiationSchema = z.object({
  name: z.string().min(2, {
    error: 'Name of your organization.',
  }),
  website: z.url().min(2, {
    error: 'Website is required',
  }),
  email_domain: z.string().min(4, { error: 'Min 4 characters.' }),
})
