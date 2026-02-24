// apps/web/src/app/api/integrations/chat/[integrationId]/route.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

// Helper function to check domain (adjust as needed)
function isDomainAllowed(allowedDomains: string[], requestUrl?: string | null): boolean {
  if (!allowedDomains || allowedDomains.length === 0) {
    return true // No restrictions
  }
  if (!requestUrl) {
    // Allow if no referer (e.g., direct access, some privacy settings) - configurable?
    return true
  }
  try {
    const url = new URL(requestUrl)
    const domain = url.hostname
    return allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))
  } catch (e) {
    console.warn('Failed to parse request URL for domain check:', requestUrl, e)
    return false // Block if URL is invalid?
  }
}

export async function GET(request: NextRequest, { params }: { params: { integrationId: string } }) {
  const { integrationId } = params
  const referer = request.headers.get('referer') // Get referer for domain check

  if (!integrationId) {
    return new NextResponse('Missing integration ID', { status: 400 })
  }

  try {
    // Fetch the integration and its linked chat widget settings
    const [row] = await db
      .select({
        id: schema.Integration.id,
        provider: schema.Integration.provider,
        enabled: schema.Integration.enabled,
        organizationId: schema.Integration.organizationId,
        chatWidgetId: schema.ChatWidget.id,
        isActive: schema.ChatWidget.isActive,
        primaryColor: schema.ChatWidget.primaryColor,
        position: schema.ChatWidget.position,
        title: schema.ChatWidget.title,
        subtitle: schema.ChatWidget.subtitle,
        logoUrl: schema.ChatWidget.logoUrl,
        autoOpen: schema.ChatWidget.autoOpen,
        welcomeMessage: schema.ChatWidget.welcomeMessage,
        mobileFullScreen: schema.ChatWidget.mobileFullScreen,
        collectUserInfo: schema.ChatWidget.collectUserInfo,
        allowedDomains: schema.ChatWidget.allowedDomains,
      })
      .from(schema.Integration)
      .leftJoin(schema.ChatWidget, eq(schema.ChatWidget.integrationId, schema.Integration.id))
      .where(and(eq(schema.Integration.id, integrationId), eq(schema.Integration.provider, 'chat')))
      .limit(1)

    // --- Validation ---
    if (!row) {
      return new NextResponse('Chat widget integration not found', { status: 404 })
    }
    if (!row.enabled) {
      return new NextResponse('Chat widget is disabled', { status: 403 })
    }
    if (!row.chatWidgetId) {
      console.error(
        `Inconsistency: Integration ${integrationId} is chat but has no linked chatWidget record.`
      )
      return new NextResponse('Chat widget configuration not found', { status: 500 })
    }
    if (!row.isActive) {
      // Check widget-specific active flag too
      return new NextResponse('Chat widget is inactive', { status: 403 })
    }

    // Domain check using the allowedDomains from chatWidget
    if (!isDomainAllowed(row.allowedDomains || [], referer)) {
      console.warn(
        `Domain not allowed: Referer='${referer}', Allowed='${(row.allowedDomains || []).join(', ')}'`
      )
      return new NextResponse('Domain not allowed', { status: 403 })
    }

    // --- Prepare Configuration ---
    const widgetConfig = {
      integrationId: row.id, // Use integrationId now
      organizationId: row.organizationId,
      // Extract settings from integration.chatWidget
      primaryColor: row.primaryColor,
      position: (row.position || '').toLowerCase(),
      title: row.title,
      subtitle: row.subtitle,
      logoUrl: row.logoUrl,
      autoOpen: row.autoOpen,
      welcomeMessage: row.welcomeMessage,
      mobileFullScreen: row.mobileFullScreen,
      collectUserInfo: row.collectUserInfo,
      // Add other settings if needed by the client script
    }

    const appBaseUrl = WEBAPP_URL
    // Define the endpoint for chat initialization (adjust path if using a new chatRouter)
    const initializeChatEndpoint = `${appBaseUrl}/api/trpc/chat.initialize` // Example TRPC endpoint
    // Define the path for the actual widget UI bundle (if separate)
    const widgetBundleUrl = `${appBaseUrl}/widget-ui-bundle.js` // Example path

    // --- Generate Script ---
    // This script is simplified. Your actual script might load React/ReactDOM differently
    // or use a pre-built bundle.
    const script = `
      (function() {
        if (window.AuxxChatInitialized) return; // Prevent double initialization
        window.AuxxChatInitialized = true;

        var config = ${JSON.stringify(widgetConfig)};
        var initEndpoint = '${initializeChatEndpoint}';
        var bundleUrl = '${widgetBundleUrl}'; // URL for your widget's UI code

        console.log('Auxx Chat Widget Initializing with config:', config);

        function createWidgetContainer() {
            var container = document.createElement('div');
            container.id = 'auxx-chat-widget-container-' + config.integrationId; // Unique container ID
            document.body.appendChild(container);
            return container;
        }

        function loadWidgetUI(container) {
          // Example: Load a pre-built JS bundle for the widget UI
          var widgetScript = document.createElement('script');
          widgetScript.src = bundleUrl;
          widgetScript.async = true;
          widgetScript.onload = function() {
            // Assuming your bundle exposes an init function
            if (window.AuxxChatWidget && typeof window.AuxxChatWidget.init === 'function') {
              console.log('Auxx Chat Widget UI loaded, initializing...');
              window.AuxxChatWidget.init(container, config, initEndpoint); // Pass container, config, and endpoint
            } else {
              console.error('Auxx Chat Widget UI loaded, but init function not found.');
            }
          };
          widgetScript.onerror = function() {
              console.error('Failed to load Auxx Chat Widget UI bundle from:', bundleUrl);
          };
          document.body.appendChild(widgetScript);

           // Optionally load CSS here too
           var styles = document.createElement('link');
           styles.rel = 'stylesheet';
           styles.href = '${appBaseUrl}/widget-styles.css'; // Example CSS path
           document.head.appendChild(styles);
        }

        function init() {
            var container = createWidgetContainer();
            loadWidgetUI(container);
        }

        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          setTimeout(init, 0); // Use setTimeout to ensure DOM is fully ready
        } else {
          document.addEventListener('DOMContentLoaded', init);
        }
      })();
    `

    // Return the script with proper headers
    return new NextResponse(script, {
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600', // Cache for 1 hour
      },
    })
  } catch (error: any) {
    console.error('Error generating chat widget script:', error)
    return new NextResponse('Failed to generate widget script', { status: 500 })
  }
}
