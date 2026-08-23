/**
 * Interactive CLI command to authenticate with Google Account (OAuth PKCE)
 * and persist credentials into ~/.dsh/.credentials.yaml.
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { runGoogleOAuth } from '../packages/llm/llm-pi-ai/src/google-oauth.ts'

async function main(): Promise<void> {
  const credentialsPath = join(homedir(), '.dsh', '.credentials.yaml')
  const ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: credentialsPath, watch: false })
  await ctx.plugin(AuthorizationService)

  console.log('\n🚀 Starting Google OAuth Login for Gemini...\n')

  const controller = new AbortController()

  const session = {
    method: 'oauth',
    signal: controller.signal,
    notify(notice: { message: string; url?: string }) {
      console.log(`ℹ️  ${notice.message}`)
      if (notice.url) {
        console.log(`\n🔗 If your browser does not open automatically, open this URL:\n${notice.url}\n`)
        try {
          if (process.platform === 'darwin') {
            spawn('open', [notice.url], { stdio: 'ignore', detached: true }).unref()
          } else if (process.platform === 'win32') {
            spawn('cmd.exe', ['/c', 'start', notice.url], { stdio: 'ignore', detached: true }).unref()
          } else {
            spawn('xdg-open', [notice.url], { stdio: 'ignore', detached: true }).unref()
          }
        } catch {
          // ignore browser open failures
        }
      }
    },
    prompt() {
      return Promise.resolve('')
    },
  }

  try {
    await runGoogleOAuth(ctx, session)
    console.log('\n✅ Successfully authenticated with your Google account!')
    console.log(`📁 Credentials stored in ${credentialsPath}`)
    console.log('🎉 You can now use Gemini 3.7 Flash, 2.5 Pro, and 2.5 Flash without any API key!\n')
    process.exit(0)
  } catch (err) {
    console.error('\n❌ Google Login Failed:', (err as Error).message)
    process.exit(1)
  }
}

main()
