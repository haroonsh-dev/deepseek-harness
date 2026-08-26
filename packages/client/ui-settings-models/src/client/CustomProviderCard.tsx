/**
 * The card that declares a provider pi-ai does not ship — an OpenAI-compatible
 * gateway, a self-hosted server (Ollama, LM Studio, vLLM), or a custom provider.
 *
 * It provides a clean, unified 4-field creation experience:
 * - Provider Name
 * - Base URL
 * - Model Name
 * - API Key (optional)
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { deriveKeyRef, messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The settings namespace a hand-declared provider is written into. */
const NS = 'llm-pi-ai'

/** Props of {@link CustomProviderCard}. */
export interface CustomProviderCardProps {
  /** Route ids already declared, so the card refuses to shadow one. */
  taken: readonly string[]
  /** Wire protocols the adapter can serve, in the order it reports them. */
  protocols: readonly string[]
  /**
   * Revision of the `llm-pi-ai` user section this card opened at, sent with
   * the create so a route another tab declared meanwhile is a refusal rather
   * than a silent overwrite of its whole profile.
   */
  revision: number
  /** Wire faces for the write and for interrogating the endpoint. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Close the card; `changed` reports whether a provider was created. */
  onClose: (changed: boolean) => void
}

/**
 * Render the simplified custom-provider creation card.
 * @param props - existing routes, protocol choices, wire faces, and copy.
 * @returns the creation card.
 */
export function CustomProviderCard(props: CustomProviderCardProps): ReactNode {
  const { taken, protocols, api, t } = props
  const [openedAt] = useState(() => props.revision)
  const [displayName, setDisplayName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [modelName, setModelName] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [committed, setCommitted] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyStatus, setVerifyStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const disabled = props.readOnly || busy || verifying
  const profileDisabled = disabled || committed

  const slugify = (text: string): string => {
    let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug || !/^[a-z]/.test(slug)) slug = `provider-${slug || 'custom'}`
    return slug
  }

  const deriveUniqueRoute = (name: string): string => {
    const base = slugify(name)
    let candidate = base
    let counter = 1
    while (taken.includes(candidate)) {
      candidate = `${base}-${counter++}`
    }
    return candidate
  }

  const effectiveDisplayName = displayName.trim() || 'Custom Provider'
  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()

  const ready = baseURL.trim().length > 0
    && modelName.trim().length > 0
    && (keyFailure === undefined || keyFailure === 'keyBlank')

  const verifyAuth = async (): Promise<void> => {
    if (!baseURL.trim()) {
      setVerifyStatus({ ok: false, message: 'Please enter a Base URL first.' })
      return
    }
    setVerifying(true)
    setVerifyStatus(null)
    const startTime = Date.now()
    try {
      const defaultProtocol = protocols.includes('openai-completions')
        ? 'openai-completions'
        : (protocols[0] ?? 'openai-completions')

      const response = await api.llm.discoverModels({
        settingsNs: NS,
        baseURL: baseURL.trim(),
        api: defaultProtocol,
        ...keyValue.length > 0 ? { apiKey: keyValue } : {},
      })

      const latency = Date.now() - startTime
      if (!response.result.ok) {
        setVerifyStatus({
          ok: false,
          message: `Authentication failed: ${response.result.error.message}`,
        })
        return
      }

      const foundModels = response.result.value.models
      const firstModel = foundModels[0]
      const typedModel = modelName.trim()

      if (foundModels.length > 0 && firstModel !== undefined) {
        if (!typedModel) {
          setModelName(firstModel.id)
          setVerifyStatus({
            ok: true,
            message: `Authenticated successfully (${latency}ms)! Discovered ${foundModels.length} models. Auto-selected "${firstModel.id}".`,
          })
        } else {
          const matched = foundModels.some(m => m.id.toLowerCase() === typedModel.toLowerCase())
          if (matched) {
            setVerifyStatus({
              ok: true,
              message: `Authenticated successfully (${latency}ms)! Model "${typedModel}" verified on provider.`,
            })
          } else {
            setVerifyStatus({
              ok: true,
              message: `Authenticated successfully (${latency}ms)! Connected to provider (${foundModels.length} models available: ${foundModels.slice(0, 3).map(m => m.id).join(', ')}...).`,
            })
          }
        }
      } else {
        setVerifyStatus({
          ok: true,
          message: `Authenticated successfully (${latency}ms)! Connected to ${baseURL.trim()}.`,
        })
      }
    } catch (err) {
      setVerifyStatus({
        ok: false,
        message: `Connection failed: ${messageOf(err)}`,
      })
    } finally {
      setVerifying(false)
    }
  }

  const createOnce = async (): Promise<string | undefined> => {
    const route = deriveUniqueRoute(effectiveDisplayName)
    const keyRef = deriveKeyRef(route)
    const storesKey = keyValue.length > 0
    const defaultProtocol = protocols.includes('openai-completions')
      ? 'openai-completions'
      : (protocols[0] ?? 'openai-completions')

    const rawModels = modelName.split(/[,;\n]+/).map(m => m.trim()).filter(Boolean)
    const modelEntries = rawModels.length > 0
      ? rawModels.map(m => ({ id: m, name: m }))
      : [{ id: modelName.trim(), name: modelName.trim() }]

    if (!committed) {
      const profile = {
        displayName: effectiveDisplayName,
        ...storesKey ? { apiKeyEnv: keyRef } : {},
        api: defaultProtocol,
        baseURL: baseURL.trim(),
        models: modelEntries,
      }
      const response = await api.settings.mutate({
        ns: NS,
        ops: [{ op: 'set', path: ['providers', route], value: profile }],
        expectedRevision: openedAt,
      })
      if (!response.result.ok) return response.result.error.message
      setCommitted(true)
    }
    if (storesKey) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    return undefined
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await createOnce()
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      props.onClose(true)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['editor']}>
      <div className={styles['editorHeader']}>
        <span className={styles['editorTitle']}>{t('customTitle')}</span>
      </div>

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('customDisplayName')}</span>
        <input
          className={styles['input']}
          type="text"
          value={displayName}
          placeholder="Custom Provider"
          aria-label={t('customDisplayName')}
          disabled={profileDisabled}
          onChange={(event) => { setDisplayName(event.target.value) }}
        />
      </div>

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('baseUrl')}</span>
        <input
          className={styles['input']}
          type="text"
          value={baseURL}
          placeholder="https://api.openai.com/v1"
          aria-label={t('baseUrl')}
          disabled={profileDisabled}
          onChange={(event) => { setBaseURL(event.target.value) }}
        />
      </div>

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('keyInput')}</span>
        <input
          className={styles['input']}
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder="sk-..."
          aria-label={t('keyInput')}
          disabled={disabled}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
        {keyFailure !== undefined && keyFailure !== 'keyBlank'
          ? <p className={styles['error']}>{t(keyFailure)}</p>
          : null}
      </div>

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('model')}</span>
        <input
          className={styles['input']}
          type="text"
          value={modelName}
          placeholder="gpt-4o"
          aria-label={t('model')}
          disabled={profileDisabled}
          onChange={(event) => { setModelName(event.target.value) }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          disabled={disabled || verifying || !baseURL.trim()}
          style={{
            background: 'var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.06))',
            border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.15))',
            borderRadius: 8,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            cursor: verifying || !baseURL.trim() ? 'not-allowed' : 'pointer',
            color: 'var(--dsw-alias-label-primary, #f8fafc)',
            transition: 'background 0.15s ease',
          }}
          onClick={verifyAuth}
        >
          {verifying ? 'Authenticating…' : 'Verify Authentication'}
        </button>
      </div>

      {verifyStatus !== null && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 12,
            lineHeight: '18px',
            background: verifyStatus.ok ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            border: `1px solid ${verifyStatus.ok ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: verifyStatus.ok ? '#4ade80' : '#f87171',
          }}
        >
          {verifyStatus.ok ? '✓ ' : '✕ '} {verifyStatus.message}
        </div>
      )}

      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}

      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || !ready}
        submitLabel="create"
        submitBusyLabel="creating"
        onCancel={() => { props.onClose(committed) }}
        onSubmit={() => { void create() }}
      />
    </div>
  )
}
