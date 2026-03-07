# Setup Guide for Facebook Messenger Integration

## Prerequisites

- A Facebook account
- A Facebook Page (the integration connects to a Page, not a personal profile)

## Step 1: Create a Facebook App

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click **My Apps** in the top-right corner
3. Click **Create App**
4. Select **Other** as the use case, then click **Next**
5. Select **Business** as the app type, then click **Next**
6. Enter an app name (e.g., "Auxx AI Support")
7. Enter a contact email
8. Optionally select a Business Portfolio, then click **Create App**

## Step 2: Get App ID and App Secret

1. In your app dashboard, go to **App Settings** > **Basic**
2. Copy the **App ID** — this is your `FACEBOOK_APP_ID`
3. Click **Show** next to the App Secret field, enter your password
4. Copy the **App Secret** — this is your `FACEBOOK_APP_SECRET`

## Step 3: Add Messenger Product

1. In the left sidebar, click **Add Product**
2. Find **Messenger** and click **Set Up**
3. This adds the Messenger product to your app

## Step 4: Configure OAuth Redirect URI

1. In the left sidebar, go to **Facebook Login** > **Settings** (if Facebook Login was auto-added) or add the **Facebook Login** product first
2. Under **Valid OAuth Redirect URIs**, add:

```
https://app.auxx.ai/api/facebook/oauth2/callback
```

3. Click **Save Changes**

## Step 5: Configure Webhook

1. In the left sidebar, go to **Messenger** > **Messenger API Settings**
2. Scroll to the **Webhooks** section and click **Add Callback URL**
3. Enter the following:
   - **Callback URL**: `https://app.auxx.ai/api/facebook/webhook`
   - **Verify Token**: A random string you generate (see step below)
4. Click **Verify and Save**

### Generate the Verify Token

Generate a random token to use as `FACEBOOK_WEBHOOK_VERIFY_TOKEN`:

```bash
openssl rand -hex 32
```

Set this value in your environment/secrets, and use the same value in the webhook **Verify Token** field above.

## Step 6: Subscribe to Webhook Events

1. After verifying the webhook, you need to subscribe your Page to events
2. In the **Webhooks** section, click **Add Subscriptions**
3. Select the following fields:
   - `messages` — Receive incoming messages
   - `messaging_postbacks` — Receive postback button clicks
   - `message_deliveries` — Delivery confirmations
   - `message_reads` — Read receipts

## Step 7: Connect Your Page

1. In the **Webhooks** section, under **Page Subscriptions**, select the Facebook Page you want to connect
2. Click **Subscribe** to link the page to your app
3. This step is also handled automatically during the OAuth flow in the app

## Step 8: Configure App Permissions

1. Go to **App Review** > **Permissions and Features**
2. Request the following permissions:
   - `pages_messaging` — Send and receive messages
   - `pages_manage_metadata` — Subscribe to webhooks
   - `pages_read_engagement` — Read messages and conversations

> **Note:** For development/testing, these permissions work immediately for app admins and testers. For production use with external users, you need to submit for App Review.

## Step 9: Set Environment Variables

Set the following environment variables in your app:

| Variable                         | Value                                        |
| -------------------------------- | -------------------------------------------- |
| `FACEBOOK_APP_ID`                | App ID from Step 2                           |
| `FACEBOOK_APP_SECRET`            | App Secret from Step 2                       |
| `FACEBOOK_GRAPH_API_VERSION`     | `v19.0` (default, already set)               |
| `FACEBOOK_WEBHOOK_VERIFY_TOKEN`  | Random string from Step 5                    |

## Step 10: Switch to Live Mode

1. At the top of your app dashboard, toggle the app mode from **Development** to **Live**
2. You may need to complete a few requirements:
   - Add a Privacy Policy URL in **App Settings** > **Basic**
   - Complete any required App Review submissions

## Troubleshooting

- **Webhook verification fails:** Ensure the verify token in Meta Developer Console matches your `FACEBOOK_WEBHOOK_VERIFY_TOKEN` env variable exactly, and that the webhook endpoint is publicly accessible.
- **Not receiving messages:** Check that the Page is subscribed to the webhook events and that the app is in Live mode for non-admin users.
- **Token errors:** Facebook Page Access Tokens obtained via the OAuth flow are long-lived but can still be invalidated if the user removes the app from their Page settings.
