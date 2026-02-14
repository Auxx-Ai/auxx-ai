import { database as db, schema } from '@auxx/database'
import { seedNewUserDatabase } from '@auxx/lib/seed'
import { eq } from 'drizzle-orm'
import { auth } from '~/auth/server'

// seedNewUserDatabase
async function main() {
  console.log('🌱 Starting database seeding...')
  // Delete existing data to avoid conflicts
  await cleanDatabase()
  // Create sample users with both email/password and OAuth accounts
  const users = await createUsers()
  // console.log(`✅ Created ${users.length} users`)
  // Create organizations for each user
  // const organizations = await createOrganizations(users)
  // console.log(`✅ Created ${organizations.length} organizations`)
  // Create organization members (users belonging to organizations)
  // await createOrganizationMembers(users, organizations)
  // console.log(`✅ Created organization memberships`)
  // Create integrations for organizations
  // await createIntegrations(organizations, users[0].id)
  // console.log(`✅ Created integrations`)
  // console.log('✨ Seeding complete!')
}
/**
 * Cleans database by deleting existing records to avoid conflicts
 */
async function cleanDatabase() {
  console.log('🧹 Cleaning database...')
  // Delete in correct order to respect foreign key constraints
  await db.delete(schema.account)
  await db.delete(schema.session)
  await db.delete(schema.Integration)
  await db.delete(schema.OrganizationMember)
  // Delete TicketSequence records before Organization records
  await db.delete(schema.Organization)
  await db.delete(schema.User)
}
/**
 * Creates sample users with authentication credentials
 * @returns Array of created user objects
 */
async function createUsers() {
  console.log('👤 Creating users...')
  // Simple password hashing function
  // const hashPassword = async (password) => {
  //   return bcrypt.hash(password, 10)
  // }
  // seedNewUserDatabase
  // Create main user with email/password
  // const mainUser = await db.user.create({
  //   data: {
  //     name: 'Mark Test',
  //     email: 'm4rkuskk@gmail.com',
  //     emailVerified: true,
  //     completedOnboarding: true,
  //     lastActiveAt: new Date(),
  //     image: 'https://ui-avatars.com/api/?name=Mark+Test&background=4f46e5&color=fff',
  //   },
  // })
  try {
    await auth.api.signUpEmail({
      returnHeaders: true,
      body: {
        email: 'm4rkuskk@gmail.com',
        password: 'Klooth1234',
        name: 'Markus Klooth',
        completedOnboarding: false,
      },
    })
  } catch (error) {
    // console.error('Error creating user:', error)
  }
  const [mainUser] = await db
    .select()
    .from(schema.User)
    .where(eq(schema.User.email, 'm4rkuskk@gmail.com'))
    .limit(1)
  if (!mainUser) {
    throw new Error('Main user not found after creation')
  }
  await seedNewUserDatabase(mainUser)
  console.log('User created successfully')
}

// Execute the main function
main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e)
    process.exit(1)
  })
  .finally(async () => {
    // Close database connection if needed
    // Drizzle handles connection pooling automatically
  })
