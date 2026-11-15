import { Hono } from 'hono'
import { Bindings } from '../services/auth.service'
import { Variables } from '../types'
import { renderPlugin } from '../services/plugin.service.tsx'
import { initiateAuth } from '../services/auth.service'
import { getSignedCookie } from 'hono/cookie'
import { SessionService } from '../services/session.service'
import KVService from '../services/kv.service'
import { redactSensitive } from '../utils/auth'
import { decodeJwtPayload } from '../utils/crypto'

export function createPageRoutes(): Hono<{ Bindings: Bindings, Variables: Variables }> {
  const router = new Hono<{ Bindings: Bindings, Variables: Variables }>()

  // Home Route
  router.get('/', async (c) => {
    const loginUrl = await initiateAuth(c)
    
    return c.render(
      <div className="container mt-5">
        <div className="row">
          <div className="col-md-8 mx-auto">
            <h1 className="display-4 fw-bold">Welcome to Banno</h1>
            <p className="lead mt-3">A modern plugin starter for Banno developers.</p>
            <div className="card mt-4">
              <div className="card-body">
                <h5 className="card-title">Getting Started</h5>
                <p>Sign in to see your account information and data.</p>
                <a href={loginUrl} className="btn btn-primary">Sign In with Banno</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  })

  // Login Route - Redirects to the REDIRECT_URI backend's auth login
  router.get('/login', (c) => {
    const redirectUri = c.env.REDIRECT_URI || 'http://localhost:8787'
    const baseUrl = redirectUri.replace(/\/callback$/, '')
    return c.redirect(`${baseUrl}/auth/login`)
  })

  // Plugin Route - Renders plugin content at /callback/plugin
  // Also accessible at /dashboard for existing sessions
  // Handles OAuth callback if code/state params are present
  router.get('/callback/plugin', renderPlugin)
  router.get('/dashboard', renderPlugin)

  // Claims inspector - raw id_token claims + live userinfo (/oidc/me). Localhost only:
  // restricted claims contain full account and card numbers. Add ?json for raw JSON.
  router.get('/claims', async (c) => {
    if (new URL(c.req.url).hostname !== 'localhost') return c.notFound()

    const sessionId = await getSignedCookie(c, c.env.SESSION_ENC_SECRET!, '__Secure-session_id')
    const session = sessionId && c.env.SESSIONS_KV
      ? await new SessionService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET!, c.env).getSession(sessionId)
      : null
    if (!session) return c.render(<p>No session. <a href="/auth/login">Sign in</a></p>)

    const idToken = redactSensitive(await new KVService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET).get(`id_token:${session.userId}`))
    const res = await fetch(`${c.env.ENV_URI.replace(/\/$/, '')}/a/consumer/api/v0/oidc/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    })
    const userinfo = res.ok ? redactSensitive(await res.json()) : { error: res.status, body: await res.text() }

    // Shape-only summary (no values) so claim presence can be checked from the dev logs
    // Arrays show the union of their items' keys, so every field name across e.g. all 10 shares appears once
    const shape = (o: any): any => {
      if (o === null) return 'null'
      if (Array.isArray(o)) {
        if (!o.length) return 'array(0)'
        const objs = o.filter(i => i && typeof i === 'object' && !Array.isArray(i))
        if (!objs.length) return [`x${o.length}`, shape(o[0])]
        const merged: any = {}
        for (const i of objs) for (const [k, v] of Object.entries(i)) if (merged[k] == null) merged[k] = v // prefer non-null
        return [`x${o.length}`, shape(merged)]
      }
      if (typeof o !== 'object') return o === '[redacted]' ? 'redacted' : typeof o
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace('https://api.banno.com/consumer/claim/', 'claim/'), shape(v)]))
    }
    console.log('claims shape', JSON.stringify({ idToken: shape(idToken), userinfo: shape(userinfo) }))

    if (c.req.query('json') !== undefined) return c.json({ idToken, userinfo })

    return c.render(
      <div>
        <h4>id_token claims</h4>
        <pre className="bg-light p-2 small">{JSON.stringify(idToken, null, 2)}</pre>
        <h4>userinfo (/oidc/me)</h4>
        <pre className="bg-light p-2 small">{JSON.stringify(userinfo, null, 2)}</pre>
      </div>
    )
  })

  // Tracking probe - does our OAuth token let us run a PowerOn via the generic execute
  // endpoint the Banno web app uses? Localhost only. ?type=83 (default ALL), ?poweron=NAME,
  // ?state=GETTRACKINGINFO, ?member=<acct>. Logs status + redacted result to the dev console.
  router.get('/tracking', async (c) => {
    if (new URL(c.req.url).hostname !== 'localhost') return c.notFound()

    const sessionId = await getSignedCookie(c, c.env.SESSION_ENC_SECRET!, '__Secure-session_id')
    const session = sessionId && c.env.SESSIONS_KV
      ? await new SessionService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET!, c.env).getSession(sessionId)
      : null
    // Return 401 rather than redirecting - a stale cookie here can bounce login in a loop
    if (!session) return c.json({ error: 'no session - open /auth/login first', login: '/auth/login' }, 401)

    const idToken: any = await new KVService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET).get(`id_token:${session.userId}`)
    const claim = (n: string) => idToken?.[`https://api.banno.com/consumer/claim/${n}`]
    const member = c.req.query('member') || claim('customer_identifier') || claim('netteller_id') || ''

    const payload = {
      rgState: c.req.query('state') || 'GETTRACKINGINFO',
      powerOnFileName: c.req.query('poweron') || 'BANNO.GETTRACKING.V1.POW',
      userChrList: c.req.query('empty') !== undefined ? [] : [member, c.req.query('type') || 'ALL'],
      userNumList: [],
      rgSession: 1
    }

    const res = await fetch(`${c.env.ENV_URI.replace(/\/$/, '')}/a/power-ons/api/generic/execute`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    })
    const text = await res.text()
    let body: any; try { body = JSON.parse(text) } catch { body = text }
    // ?raw bypasses redaction so the operator can verify the untouched response themselves
    const safe = c.req.query('raw') !== undefined ? body : redactSensitive(body)

    // Why did it fail? An OAuth resource server states the reason here (insufficient_scope etc.)
    let token: any = 'opaque (not a JWT)'
    try {
      const p = decodeJwtPayload(session.accessToken)
      token = { aud: p.aud, iss: p.iss, client_id: p.client_id, scope: p.scope, acr: p.acr, sub_present: !!p.sub }
    } catch { /* opaque token */ }

    const out = {
      status: res.status,
      wwwAuthenticate: res.headers.get('www-authenticate'),
      responseHeaders: Object.fromEntries([...res.headers].filter(([k]) => !/^set-cookie$/i.test(k))),
      token,
      // raw mode shows the real member so you can confirm it resolved from the claim; else masked
      request: { ...payload, userChrList: c.req.query('raw') !== undefined ? payload.userChrList : (payload.userChrList.length ? ['<member>', payload.userChrList[1] ?? null] : []) },
      memberSource: c.req.query('member') ? 'query ?member' : claim('customer_identifier') ? 'claim/customer_identifier' : claim('netteller_id') ? 'claim/netteller_id' : 'NONE',
      response: safe
    }
    console.log('tracking probe', JSON.stringify({ ...out, response: redactSensitive(body) }).slice(0, 2000))
    return c.json({ ...out, rawBodyLength: text.length })
  })

  return router
}
