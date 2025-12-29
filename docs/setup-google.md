# Complete Setup Guide for Google Integration with OAuth2 and Pub/Sub

## Step 1: Create a Google Cloud Project

1. Go to the Google Cloud Console
2. Click on "New Project"
3. Enter a project name (e.g., "MyApp-Integration")
4. Click "Create"
5. Make note of your Project ID (you'll need this later)

## Step 2: Enable Required APIs

1. In your Google Cloud Project, navigate to "APIs & Services" > "Library"
2. Search for and enable the following APIs:

- Gmail API
- Google Cloud Pub/Sub API
- People API (if you need contact information)

## Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" > "OAuth consent screen"
2. Select "External" user type (unless you're using Google Workspace)
3. Fill out the required information:

- App name
- User support email
- Developer contact information

4. For scopes, add:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.labels`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/pubsub`

5. Add test users (including your own email)
6. Complete the verification process if necessary

## Step 4: Create OAuth Credentials

1. Go to "APIs & Services" > "Credentials": `https://console.cloud.google.com/apis/credentials`
2. Click "Create Credentials" > "OAuth client ID"
3. Select "Web application"
4. Enter a name for your OAuth client
5. Add authorized JavaScript origins:

- `http://localhost:3000` (for development)
- Your production domain(s)

6. Add authorized redirect URIs:

- `http://localhost:3000/api/google/oauth/callback` (for development), where `http://localhost:3000` should be the `NEXT_PUBLIC_BASE_URL` env variable.
- `https://<production_domain>/api/google/oauth/callback` (for production)

7. Click "Create"
8. Save your Client ID and Client Secret: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

## Step 5: Set Up Service Account for Pub/Sub

1. Go to "IAM & Admin" > "Service Accounts": [https://console.cloud.google.com/iam-admin/serviceaccounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Click "Create Service Account"
3. Enter a name
4. Google will generate a Service account ID or you can modify it yourself.
5. Below the Service account ID, you will see the Email address for the account id: e.g. <service_account_id>@<google_project_id>.iam.gserviceaccount.com
6. Copy the email address and enter it in the `GOOGLE_CLIENT_EMAIL` env variable.
7. Click "Create and Continue"
8. Add the following roles: (search for exact roles, dont use `Cloud Pub/Sub` or `Pub/Sub Lite` maybe they work but not sure.)

- Pub/Sub Publisher
- Pub/Sub Subscriber
- Pub/Sub Editor

9. Click "Continue" and then "Done"
10. You will be back in the service account tab with a table of service accounts. Click on the service account Email link that you had just created.
11. Go to the "Keys" tab
12. Click "Add Key" > "Create new key"
13. Choose JSON format
14. Download the key file and open it in your code editor. Copy the `private key` and add it to the `GOOGLE_PRIVATE_KEY` env variable. Verify the other fields as well: `client_email` goes into the `GOOGLE_CLIENT_EMAIL` env variable and `project_id` should go into the `GOOGLE_PROJECT_ID` env variable. The <client_id> is not the same as the client_id we stored for `GOOGLE_CLIENT_ID` for the OAuth.

## Step 6: Create a Pub/Sub Topic

1. Go to "Pub/Sub" > "Topics": [https://console.cloud.google.com/cloudpubsub/topic/list](https://console.cloud.google.com/cloudpubsub/topic/list)
2. Click "Create Topic"
3. Enter a Topic ID (e.g., "gmail-notifications"): `GOOGLE_PUBSUB_TOPIC`
4. Below the Topic ID, you will see Topic name: projects/<project_id>/topics/<topic_id>: the <project_id> should match the `GOOGLE_PROJECT_ID`, that you added in the last step.
5. Leave defaults for the rest
6. Click "Create"

## Step 7: Create a Pub/Sub Subscription

1. Go to "Pub/Sub" > "Subscriptions". Or click on the topic that you had just created and go to the subscription tab.
2. Click "Create Subscription"
3. Name your subscription (e.g., "gmail-notifications-sub"). Naming convention is `<topic_id>-sub`. This goes into the `GOOGLE_PUBSUB_SUBSCRIPTION` env variable.
4. Select the topic you created earlier
5. For delivery type, select "Push"
6. Enter your push endpoint URL (e.g., https://yourdomain.com/api/google/push-notification).
   - WARNING: This can't be a localhost address as before for oauth. Use the ngrok address (See below for setup)
   - URL: `<ngrok_url>/api/google/webhook`
7. For authentication, select "Add service account"
8. Choose the service account you created earlier
9. Leave rest as is and Click "Create"

## Addendum: Install ngrok

1. Install ngrok: `brew install ngrok` or `choco install ngrok`
2. Sign up for ngrok account: https://dashboard.ngrok.com/.
3. Copy your `authtoken`
4. Run `ngrok config add-authtoken <TOKEN>`
5. Run `ngrok http http://localhost:3000`
6. Write down the ngrok address that it gave you and add to env `NGROK_URL`
7. Now when developing, add a terminal window on run `./ngrok.sh` from the app root.
8.
