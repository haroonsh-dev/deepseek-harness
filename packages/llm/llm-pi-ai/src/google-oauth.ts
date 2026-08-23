/**
 * Google OAuth 2.0 PKCE authorization flow for Gemini and Google Vertex AI.
 *
 * Implements a local loopback OAuth 2.0 flow with Proof Key for Code Exchange (PKCE)
 * that allows users to authenticate with their Google account, acquire OAuth tokens
 * (access_token & refresh_token), and store them into the harness credential store.
 *
 * @module dsh-llm-pi-ai/google-oauth
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { AuthorizationError } from '@deepseek-ai/dsh-authorization'
import { recordKeyFor } from './auth.ts'

/** Default Google Cloud / Google AI desktop client credentials for PKCE flow. */
const DEFAULT_GOOGLE_CLIENT_ID =
  '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com'
const DEFAULT_GOOGLE_CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty'

/** Default OAuth scopes for Gemini and Google Cloud AI. */
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/generative-language',
  'https://www.googleapis.com/auth/cloud-platform',
  'openid',
  'email',
  'profile',
]

export interface GoogleOAuthOptions {
  clientId?: string
  clientSecret?: string
  scopes?: readonly string[]
}

/** Generate a cryptographically random PKCE code verifier. */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** Generate a SHA-256 base64url PKCE code challenge from a verifier. */
function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Execute the Google OAuth 2.0 PKCE login flow.
 *
 * @param ctx - Cordis context carrying `ctx.credentials`.
 * @param session - The authorization session to report progress to.
 * @param options - Custom OAuth client options.
 */
export async function runGoogleOAuth(
  ctx: Context,
  session: AuthorizationSession,
  options?: GoogleOAuthOptions,
): Promise<void> {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new AuthorizationError(
      'credentials service is not available in the current composition',
      'NO_CREDENTIALS_SERVICE',
    )
  }

  const clientId = options?.clientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? DEFAULT_GOOGLE_CLIENT_ID
  const clientSecret = options?.clientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? DEFAULT_GOOGLE_CLIENT_SECRET
  const scopes = options?.scopes ?? DEFAULT_SCOPES

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = randomBytes(16).toString('hex')

  let server: Server | undefined
  try {
    // Start local loopback server on a free port
    const { port, codePromise } = await new Promise<{ port: number; codePromise: Promise<string> }>((resolve, reject) => {
      let codeResolve: (code: string) => void
      let codeReject: (err: Error) => void
      const innerPromise = new Promise<string>((res, rej) => {
        codeResolve = res
        codeReject = rej
      })

      const srv = createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
          if (reqUrl.pathname !== '/oauth/callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('Not Found')
            return
          }

          const queryState = reqUrl.searchParams.get('state')
          const queryCode = reqUrl.searchParams.get('code')
          const queryError = reqUrl.searchParams.get('error')

          if (queryError) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <!DOCTYPE html>
              <html>
                <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
                  <h1 style="color: #ef4444;">Authentication Failed</h1>
                  <p>${queryError}</p>
                </body>
              </html>
            `)
            codeReject(new AuthorizationError(`Google sign-in was denied: ${queryError}`, 'OAUTH_DENIED'))
            return
          }

          if (queryState !== state || !queryCode) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <!DOCTYPE html>
              <html>
                <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
                  <h1 style="color: #ef4444;">Invalid OAuth Callback</h1>
                  <p>State mismatch or missing authorization code.</p>
                </body>
              </html>
            `)
            codeReject(new AuthorizationError('OAuth state mismatch or missing code', 'INVALID_CALLBACK'))
            return
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Authentication Successful</title></head>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 60px; background: #0f172a; color: #f8fafc;">
                <div style="max-width: 480px; margin: 0 auto; background: #1e293b; padding: 32px; border-radius: 12px; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                  <div style="font-size: 48px; margin-bottom: 16px;">✨</div>
                  <h1 style="margin: 0 0 12px 0; font-size: 24px; color: #38bdf8;">Signed in with Google</h1>
                  <p style="color: #94a3b8; line-height: 1.5; margin: 0 0 24px 0;">You have successfully authenticated with Google. You can now close this tab and return to DeepSeek Harness.</p>
                </div>
              </body>
            </html>
          `)
          codeResolve(queryCode)
        } catch (err) {
          codeReject(err instanceof Error ? err : new Error(String(err)))
        }
      })

      srv.listen(0, '127.0.0.1', () => {
        const address = srv.address()
        if (address && typeof address === 'object') {
          resolve({ port: address.port, codePromise: innerPromise })
        } else {
          reject(new Error('Failed to bind OAuth callback server'))
        }
      })

      srv.on('error', reject)
      server = srv
    })

    const redirectUri = `http://127.0.0.1:${String(port)}/oauth/callback`
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', scopes.join(' '))
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')

    session.notify({
      message: 'Open the verification page in your browser to sign in with your Google account.',
      url: authUrl.toString(),
    })

    // Wait for the redirect callback or cancellation
    const code = await Promise.race([
      codePromise,
      new Promise<never>((_, reject) => {
        if (session.signal.aborted) {
          reject(new AuthorizationError('Authorization cancelled by user', 'CANCELLED'))
          return
        }
        session.signal.addEventListener('abort', () => {
          reject(new AuthorizationError('Authorization cancelled by user', 'CANCELLED'))
        })
      }),
    ])

    // Exchange the authorization code for tokens
    session.notify({ message: 'Exchanging authorization code for tokens…' })

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      signal: session.signal,
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      throw new AuthorizationError(`Token exchange failed (${String(tokenResponse.status)}): ${errorText}`, 'TOKEN_EXCHANGE_FAILED')
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      token_type?: string
    }

    if (!tokenData.access_token) {
      throw new AuthorizationError('Token endpoint did not return an access_token', 'INVALID_TOKEN_RESPONSE')
    }

    const expiresAt = Date.now() + (tokenData.expires_in ?? 3600) * 1000

    // Store as grant record for both google and google-vertex
    const grantPayload = {
      type: 'oauth',
      provider: 'google',
      tokens: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
      },
    }

    await credentials.modifyRecord(recordKeyFor('google'), async () => ({
      kind: 'grant',
      payload: grantPayload,
    }))

    await credentials.modifyRecord(recordKeyFor('google-vertex'), async () => ({
      kind: 'grant',
      payload: grantPayload,
    }))

    session.notify({ message: 'Google account linked successfully!' })
  } finally {
    if (server) {
      server.close()
    }
  }
}
