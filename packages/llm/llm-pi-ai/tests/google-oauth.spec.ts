import { mkdtemp, rm } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { recordKeyFor } from '../src/auth.ts'
import { runGoogleOAuth } from '../src/google-oauth.ts'

const dirs: string[] = []

async function createHarness(): Promise<{ ctx: Context; credentialsPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-google-oauth-'))
  dirs.push(dir)
  const credentialsPath = join(dir, '.credentials.yaml')
  const ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: credentialsPath, watch: false })
  await ctx.plugin(AuthorizationService)
  return { ctx, credentialsPath }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('runGoogleOAuth', () => {
  it('executes the PKCE flow, exchanges code, and saves grant records', async () => {
    const { ctx } = await createHarness()
    let authUrl: string | undefined
    const controller = new AbortController()

    const session: AuthorizationSession = {
      method: 'oauth',
      signal: controller.signal,
      notify: (notice) => {
        if (notice.url) authUrl = notice.url
      },
      prompt: () => Promise.resolve(''),
    }

    // Mock fetch for token exchange
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'mock-access-token-12345',
            refresh_token: 'mock-refresh-token-67890',
            expires_in: 3600,
            scope: 'openid email https://www.googleapis.com/auth/generative-language',
            token_type: 'Bearer',
          }),
        }
      }
      throw new Error(`Unexpected fetch to ${url}`)
    }))

    // Start OAuth flow in background
    const flowPromise = runGoogleOAuth(ctx, session)

    // Wait until authorization URL is emitted
    while (!authUrl) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    expect(authUrl).toContain('accounts.google.com/o/oauth2/v2/auth')
    expect(authUrl).toContain('client_id=')
    expect(authUrl).toContain('code_challenge=')
    expect(authUrl).toContain('state=')

    const parsedAuthUrl = new URL(authUrl)
    const redirectUri = parsedAuthUrl.searchParams.get('redirect_uri')!
    const state = parsedAuthUrl.searchParams.get('state')!

    // Simulate browser redirect to callback server
    const callbackUrl = new URL(redirectUri)
    callbackUrl.searchParams.set('code', 'mock-auth-code-abc')
    callbackUrl.searchParams.set('state', state)

    const callbackResponse = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = httpGet(callbackUrl.toString(), (res) => {
        resolve({ statusCode: res.statusCode ?? 0 })
      })
      req.on('error', reject)
    })
    expect(callbackResponse.statusCode).toBe(200)

    // Wait for the flow to complete
    await flowPromise

    // Verify stored records
    const googleRecord = await ctx.credentials.readRecord(recordKeyFor('google'))
    expect(googleRecord).toBeDefined()
    expect(googleRecord?.kind).toBe('grant')
    expect((googleRecord as { payload: { tokens: { accessToken: string } } }).payload.tokens.accessToken).toBe('mock-access-token-12345')

    const vertexRecord = await ctx.credentials.readRecord(recordKeyFor('google-vertex'))
    expect(vertexRecord).toBeDefined()
    expect(vertexRecord?.kind).toBe('grant')
  })

  it('rejects gracefully when user cancels or session signal aborts', async () => {
    const { ctx } = await createHarness()
    const controller = new AbortController()

    const session: AuthorizationSession = {
      method: 'oauth',
      signal: controller.signal,
      notify: () => {},
      prompt: () => Promise.resolve(''),
    }

    const flowPromise = runGoogleOAuth(ctx, session)
    controller.abort()

    await expect(flowPromise).rejects.toThrow(/cancelled/)
  })
})
