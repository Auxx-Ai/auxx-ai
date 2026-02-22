// ~/app/api/chat/bundle.js/route.ts
import { NextResponse } from 'next/server'

/**
 * Serves the bundled widget JavaScript file content.
 * This version uses Pusher instead of Socket.io for real-time communication.
 */
export async function GET() {
  try {
    // Define the widget's JavaScript content as a string literal.
    const scriptContent = `
(function(window) {
    // Ensure React and ReactDOM are available
    if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
        console.error('AuxxChat Error: React or ReactDOM not found. Load them before this script.');
        return;
    }

    console.log('[AuxxChat Bundle] Executing...');

    const AuxxChat = {
        init: function(config) {
            console.log('[AuxxChat init] Received config:', config);
            // Default API paths (can be overridden via config)
            const baseTrpcUrl = config.trpcBaseUrl || window.location.origin + '/api/trpc'; // Use origin or config
            const initEndpoint = config.initEndpoint || \`\${baseTrpcUrl}/chat.initialize\`;
            const sendMessageEndpoint = config.sendMessageEndpoint || \`\${baseTrpcUrl}/chat.sendMessage\`; 
            
            // Pusher config
            const pusherKey = config.pusherKey;
            const pusherCluster = config.pusherCluster || 'us3';

            // Find or create root element
            let container = document.getElementById('auxx-chat-widget-container');
            if (!container) {
                console.warn('[AuxxChat init] Container #auxx-chat-widget-container not found. Creating one.');
                container = document.createElement('div');
                container.id = 'auxx-chat-widget-container';
                document.body.appendChild(container);
            }
            const rootElementId = 'auxx-chat-widget-root-' + (config.widgetId || 'preview'); // Use widgetId from config
            console.log('[AuxxChat init] Root element ID:', config.widgetId);
            let root = document.getElementById(rootElementId);
             if (!root) {
                 root = document.createElement('div');
                 root.id = rootElementId;
                 container.appendChild(root);
             } else {
                  console.warn('[AuxxChat init] Root element already exists:', rootElementId);
             }


            // --- React Component ---
            class ChatWidget extends React.Component {
                constructor(props) {
                    super(props);
                    this.state = {
                        isOpen: props.config.autoOpen || false,
                        messages: [],
                        inputText: '',
                        sessionId: null,
                        threadId: null,
                        visitorId: localStorage.getItem('auxx_visitor_id'),
                        isConnecting: false,
                        connectionError: null,
                        isSending: false,
                        isAgentTyping: false,
                    };
                    this.pusher = null;
                    this.channel = null;
                    this.messageListRef = React.createRef();

                    this.toggleChat = this.toggleChat.bind(this);
                    this.handleInputChange = this.handleInputChange.bind(this);
                    this.handleSendMessage = this.handleSendMessage.bind(this);
                    this.handleFetchError = this.handleFetchError.bind(this);
                    this.setupPusher = this.setupPusher.bind(this);
                    this.scrollToBottom = this.scrollToBottom.bind(this);
                }

                 handleFetchError(operation, error, response = null) {
                     console.error(\`[AuxxChat] Error during \${operation}:\`, error);
                     let errorMessage = \`Failed to \${operation}.\`;
                     if (response && response.status) {
                         errorMessage += \` Status: \${response.status}\`;
                     } else if (error instanceof TypeError && error.message.includes('fetch')) {
                         errorMessage += ' Network error or CORS issue.';
                     } else if (error.message) {
                          errorMessage += \` \${error.message}\`
                     }
                     this.setState({ connectionError: errorMessage, isConnecting: false, isSending: false });
                }

                 scrollToBottom(behavior = 'smooth') {
                     const node = this.messageListRef.current;
                    if (node) {
                         setTimeout(() => { // Timeout allows DOM to update
                             if (node) {
                                 node.scrollTo({ top: node.scrollHeight, behavior: behavior });
                             }
                         }, 50);
                    }
                 }

                componentDidMount() {
                    const { config } = this.props;
                     if (!this.state.sessionId && !this.state.isConnecting) { // Prevent re-init if already connecting/connected
                         this.setState({ isConnecting: true, connectionError: null });
                         console.log(\`[AuxxChat componentDidMount] Initializing session via: \${initEndpoint}\`);
                        
                        // Explicitly constructing payload to match server schema
                        console.log('[AuxxChat componentDidMount] Initializing with widget ID:', config.widgetId);

                        // FIXED TRPC REQUEST FORMAT
                        fetch(initEndpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                             },
                             // Correct format for tRPC v11 with Next.js 15
                             body: JSON.stringify({
                                 json: {
                                     integrationId: config.widgetId,
                                     url: window.location.href,
                                     referrer: document.referrer || '',
                                     visitorId: this.state.visitorId || undefined, // Send undefined if null
                                     userAgent: navigator.userAgent,
                                     // Add these if needed by your schema
                                     visitorName: undefined,
                                     visitorEmail: undefined
                                 }
                             })
                          })
                         .then(response => {
                              if (!response.ok) {
                                  return response.text().then(text => { 
                                      console.error('[AuxxChat] Server response:', text);
                                      throw new Error(\`HTTP error! Status: \${response.status} - \${text || response.statusText}\`); 
                                  });
                              }
                              const contentType = response.headers.get("content-type");
                              if (!(contentType && contentType.includes("application/json"))) {
                                   return response.text().then(text => { 
                                       console.error('[AuxxChat] Non-JSON response:', text);
                                       throw new Error(\`Received non-JSON response: \${text}\`); 
                                   });
                              }
                              return response.json();
                          })
                         .then(data => {
                              console.log('[AuxxChat] Raw response data:', data);
                              
                              // Handle the nested structure in the response
                              // The actual data is in data.result.data.json based on your response
                              const responseData = data?.result?.data?.json;
                              
                              // Debug the response structure
                              console.log('[AuxxChat] Response structure:', {
                                  hasResult: !!data?.result,
                                  hasData: !!data?.result?.data,
                                  hasJsonData: !!data?.result?.data?.json,
                                  responseData
                              });
                              
                              // Check if we have the required fields in the response
                              if (!responseData || !responseData.sessionId || !responseData.threadId) { 
                                  console.error('[AuxxChat] Invalid response structure:', data);
                                  throw new Error('Invalid initialization response.'); 
                              }
                              console.log('[AuxxChat init] Success:', responseData);
                              
                              // Set initial welcome message if configured
                              let initialMessages = [];
                              if (config.welcomeMessage) {
                                  initialMessages.push({ 
                                      id: 'welcome-' + Date.now(), 
                                      content: config.welcomeMessage, 
                                      sender: 'SYSTEM', 
                                      timestamp: new Date() 
                                  });
                              }
                              
                              // If we got a welcome message ID from server, mark it
                              if (responseData.welcomeMessageId) {
                                  console.log('[AuxxChat] Server provided welcome message ID:', responseData.welcomeMessageId);
                              }
                              
                              this.setState({
                                 sessionId: responseData.sessionId,
                                 threadId: responseData.threadId,
                                 visitorId: responseData.visitorId,
                                 isConnecting: false,
                                 messages: initialMessages,
                              }, () => {
                                 if (responseData.visitorId) { localStorage.setItem('auxx_visitor_id', responseData.visitorId); }
                                 
                                 // Setup Pusher with a slight delay to ensure state is updated
                                 setTimeout(() => {
                                     console.log('[AuxxChat] Setting up Pusher after successful initialization');
                                     this.setupPusher();
                                     this.scrollToBottom('auto');
                                 }, 100);
                              });
                         })
                         .catch(error => { 
                             console.error('[AuxxChat] Initialization error:', error);
                             this.handleFetchError('chat initialization', error); 
                         });
                    } else {
                         console.log('[AuxxChat componentDidMount] Already connecting or session exists. Attempting Pusher setup.');
                         if(this.state.sessionId && this.state.threadId){ this.setupPusher();}
                    }
                }

                componentDidUpdate(prevProps, prevState) {
                    if (prevState.messages.length < this.state.messages.length) {
                        this.scrollToBottom();
                    }
                 }

                componentWillUnmount() {
                     if (this.channel) { 
                         this.channel.unbind_all();
                         this.channel.unsubscribe();
                     }
                     if (this.pusher) {
                         this.pusher.disconnect();
                     }
                }

                setupPusher() {
                    if (!this.state.sessionId || !this.state.threadId) { 
                        console.warn('[AuxxChat setupPusher] Missing sessionId or threadId, cannot setup Pusher');
                        return; 
                    }
                    
                    if (typeof window.Pusher === 'undefined') {
                        console.error('[AuxxChat setupPusher] Pusher library not loaded');
                        this.setState({ 
                            connectionError: 'Real-time updates not available - Pusher library missing'
                        });
                        return;
                    }
                    
                    try {
                        const { config } = this.props;
                        const pusherAppKey = pusherKey || config.pusherKey;
                        
                        if (!pusherAppKey) {
                            console.error('[AuxxChat setupPusher] Missing Pusher key');
                            this.setState({ 
                                connectionError: 'Real-time updates not available - missing configuration'
                            });
                            return;
                        }
                        
                        console.log('[AuxxChat setupPusher] Initializing Pusher');
                        
                        // Create Pusher instance
                        this.pusher = new window.Pusher(pusherAppKey, {
                            cluster: pusherCluster || config.pusherCluster,
                            authEndpoint: '/api/pusher/auth',
                            forceTLS: true
                        });
                        
                        // Subscribe to a private channel for this chat session
                        const channelName = \`private-chat-\${this.state.sessionId}\`;
                        this.channel = this.pusher.subscribe(channelName);
                        
                        // Connection status events
                        this.pusher.connection.bind('connected', () => {
                            console.log('[AuxxChat Pusher] Connected');
                            this.setState({ connectionError: null });
                        });
                        
                        this.pusher.connection.bind('error', (err) => {
                            console.error('[AuxxChat Pusher] Connection error:', err);
                            this.setState({ 
                                connectionError: 'Connection error: ' + (err.message || 'Unknown error')
                            });
                        });
                        
                        // Listen for new messages
                        this.channel.bind('new-message', (data) => {
                            console.log('[AuxxChat Pusher] Received message:', data);
                            if (!this.state.messages.some(m => m.id === data.id)) {
                                this.setState(prevState => ({
                                    messages: [...prevState.messages, {
                                        ...data,
                                        timestamp: new Date(data.timestamp || Date.now())
                                    }]
                                }));
                            }
                        });
                        
                        // Listen for typing indicators
                        this.channel.bind('typing', (data) => {
                            if (data.sender === 'agent') {
                                this.setState({ isAgentTyping: data.isTyping });
                            }
                        });
                        
                        // Listen for message confirmations
                        this.channel.bind('message-sent', (data) => {
                            console.log('[AuxxChat Pusher] Message sent confirmation:', data);
                            if (data.clientMessageId) {
                                this.setState(prevState => ({
                                    messages: prevState.messages.map(msg => 
                                        msg.id === data.clientMessageId ? 
                                        { ...msg, id: data.messageId || msg.id, status: 'sent' } : 
                                        msg
                                    )
                                }));
                            }
                        });
                        
                        // Subscribe error
                        this.channel.bind('pusher:subscription_error', (error) => {
                            console.error('[AuxxChat Pusher] Subscription error:', error);
                            this.setState({ 
                                connectionError: 'Failed to subscribe to updates channel' 
                            });
                        });
                        
                        console.log('[AuxxChat setupPusher] Pusher initialized and subscribed to', channelName);
                    } catch (error) {
                        console.error('[AuxxChat setupPusher] Error setting up Pusher:', error);
                        this.setState({ 
                            connectionError: 'Failed to connect to real-time service: ' + error.message 
                        });
                    }
                }

                toggleChat() { this.setState(prevState => ({ isOpen: !prevState.isOpen })); }
                handleInputChange(event) { this.setState({ inputText: event.target.value }); }

                handleSendMessage() {
                    const content = this.state.inputText.trim();
                    if (!content || !this.state.sessionId || !this.state.threadId || this.state.isSending) return;
                    this.setState({ isSending: true });

                    const clientMessageId = 'client-' + Date.now();
                    const userMessage = {
                         id: clientMessageId, content: content, sender: 'user',
                         timestamp: new Date(), status: 'sending'
                     };
                    this.setState(prevState => ({ messages: [...prevState.messages, userMessage], inputText: '' }));
                    this.scrollToBottom();

                    // Send message via API
                    fetch(sendMessageEndpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({
                            json: {
                                sessionId: this.state.sessionId,
                                content: content,
                                clientMessageId: clientMessageId
                            }
                        })
                    })
                    .then(response => {
                        if (!response.ok) {
                            return response.text().then(text => {
                                console.error('[AuxxChat] Send message response:', text);
                                throw new Error(\`HTTP error! Status: \${response.status} - \${text || response.statusText}\`);
                            });
                        }
                        return response.json();
                    })
                    .then(data => {
                        console.log('[AuxxChat] Send message response:', data);
                        const responseData = data?.result?.data?.json || data?.result?.data;
                        
                        // Update message status to sent
                        this.setState(prevState => ({
                            isSending: false,
                            messages: prevState.messages.map(msg => 
                                msg.id === clientMessageId ? 
                                { ...msg, id: responseData?.messageId || msg.id, status: 'sent' } : 
                                msg
                            )
                        }));
                    })
                    .catch(error => {
                        console.error('[AuxxChat] Error sending message:', error);
                        this.setState(prevState => ({ 
                            isSending: false, 
                            messages: prevState.messages.map(msg => 
                                msg.id === clientMessageId ? 
                                { ...msg, status: 'error' } : 
                                msg
                            ),
                            connectionError: 'Failed to send message: ' + error.message
                        }));
                    });
                }

                render() {
                    const { config } = this.props;
                    const { isOpen, messages, inputText, isConnecting, connectionError, isSending, isAgentTyping } = this.state;
                    const primaryColor = config.primaryColor || '#4F46E5';
                    const position = config.position || 'bottom-right'; // Default position
console.log('[AuxxChat] Rendering with position:', position);
                    // Style object generation
                    const positionStyles = {
                        'bottom_right': { bottom: '20px', right: '20px' },
                        'bottom_left': { bottom: '20px', left: '20px' },
                        'top_right': { top: '20px', right: '20px' },
                        'top_left': { top: '20px', left: '20px' }
                    }[position];

                    // --- Chat Button ---
                    const chatButton = !isOpen && React.createElement('button', {
                        key: 'chat-button',
                        className: 'auxx-chat-button',
                        onClick: this.toggleChat,
                        style: { backgroundColor: primaryColor, position: 'fixed', zIndex: 9998, ...positionStyles },
                        'aria-label': 'Open Chat'
                    }, '💬');

                    // --- Chat Window ---
                    let chatWindow = null;
                    if (isOpen) {
                         const isMobile = window.innerWidth < 640;
                         const chatWindowClasses = \`auxx-chat-window \${isMobile && config.mobileFullScreen ? 'auxx-chat-fullscreen' : ''}\`;
                            console.log('[AuxxChat] Rendering chat window with classes:', positionStyles);
                         chatWindow = React.createElement('div', {
                             key: 'chat-window', className: chatWindowClasses,
                             style: { position: 'fixed', zIndex: 9999, ...positionStyles }
                         }, [
                             // Header
                             React.createElement('div', { key:'header', className: 'auxx-chat-header', style: { backgroundColor: primaryColor } }, [
                                 React.createElement('div', { className: 'auxx-chat-header-content' }, [
                                     config.logoUrl && React.createElement('img', { key: 'logo', src: config.logoUrl, alt: 'Logo', className: 'auxx-chat-logo' }),
                                     React.createElement('div', { key:'titles'}, [
                                          React.createElement('h3', { className: 'auxx-chat-title' }, config.title || 'Chat'),
                                          config.subtitle && React.createElement('p', { className: 'auxx-chat-subtitle' }, config.subtitle)
                                     ])
                                 ]),
                                 React.createElement('button', { key:'close', className: 'auxx-chat-close', onClick: this.toggleChat, 'aria-label': 'Close Chat' }, 'X')
                             ]),
                             // Messages Area
                             React.createElement('div', { key:'messages', className: 'auxx-chat-messages', ref: this.messageListRef },
                                 isConnecting ? React.createElement('div', { className: 'auxx-chat-info' }, 'Connecting...')
                                 : connectionError ? React.createElement('div', { className: 'auxx-chat-info auxx-chat-error' }, \`Error: \${connectionError}\`)
                                 : messages.map(message =>
                                      React.createElement('div', { key: message.id, className: \`auxx-chat-message auxx-chat-message-\${message.sender?.toLowerCase() || 'system'}\` }, [
                                          React.createElement('div', { className: 'auxx-chat-message-content' }, message.content),
                                          // Optionally display time/status
                                          // React.createElement('div', { className: 'auxx-chat-message-time' }, ...)
                                      ])
                                 ),
                                 isAgentTyping && React.createElement('div', { key: 'typing', className: 'auxx-chat-message auxx-chat-message-agent auxx-chat-message-typing' },
                                     React.createElement('div', { className: 'auxx-chat-message-content' }, '...')
                                 )
                             ),
                             // Input Area
                             React.createElement('div', { key:'input', className: 'auxx-chat-input-area' }, [
                                 React.createElement('input', {
                                     type: 'text', className: 'auxx-chat-input', placeholder: 'Type your message...',
                                     value: inputText, onChange: this.handleInputChange,
                                     onKeyPress: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.handleSendMessage(); } }, // Prevent default form submit on Enter
                                     disabled: isConnecting || !!connectionError
                                 }),
                                 React.createElement('button', {
                                     className: 'auxx-chat-send', onClick: this.handleSendMessage,
                                     style: { backgroundColor: primaryColor },
                                     disabled: !inputText.trim() || isSending || isConnecting || !!connectionError
                                 }, isSending ? '...' : 'Send')
                             ])
                         ]);
                    }

                    return React.createElement(React.Fragment, null, [ chatButton, chatWindow ]);
                }
            } // End of ChatWidget Component

            // Render the widget
            try {
                const reactRoot = ReactDOM.createRoot(root);
                reactRoot.render(React.createElement(ChatWidget, { config }));
                console.log('[AuxxChat init] React component rendered.');
            } catch (e) {
                console.error('[AuxxChat init] Error rendering React component:', e);
                root.innerHTML = '<p style="color:red; font-family: sans-serif; padding: 10px;">Error rendering chat widget.</p>';
            }
        } // End of init function
    }; // End of AuxxChat object

    window.AuxxChat = AuxxChat;
    console.log('[AuxxChat Bundle] AuxxChat object exposed to window.');

})(window);
    `

    // Serve the script content
    return new NextResponse(scriptContent, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8', // Ensure correct content type
        // Caching strategy: Short cache during development, longer in production
        'Cache-Control': 'no-cache, no-store, must-revalidate', // Prevent caching during dev
        // 'Cache-Control': 'public, max-age=3600, s-maxage=3600', // Example: Cache for 1 hour in prod
      },
    })
  } catch (error) {
    console.error('Error serving bundle.js:', error)
    // Return a simple error message in the response body for easier debugging
    const errorScript = `console.error("Failed to serve AuxxChat bundle:", ${JSON.stringify(error instanceof Error ? error.message : String(error))});`
    return new NextResponse(errorScript, {
      status: 500,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    })
  }
}
