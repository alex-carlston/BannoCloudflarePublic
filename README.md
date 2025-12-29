# Banno Cloudflare Public

A modular, Hono-based application for Banno OAuth integration, deployed on Cloudflare Workers. Features a clean separation of concerns with dedicated services for authentication, sessions, and plugin rendering.

## Features
- OAuth 2.0 authentication with Banno using PKCE
- Session management with encrypted Cloudflare KV storage
- Modular architecture with separated routes, services, and utilities
- Responsive UI with Bootstrap 5
- TypeScript for type safety
- Automatic token refresh
- CSRF protection

## Prerequisites
- JHA Dev Account https://jackhenry.dev/
- Node.js (v18 or later)
- pnpm
- Cloudflare account with Wrangler CLI installed

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/alex-carlston/BannoCloudflarePublic
   cd BannoCloudflarePublic
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   - Copy `.dev.vars.example` to `.dev.vars`
   - Fill in the required values in `.dev.vars` (e.g., CLIENT_ID, CLIENT_SECRET from Banno Admin Portal)

4. Configure Wrangler:
   - Copy `wrangler.jsonc.example` to `wrangler.jsonc`
   - Edit `wrangler.jsonc` to set your production KV namespace ID

5. Set secrets for production:
   ```bash
   pnpm wrangler secret put CLIENT_SECRET
   ```

5. Start development server:
   ```bash
   pnpm run dev
   ```

Visit `http://localhost:8787` → Click "Login with Banno" → Done!

## Project Structure

```
src/
├── index.tsx              # Main app with routes & middleware
├── layout.tsx             # Base HTML layout
├── types.ts               # TypeScript definitions
├── middleware/            # Hono middleware
│   └── request-id.middleware.ts
├── routes/                # Route handlers
│   ├── auth.routes.ts     # Authentication routes
│   └── page.routes.tsx    # Page routes
├── services/              # Business logic
│   ├── auth.service.ts    # OAuth flow & token exchange
│   ├── auth.ts            # Auth utilities
│   ├── kv.service.ts      # KV storage wrapper
│   ├── plugin.service.tsx # Plugin rendering
│   └── session.service.ts # Session management
└── utils/                 # Helper utilities
    ├── auth.ts            # OAuth callback handling
    └── crypto.ts          # JWT & crypto utilities
```

## Technology Stack

- **Framework**: [Hono](https://hono.dev/) v4 with middleware
- **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/)
- **Sessions**: Encrypted [Cloudflare KV](https://developers.cloudflare.com/kv/)
- **UI**: [Bootstrap 5](https://getbootstrap.com/) + [Bootswatch Sandstone](https://bootswatch.com/sandstone/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Security**: AES-GCM encryption, PKCE, CSRF protection

## Routes

| Route | Purpose |
|-------|---------|
| `GET /` | Home page with login button |
| `GET /login` | Legacy login redirect |
| `GET /auth/login` | Initiate OAuth flow |
| `GET /callback` | OAuth callback handler |
| `GET /callback/plugin` | OAuth callback & plugin renderer |
| `GET /dashboard` | User dashboard (protected) |
| `GET /logout` | Logout and clear session |

## Security

### OAuth 2.0 Flow with Banno

This plugin uses OAuth 2.0 with PKCE (Proof Key for Code Exchange) to securely authenticate users with Banno. The flow is:

1. **Login Initiation** (`GET /auth/login`)
   - User clicks "Login with Banno" button
   - Redirect to `{ENV_URI}/login`
   - Banno recognizes our CLIENT_ID from the pre-configured redirect URI
   - Generate CSRF state token and store in secure cookie

2. **User Authentication at Banno**
   - User enters credentials at `https://digital.garden-fi.com/login`
   - Banno validates the login
   - Upon success, Banno redirects back to our REDIRECT_URI with authorization code

3. **Authorization Callback** (`GET /callback` or `GET /callback/plugin`)
   - Validate CSRF state token from cookie
   - Receive authorization code from Banno
   - Exchange code for access token using CLIENT_SECRET (server-side, never exposed)
   - Fetch user info from Banno API
   - Create JWT session token and store in secure cookie
   - Render plugin content or redirect to plugin renderer

4. **Session Management**
   - JWT tokens stored in secure, httpOnly cookies
   - Session valid for 30 days
   - Automatic verification on protected routes
   - Tokens refreshed if needed

### Environment Configuration

Set these in `.dev.vars`:

```
CLIENT_ID=your-client-id-from-banno-admin
CLIENT_SECRET=your-client-secret-from-banno-admin
ENV_URI=https://digital.garden-fi.com/
REDIRECT_URI=https://your-domain.com/callback/plugin
SESSION_ENC_SECRET=your-32-byte-encryption-secret
ENVIRONMENT=development
```

Set CLIENT_SECRET as a secret via CLI for production:
```bash
pnpm wrangler secret put CLIENT_SECRET
```

### CSRF Protection

- Generate CSRF token at login initiation
- Validate token on callback
- Token stored in state parameter (OAuth best practice)

### Session Storage (KV)

**User-Based Session Management**: One session per user with automatic cleanup.

**Keys are formatted as:**
- `session:{sessionId}` - Encrypted session data (30-day TTL)
- `user_session:{userId}` - User-to-session mapping (30-day TTL)
- `ratelimit:auth:{clientIP}` - Rate limiting (60-second TTL)

All data encrypted with AES-GCM using `SESSION_ENC_SECRET`.

```typescript
{
  sessionId: string
  userId: string
  email: string
  accessToken: string
  refreshToken?: string
  expiresAt: number // Unix timestamp
}
```

### API Security Headers

All responses include:
- `Strict-Transport-Security` (HSTS)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (prevent clickjacking)
- `Content-Security-Policy` (restrict script sources)
- `X-XSS-Protection`

### Rate Limiting

Consider implementing rate limiting for:
- OAuth endpoints (prevent brute force)
- API endpoints (prevent abuse)
- Use Cloudflare Workers Rate Limiting API

### Secrets Management

- **Never** commit secrets to git
- Use `wrangler secret put CLIENT_SECRET`
- Access via `c.env.CLIENT_SECRET`

### Token Refresh

When calling Banno API:
1. Check if access token is expired
2. If expired and refresh token exists, get new access token
3. Retry API call
4. If both tokens expired, redirect to login

### SSL/TLS

- All communication with Banno APIs must use HTTPS
- Cloudflare Workers handle SSL automatically
- Verify Banno API certificates in production

### Best Practices

- ✅ Use PKCE for additional OAuth security (future)
- ✅ Log security events (without sensitive data)
- ✅ Regular security audits
- ✅ Keep Cloudflare Workers runtime updated
- ✅ Monitor KV for suspicious session activity
- ❌ Don't store sensitive data in cookies
- ❌ Don't expose tokens in URLs
- ❌ Don't log tokens or secrets

## Available Commands

```bash
pnpm run dev              # Local development
pnpm run deploy           # Deploy to production
pnpm run cf-typegen       # Sync Cloudflare types
```

## Deployment

### Prerequisites for Deployment

Before deploying to Cloudflare, ensure you have:

1. **Cloudflare Account**: Sign up at [cloudflare.com](https://cloudflare.com) if you don't have one.
2. **Wrangler CLI**: Installed via `pnpm` (already included in devDependencies).
3. **Banno OAuth Credentials**: CLIENT_ID and CLIENT_SECRET from Banno Admin Portal.
4. **Environment Variables**: Properly configured `.dev.vars` and production secrets.

### What Was Actually Deployed

This project has been **fully deployed** as a Cloudflare Worker with the following configuration:

- **Worker Code**: Hono app deployed at `https://banno-hono-plugin-production.a-carlston2.workers.dev`
- **Static Assets**: Files from `public/` directory served alongside the Worker
- **KV Storage**: Session storage namespace configured and working
- **Secrets**: CLIENT_SECRET configured for production environment
- **Environment Variables**: All production variables hardcoded in `wrangler.jsonc`
- **Logging**: Cloudflare observability logs enabled for debugging and monitoring
- **Current Status**: ✅ **Fully deployed and operational** - OAuth flow working with proper session management

**Current Status**: ✅ **Fully deployed and operational** at `https://banno-hono-plugin-production.a-carlston2.workers.dev` with complete OAuth flow and user-based session management.

### Step-by-Step Deployment Guide

#### ✅ Completed Steps (from our deployment)

1. **Authenticate with Cloudflare**
   ```bash
   pnpm wrangler login
   ```

2. **Create KV Namespace for Sessions**
   ```bash
   pnpm wrangler kv namespace create "SESSIONS_KV"
   ```

3. **Set Production Secrets**
   ```bash
   pnpm wrangler secret put CLIENT_SECRET --env production
   ```

4. **Configure Production Environment Variables**
   - Hardcoded in `wrangler.jsonc` for production environment
   - Values: CLIENT_ID, ENV_URI, REDIRECT_URI, SESSION_ENC_SECRET, ENVIRONMENT

5. **Deploy Worker**
   ```bash
   pnpm wrangler deploy --env production --minify
   ```
   - **Production URL**: `https://banno-hono-plugin-production.a-carlston2.workers.dev`
   - **KV Storage**: Configured for session management
   - **Logging**: Enabled for debugging and monitoring

#### ❌ **Banno Admin Portal Configuration Required**

#### 6. Update Banno OAuth Settings

**Critical**: Configure your Banno Admin Portal OAuth application:

**Required Settings:**
- **Primary URI**: `https://DEPLOYEDWORKERURL`
- **Redirect URI**: `https://DEPLOYEDWORKERURL'/callback/plugin`
- **CLIENT_ID**: `0000-00-00-0000` (From Banno Admin)
- **CLIENT_SECRET**: Must match the secret set in Cloudflare (verify in Banno Admin Portal)

**Steps in Banno Admin Portal:**
1. Go to your OAuth application settings
2. Set **Primary URI** to: `https://DEPLOYEDWORKERURL`
3. Set **Redirect URI** to:  `https://DEPLOYEDWORKERURL'/callback/plugin`
4. Verify CLIENT_ID and CLIENT_SECRET match your Cloudflare configuration

#### 7. Verify CLIENT_SECRET Match

**Important**: The "client authentication failed" error indicates a CLIENT_SECRET mismatch.

- Compare the CLIENT_SECRET in your Banno Admin Portal with the one set in Cloudflare
- If they don't match, update the Cloudflare secret:
  ```bash
  pnpm wrangler secret put CLIENT_SECRET --env production
  ```
  Then enter the correct CLIENT_SECRET from Banno Admin Portal.

#### 8. Test Complete OAuth Flow

After updating Banno settings and verifying CLIENT_SECRET:

1. Visit: `https://banno-hono-plugin-production.a-carlston2.workers.dev/callback/plugin`
2. Click "Login with Banno"
3. Complete authentication
4. Verify successful login and plugin rendering
5. Check Cloudflare logs for any remaining issues
4. Verify session persistence and plugin rendering

### Troubleshooting Deployment

#### Common Issues

**"Environment variable not set"**
- Production environment variables are not configured
- Set them in Cloudflare Dashboard or update `wrangler.jsonc`

**"SESSIONS_KV assigned to multiple KV Namespace bindings"**
- Edit `wrangler.jsonc` to remove duplicate bindings
- Ensure unique binding names

**"Secret not found"**
- Verify secrets are set: `pnpm wrangler secret list`
- Re-run `pnpm wrangler secret put CLIENT_SECRET`

**"OAuth redirect mismatch"**
- Ensure REDIRECT_URI in Banno Admin matches your deployed URL
- Check environment variables are correctly set

**"KV namespace not found"**
- Verify namespace ID in `wrangler.jsonc` matches created namespace
- Check `pnpm wrangler kv namespace list`

#### Useful Commands

```bash
# List KV namespaces
pnpm wrangler kv namespace list

# List secrets
pnpm wrangler secret list

# Check deployment status
pnpm wrangler deployments

# View logs
pnpm wrangler tail
```

### CI/CD Integration

For automated deployments, consider:

- **GitHub Actions**: Use `cloudflare/wrangler-action`
- **Environment Variables**: Set secrets in your CI platform
- **Branch Protection**: Deploy only from `main` or `production` branches

Example GitHub Actions workflow:

```yaml
name: Deploy to Cloudflare
on:
  push:
    branches: [ main ]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm install -g pnpm
      - run: pnpm install
      - run: pnpm wrangler deploy --env production
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLIENT_ID: ${{ secrets.CLIENT_ID }}
          ENV_URI: ${{ secrets.ENV_URI }}
          REDIRECT_URI: ${{ secrets.REDIRECT_URI }}
          SESSION_ENC_SECRET: ${{ secrets.SESSION_ENC_SECRET }}
          ENVIRONMENT: production
```

### Rollback

If needed, rollback to a previous deployment:

```bash
pnpm wrangler rollback <version-id>
```

Find version IDs with:

```bash
pnpm wrangler deployments
```

## Next Steps

- Update OAuth settings in `.dev.vars`
- Customize routes in `src/routes/`
- Add business logic to `src/services/`
- Create utilities in `src/utils/`
- Style components with Bootstrap classes

## Contributing

PRs welcome! Please follow the code style and include tests.

## License

MIT © 2025
