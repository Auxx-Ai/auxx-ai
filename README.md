<p align="center" style="margin-top: 20px">
  <p align="center">
  The Open Source Front / Attio meets N8N Alternative.
  <br>
    <a href="https://auxx.ai"><strong>Learn more »</strong></a>
    <br />
    <br />
    ·
    <a href="https://auxx.ai">Website</a>
    ·
    <a href="https://github.com/auxxai/auxx-ai/issues">Issues</a>
  </p>
</p>

An open-source AI-powered email support ticket service for Shopify businesses. Integrates with Gmail and Outlook to provide automated customer support with workflow automation.

## Features

- AI-powered automated response generation (OpenAI, Anthropic, Google, Groq)
- Gmail & Outlook email integration
- Shopify integration for customer context
- Workflow automation engine
- Knowledge base for AI context
- Real-time notifications
- Multi-tenant organization support
- Comprehensive ticket management
- Advanced filtering and searching

## Screenshots
<table align="center" style="width: 100%;">
  <tr>
    <td width="50%"><img alt="Mail View" src="static/images/mail-view.png"></td>
    <td width="50%"><img alt="Mail Filter" src="static/images/mail-filter.png"></td>
  </tr>
  <tr>
    <td width="50%"><img alt="Contacts Table" src="static/images/contacts-table.png"></td>
    <td width="50%"><img alt="Workflow" src="static/images/workflow.png"></td>
  </tr>
  <tr>
    <td width="50%"><img alt="Marketplace" src="static/images/marketplace.png"></td>
    <td width="50%"><img alt="App Creator" src="static/images/app-creator.png"></td>
  </tr>
  <tr>
    <td width="50%"><img alt="Email Template Dialog" src="static/images/email-template-dialog.png"></td>
    <td width="50%"><img alt="Email Template Select" src="static/images/email-template-select.png"></td>
  </tr>
  <tr>
    <td width="50%"><img alt="Channels Add" src="static/images/channels-add.png"></td>
    <td width="50%"></td>
  </tr>
</table>

## Tech Stack

- **Framework**: Next.js 16.1 with React Server Components
- **API**: tRPC v11 with React Query
- **Database**: PostgreSQL with Drizzle ORM
- **UI**: TailwindCSS v4 with shadcn/ui components
- **Forms**: React Hook Form with Zod validation
- **Caching**: Redis
- **Build**: Turborepo
- **Real-time**: Pusher
- **Deployment**: SST (AWS) / Docker
- **Package Manager**: pnpm

## Prerequisites

- Node.js 22 or later
- pnpm 10.17 or later
- PostgreSQL database
- Redis

## Quick Start

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/auxxai/auxx-ai.git
cd auxx-ai

# Copy environment files
cp .env.example .env

# Start the application using Docker Compose
pnpm docker:dev
```

Once the application is running, visit `http://localhost:3000` and follow the setup wizard.

### Manual Setup

1. **Install dependencies**:

   ```bash
   pnpm install
   ```

2. **Setup environment variables**:

   ```bash
   # Copy environment files
   cp .env.example .env
   cp apps/web/.env.example apps/web/.env
   cp apps/api/.env.example apps/api/.env
   cp apps/worker/.env.example apps/worker/.env
   ```

3. **Start PostgreSQL and Redis**:

   ```bash
   ./start-database.sh
   ./start-redis.sh
   ```

4. **Run database migrations**:

   ```bash
   pnpm db:migrate
   ```

5. **Seed the database** (optional):

   ```bash
   pnpm seed
   ```

6. **Start the development server**:

   ```bash
   pnpm dev
   ```

7. Visit `http://localhost:3000` and follow the setup wizard.

## First-time Setup

When you first run the application, you'll be guided through a setup wizard to:

1. Create a super admin account
2. Configure your organization details
3. Set up initial settings

## Environment Variables

Environment files are distributed across apps for modularity:

```
Root:
├── .env.example              # Shared variables

Apps:
├── apps/web/.env.example     # Web app (auth, integrations, AI models)
├── apps/api/.env.example     # API server (CORS, SDK)
├── apps/worker/.env.example  # Background worker (queues, integrations)
├── apps/kb/.env.example      # Knowledge base
├── apps/lambda/.env.example  # Lambda functions (S3)
```

### Key Configuration Categories

| Category       | Variables                                                               |
| -------------- | ----------------------------------------------------------------------- |
| Database       | `DATABASE_URL`                                                          |
| Redis          | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`                            |
| Auth           | `AUTH_GOOGLE_*`, `AUTH_GITHUB_*`                                        |
| Gmail          | `GOOGLE_CLIENT_*`, `GOOGLE_PUBSUB_*`                                    |
| Outlook        | `OUTLOOK_CLIENT_*`, `OUTLOOK_WEBHOOK_*`                                 |
| Shopify        | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`                                 |
| AI Models      | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY` |
| Email Provider | `EMAIL_PROVIDER`, `MAILGUN_*` or `SMTP_*`                               |
| Storage        | `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`    |
| Payments       | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                            |
| Real-time      | `PUSHER_*`                                                              |

See individual `.env.example` files for complete configuration options.

## Project Structure

```
├── apps/
│   ├── web/              # Main Next.js application
│   ├── api/              # API server
│   ├── worker/           # Background job processor
│   ├── kb/               # Knowledge base app
│   ├── lambda/           # AWS Lambda functions
│   ├── docs/             # Documentation site
│   ├── homepage/         # Marketing site
│   └── build/            # Build utilities
│
├── packages/
│   ├── database/         # Drizzle ORM schema & migrations
│   ├── ui/               # Shared UI components (shadcn)
│   ├── lib/              # Shared utilities
│   ├── config/           # Shared configuration
│   ├── services/         # Business logic services
│   ├── sdk/              # Auxx SDK
│   ├── email/            # Email handling
│   ├── redis/            # Redis client
│   ├── credentials/      # Credentials management
│   ├── billing/          # Stripe billing
│   ├── workflow-nodes/   # Workflow automation nodes
│   ├── logger/           # Logging utilities
│   ├── seed/             # Database seeding
│   ├── eslint-config/    # Shared ESLint config
│   └── typescript-config/# Shared TypeScript config
│
├── infra/                # Infrastructure configs
├── scripts/              # Utility scripts
└── docs/                 # Additional documentation
```

## Development

### Common Commands

```bash
# Start all apps in development mode
pnpm dev

# Build all packages
pnpm build

# Lint and format
pnpm lint
pnpm lint:fix
pnpm format

# Run tests
pnpm test
pnpm test:ui          # With Vitest UI
pnpm test:coverage    # With coverage report
```

### Database Commands (Drizzle)

```bash
# Generate migrations after schema changes
pnpm db:generate

# Run migrations
pnpm db:migrate

# Open Drizzle Studio (database GUI)
pnpm db:studio

# Reset database
pnpm db:reset

# Seed database
pnpm seed
pnpm seed:dev         # Development seed
pnpm seed:test        # Test data seed
```

### Adding New Features

1. Define models in `packages/database/src/schema/`
2. Generate and run migrations: `pnpm db:generate && pnpm db:migrate`
3. Create tRPC routers in `apps/web/src/server/api/routers/`
4. Add UI components in `packages/ui/` or app-specific components
5. Add pages in `apps/web/src/app/`

## Deployment

### SST (AWS) Deployment

```bash
# AWS SSO login
pnpm sso

# Deploy to development
pnpm sst:dev

# Deploy to production
STAGE=production pnpm sst:deploy

# Remove deployment
pnpm sst:remove
```

### Docker Deployment

```bash
# Development
pnpm docker:dev
pnpm docker:stop
pnpm docker:logs

# Production
pnpm docker:prod
pnpm docker:build:prod
pnpm docker:stop:prod
pnpm docker:logs:prod
```

For production Docker deployment, update environment variables in `docker-compose.prod.yml`.

## Monorepo Notes

- Built with **Turborepo** for build orchestration
- Package naming convention: `@auxx/<package-name>`
- Workspace packages defined in `pnpm-workspace.yaml`
- Shared dependencies managed via `catalog:` in pnpm

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

If you encounter any problems or have questions, please open an issue on GitHub.
