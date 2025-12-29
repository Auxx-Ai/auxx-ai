# Signing Up for Microsoft Graph API Access

## Create a Microsoft Account

1. If you don't already have one, go to [account.microsoft.com](https://account.microsoft.com) to sign up

## Sign in to the Azure Portal

1. Visit [portal.azure.com](https://portal.azure.com)
2. Sign in with your Microsoft account

## Register an Application

1. Navigate to "Azure Active Directory" in the portal
2. Go to "App registrations" and click "New registration"
3. Provide a name for your application (e.g., "MyApp Email Integration")
4. Select supported account types (typically "Accounts in any organizational directory and personal Microsoft accounts")
5. Set the redirect URI:

- Web application: `https://yourdomain.com/api/outlook/oauth2/callback`
- For testing: `http://localhost:3000/api/outlook/oauth2/callback`

- _You can add more redirect URIs later_

## Configure Authentication

1. After registration, go to "Authentication" section
2. Ensure "Access tokens" and "ID tokens" are checked
3. Save your changes

## Add API Permissions

1. Go to "API permissions" section
2. Click "Add a permission"
3. Select "Microsoft Graph"
4. Choose "Delegated permissions"
5. Add the following permissions:

- `Mail.Read`
- `Mail.ReadWrite`
- `Mail.Send`
- `MailboxSettings.Read`
- `offline_access` (for refresh tokens)

6. Click "Add permissions"

## Create a Client Secret

1. Go to "Certificates & secrets" section
2. Click "New client secret"
3. Add a description and select expiration period
4. Copy and securely store the generated secret value immediately (it won't be shown again)

## Get Your Application (Client) ID

1. Find your application's client ID on the "Overview" page
2. This is your `OUTLOOK_CLIENT_ID`
3. The secret you generated earlier is your `OUTLOOK_CLIENT_SECRET`

## Configure Redirect URIs

1. Ensure your redirect URI matches what you'll use in your application
2. For local development, you might use: `http://localhost:3000/api/outlook/oauth2/callback`

> **Note**: These credentials will need to be added to your environment variables for your application to use.
