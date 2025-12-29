import { z } from 'zod'
import { getUserConnection, getOrganizationConnection } from '@auxx/sdk/server'

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  username: z.string(),
  email: z.string(),
  address: z.object({
    street: z.string(),
    suite: z.string(),
    city: z.string(),
    zipcode: z.string(),
    geo: z.object({
      lat: z.string(),
      lng: z.string(),
    }),
  }),
  phone: z.string(),
  website: z.string(),
  company: z.object({
    name: z.string(),
    catchPhrase: z.string(),
    bs: z.string(),
  }),
})
export type User = z.infer<typeof userSchema>

export default async function getUser(recordId: string): Promise<User> {
  console.log('From the server logging - recordId:', recordId)

  // Test: Try to get user connection
  const userConnection = getUserConnection()
  if (userConnection) {
    console.log('✅ User connection found:', {
      id: userConnection.id,
      type: userConnection.type,
      hasValue: !!userConnection.value,
      valuePreview: userConnection.value.substring(0, 10) + '***', // Show first 10 chars only
      metadata: userConnection.metadata,
      expiresAt: userConnection.expiresAt,
    })
  }

  // Test: Try to get organization connection
  const orgConnection = getOrganizationConnection()
  if (orgConnection) {
    console.log('✅ Organization connection found:', {
      id: orgConnection.id,
      type: orgConnection.type,
      hasValue: !!orgConnection.value,
      valuePreview: orgConnection.value.substring(0, 10) + '***', // Show first 10 chars only
      metadata: orgConnection.metadata,
      expiresAt: orgConnection.expiresAt,
    })
  }

  // We don't really need the recordId for this API, but this is how we could use a parameter
  const response = await fetch(`https://jsonplaceholder.typicode.com/users/1`)
  const data = await response.json()
  return userSchema.parse(data)
}
