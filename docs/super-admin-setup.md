# Super Admin Setup Guide

This guide explains how to configure a super admin user when deploying to AWS via SST.

## Overview

The super admin functionality automatically promotes a user to super admin status during the signup/seeding process based on their email address. This is controlled by the `SUPER_ADMIN_EMAIL` environment variable.

## How It Works

1. When a new user signs up, the `seedNewUserDatabase` function is called
2. The function checks if the user's email matches the `SUPER_ADMIN_EMAIL` environment variable
3. If there's a match, the user is automatically promoted to super admin via the `SuperAdminService`
4. The promotion is logged for audit purposes

## Setup Instructions

### 1. Set the Secret in AWS SSM Parameter Store

You need to set the `SUPER_ADMIN_EMAIL` secret in AWS SSM Parameter Store for your SST stage.

```bash
# For production stage
npx sst secret set SUPER_ADMIN_EMAIL "your-email@example.com" --stage production

# For development stage
npx sst secret set SUPER_ADMIN_EMAIL "your-email@example.com" --stage dev
```

### 2. Deploy Your Application

After setting the secret, deploy your application:

```bash
# Deploy to production
npx sst deploy --stage production

# Deploy to development
npx sst deploy --stage dev
```

### 3. Sign Up with the Configured Email

Sign up for a new account using the email address you configured in `SUPER_ADMIN_EMAIL`. The system will:
- Create your user account
- Set up your default organization
- **Automatically promote you to super admin**

## Verifying Super Admin Status

You can verify that a user has been promoted to super admin by:

1. **Checking the database**:
   ```sql
   SELECT id, email, "isSuperAdmin" FROM "User" WHERE email = 'your-email@example.com';
   ```

2. **Checking the logs** (in CloudWatch):
   - Look for: `"Promoting user to super admin based on SUPER_ADMIN_EMAIL"`
   - Look for: `"Successfully promoted user to super admin"`

3. **Accessing admin features**:
   - Navigate to `/admin` in your application
   - Super admins should have access to admin-only features

## Important Notes

- **Case Insensitive**: Email matching is case-insensitive
- **Automatic Only on Signup**: The promotion only happens during the initial user seeding process
- **Existing Users**: If you need to promote an existing user, use the `SuperAdminService` directly or update the database
- **Security**: Keep the `SUPER_ADMIN_EMAIL` secret secure and only accessible to authorized personnel

## Manual Promotion (For Existing Users)

If you need to promote an existing user to super admin, you can use the SuperAdminService:

### Option 1: Via Script

Create a script `scripts/promote-super-admin.ts`:

```typescript
import { SuperAdminService } from '@auxx/lib/admin'

async function main() {
  const email = process.argv[2]

  if (!email) {
    console.error('Please provide an email address')
    process.exit(1)
  }

  const service = new SuperAdminService()
  const success = await service.promoteUserToSuperAdmin(email)

  if (success) {
    console.log(`Successfully promoted ${email} to super admin`)
  } else {
    console.error(`Failed to promote ${email}`)
  }
}

main()
```

Run it:
```bash
npx tsx scripts/promote-super-admin.ts "user@example.com"
```

### Option 2: Direct Database Update

```sql
UPDATE "User"
SET "isSuperAdmin" = true, "updatedAt" = NOW()
WHERE email = 'user@example.com';
```

## Demoting a Super Admin

To remove super admin privileges:

```typescript
import { SuperAdminService } from '@auxx/lib/admin'

const service = new SuperAdminService()
await service.demoteUserFromSuperAdmin('user@example.com')
```

## Troubleshooting

### User Not Being Promoted

1. **Check the secret is set**:
   ```bash
   npx sst secret list --stage production
   ```

2. **Verify environment variable is available**:
   - Check CloudWatch logs for the Lambda function
   - Look for the environment variable in the Lambda configuration

3. **Check email match**:
   - Ensure the email in `SUPER_ADMIN_EMAIL` exactly matches the signup email
   - Remember: matching is case-insensitive

### Logs to Check

In CloudWatch, look for these log messages:
- `"Promoting user to super admin based on SUPER_ADMIN_EMAIL"`
- `"Successfully promoted user to super admin"`
- `"Failed to promote user to super admin during seeding"` (if there's an error)

## Related Files

- `packages/lib/src/admin/super-admin-service.ts` - Super admin service implementation
- `packages/lib/src/seed/new-user.ts` - User seeding logic with super admin promotion
- `infra/secrets.ts` - SST secret configuration
- `packages/database/src/db/schema/user.ts` - User schema with `isSuperAdmin` field
