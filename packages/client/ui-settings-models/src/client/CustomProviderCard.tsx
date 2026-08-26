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

  const disabled = props.readOnly || busy
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

  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()

  const ready = displayName.trim().length > 0
    && baseURL.trim().length > 0
    && modelName.trim().length > 0
    && (keyFailure === undefined || keyFailure === 'keyBlank')

  const createOnce = async (): Promise<string | undefined> => {
    const route = deriveUniqueRoute(displayName)
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
        displayName: displayName.trim(),
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
          placeholder="e.g. Ollama, LM Studio, Custom Server"
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
          placeholder="e.g. http://127.0.0.1:11434/v1 or https://api.openai.com/v1"
          aria-label={t('baseUrl')}
          disabled={profileDisabled}
          onChange={(event) => { setBaseURL(event.target.value) }}
        />
      </div>

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('model')}</span>
        <input
          className={styles['input']}
          type="text"
          value={modelName}
          placeholder="e.g. llama3.3, qwen2.5-coder, gpt-4o, mistral"
          aria-label={t('model')}
          disabled={profileDisabled}
          onChange={(event) => { setModelName(event.target.value) }}
        />
      </div>

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>
          {t('keyInput')} <span style={{ opacity: 0.6, fontWeight: 400 }}>(Optional - leave blank if not needed)</span>
        </span>
        <input
          className={styles['input']}
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder="Enter API key or leave blank for local models"
          aria-label={t('keyInput')}
          disabled={disabled}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
        {keyFailure !== undefined && keyFailure !== 'keyBlank'
          ? <p className={styles['error']}>{t(keyFailure)}</p>
          : null}
      </div>

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
