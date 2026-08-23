/**
 * Web routes for interactive Google OAuth 2.0 PKCE login in the Web UI.
 *
 * @module @deepseek-ai/dsh-web-app/google-auth-routes
 */
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

const DEFAULT_GOOGLE_CLIENT_ID =
  '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com'
const DEFAULT_GOOGLE_CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty'
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'openid',
  'email',
  'profile',
]

interface PendingAuth {
  verifier: string
  expiresAt: number
}

const pendingStates = new Map<string, PendingAuth>()

// Clean up expired states every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [state, pending] of pendingStates.entries()) {
    if (now > pending.expiresAt) pendingStates.delete(state)
  }
}, 5 * 60 * 1000).unref()

/**
 * Register OAuth web routes for Google login in Web UI.
 * @param ctx - plugin context carrying the webServer and credentials services.
 */
export function registerGoogleAuthRoutes(ctx: Context): void {
  const webServer = ctx.get('webServer') as WebServer | undefined
  if (!webServer) return

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? DEFAULT_GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? DEFAULT_GOOGLE_CLIENT_SECRET

  // Route 1: /api/auth/google/start
  webServer.register({
    kind: 'exact',
    path: '/api/auth/google/start',
    handler(req: IncomingMessage, res: ServerResponse) {
      const verifier = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const state = randomBytes(16).toString('hex')

      pendingStates.set(state, {
        verifier,
        expiresAt: Date.now() + 10 * 60 * 1000,
      })

      const host = req.headers.host ?? `127.0.0.1:${String(webServer.port)}`
      const protocol = req.headers['x-forwarded-proto'] ?? 'http'
      const redirectUri = `${String(protocol)}://${host}/api/auth/google/callback`

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', DEFAULT_SCOPES.join(' '))
      authUrl.searchParams.set('code_challenge', challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')

      res.writeHead(302, { Location: authUrl.toString() })
      res.end()
    },
  })

  // Route 2: /api/auth/google/callback
  webServer.register({
    kind: 'exact',
    path: '/api/auth/google/callback',
    async handler(req: IncomingMessage, res: ServerResponse) {
      try {
        const host = req.headers.host ?? `127.0.0.1:${String(webServer.port)}`
        const protocol = req.headers['x-forwarded-proto'] ?? 'http'
        const reqUrl = new URL(req.url ?? '/', `${String(protocol)}://${host}`)

        const state = reqUrl.searchParams.get('state')
        const code = reqUrl.searchParams.get('code')
        const error = reqUrl.searchParams.get('error')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`
            <!DOCTYPE html>
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
                <h1 style="color: #ef4444;">Authentication Denied</h1>
                <p>${error}</p>
                <button onclick="window.close()" style="margin-top:20px;padding:8px 16px;background:#334155;color:#fff;border:none;border-radius:6px;cursor:pointer;">Close Window</button>
              </body>
            </html>
          `)
          return
        }

        if (!state || !code || !pendingStates.has(state)) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`
            <!DOCTYPE html>
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
                <h1 style="color: #ef4444;">Invalid OAuth State</h1>
                <p>The state has expired or is invalid. Please try again.</p>
              </body>
            </html>
          `)
          return
        }

        const pending = pendingStates.get(state)!
        pendingStates.delete(state)

        const redirectUri = `${String(protocol)}://${host}/api/auth/google/callback`

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            code_verifier: pending.verifier,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
          }),
        })

        if (!tokenResponse.ok) {
          const errText = await tokenResponse.text()
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`
            <!DOCTYPE html>
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
                <h1 style="color: #ef4444;">Token Exchange Failed</h1>
                <p>${errText}</p>
              </body>
            </html>
          `)
          return
        }

        const tokenData = (await tokenResponse.json()) as {
          access_token: string
          refresh_token?: string
          expires_in?: number
        }

        const credentials = ctx.get('credentials')
        if (credentials) {
          const expires = Date.now() + (tokenData.expires_in ?? 3600) * 1000
          const grantPayload = {
            type: 'oauth',
            provider: 'google',
            access: tokenData.access_token,
            refresh: tokenData.refresh_token ?? '',
            expires,
            tokens: {
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
              expiresAt: expires,
            },
          }
          await credentials.modifyRecord('llm-pi-ai/google' as never, async () => ({
            kind: 'grant',
            payload: grantPayload,
          }))
          await credentials.modifyRecord('llm-pi-ai/google-vertex' as never, async () => ({
            kind: 'grant',
            payload: grantPayload,
          }))
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Signed In Successfully</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc;">
              <div style="max-width: 440px; margin: 0 auto; background: #1e293b; padding: 32px; border-radius: 12px; border: 1px solid #334155;">
                <div style="font-size: 40px; margin-bottom: 12px;">✨</div>
                <h1 style="margin: 0 0 8px 0; font-size: 22px; color: #38bdf8;">Signed in with Google</h1>
                <p style="color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0;">Your Google account is now linked. You can use Gemini 3.7 Flash directly.</p>
                <p style="color: #64748b; font-size: 13px;">Closing automatically in 2 seconds…</p>
              </div>
              <script>
                try {
                  if (window.opener) {
                    window.opener.postMessage({ type: 'google-auth-success' }, '*');
                  }
                } catch (e) {}
                setTimeout(() => {
                  try { window.close(); } catch (e) {}
                }, 1800);
              </script>
            </body>
          </html>
        `)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(String(err))
      }
    },
  })
}
