import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SecuritySection.module.css'

const STORAGE_KEY = 'dsh.security.config'

export interface SecurityConfig {
  enabled: boolean
  endpoint: string
  apiKey: string
  scanPrompts: boolean
  scanTools: boolean
  scanOutputs: boolean
  actionOnViolation: 'block' | 'warn'
}

const DEFAULT_CONFIG: SecurityConfig = {
  enabled: false,
  endpoint: 'http://127.0.0.1:8080/v1/inspect',
  apiKey: '',
  scanPrompts: true,
  scanTools: true,
  scanOutputs: false,
  actionOnViolation: 'block',
}

function loadConfig(): SecurityConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_CONFIG
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_CONFIG
  }
}

function saveConfig(config: SecurityConfig): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new CustomEvent('dsh:security-config-updated', { detail: config }))
}

export type SecuritySectionProps = PropsRuntime<'settings.section'>

export function SecuritySection(_props: SecuritySectionProps) {
  const [config, setConfig] = useState<SecurityConfig>(loadConfig)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [savedBadge, setSavedBadge] = useState(false)

  useEffect(() => {
    saveConfig(config)
    setSavedBadge(true)
    const t = setTimeout(() => { setSavedBadge(false) }, 2000)
    return () => { clearTimeout(t) }
  }, [config])

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    const startTime = Date.now()
    try {
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...config.apiKey ? { 'X-API-Key': config.apiKey, 'Authorization': `Bearer ${config.apiKey}` } : {},
        },
        body: JSON.stringify({
          type: 'health_check',
          ping: true,
          timestamp: new Date().toISOString(),
        }),
      })
      const latency = Date.now() - startTime
      if (res.ok || res.status === 200 || res.status === 204) {
        setConfig(prev => ({ ...prev, enabled: true }))
        setTestResult({
          ok: true,
          message: `Connected successfully! Security service is active (${latency}ms latency, HTTP ${res.status})`,
        })
      } else {
        const text = await res.text().catch(() => '')
        setTestResult({
          ok: false,
          message: `Service returned HTTP ${res.status}: ${text || res.statusText || 'Check API key & URL'}`,
        })
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `Could not connect to ${config.endpoint}: ${(err as Error).message}. Check if your security app is running.`,
      })
    } finally {
      setTesting(false)
    }
  }

  const setPort = (port: string) => {
    setConfig(prev => ({
      ...prev,
      endpoint: `http://127.0.0.1:${port}/v1/inspect`,
    }))
  }

  return (
    <div className={css.container}>
      <div className={css.header}>
        <div className={css.titleGroup}>
          <div className={css.title}>
            Security & Guardrails
          </div>
          <div className={css.subtitle}>
            Connect your custom security service or external API key to monitor,
            inspect, and protect prompts, tool calls, and model outputs.
          </div>
        </div>
        <button
          type="button"
          className={config.enabled ? css.primaryBtn : css.secondaryBtn}
          style={{ padding: '6px 14px', fontSize: 12, height: 32 }}
          onClick={() => { setConfig(prev => ({ ...prev, enabled: !prev.enabled })) }}
        >
          {config.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div className={css.card}>
        <div className={css.cardTitle}>Custom Security Service</div>

        <div className={css.field}>
          <span className={css.fieldLabel}>Security Service Endpoint</span>
          <span className={css.fieldDesc}>URL of your custom security inspection server or API gateway.</span>
          <input
            type="text"
            className={css.input}
            value={config.endpoint}
            placeholder="http://127.0.0.1:8080/v1/inspect"
            onChange={(e) => { setConfig(prev => ({ ...prev, endpoint: e.target.value })) }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)', alignSelf: 'center' }}>Quick port:</span>
            {['8080', '9000', '5000', '3000'].map(p => (
              <button key={p} type="button" className={css.presetBtn} onClick={() => { setPort(p) }}>
                :{p}
              </button>
            ))}
          </div>
        </div>

        <div className={css.field}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className={css.fieldLabel}>Security API Key</span>
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: 12, cursor: 'pointer' }}
              onClick={() => { setShowKey(!showKey) }}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <span className={css.fieldDesc}>Passed as <code>X-API-Key</code> and <code>Authorization: Bearer</code> header.</span>
          <input
            type={showKey ? 'text' : 'password'}
            className={css.input}
            value={config.apiKey}
            placeholder="sec_live_... or custom access key"
            onChange={(e) => { setConfig(prev => ({ ...prev, apiKey: e.target.value })) }}
          />
        </div>

        <div className={css.buttonRow}>
          <button
            type="button"
            className={css.primaryBtn}
            disabled={testing || !config.endpoint}
            onClick={testConnection}
          >
            {testing ? 'Connecting…' : 'Verify & Connect Service'}
          </button>
          {savedBadge && <span style={{ fontSize: 12, color: '#4ade80' }}>✓ Saved & Active</span>}
        </div>

        {testResult && (
          <div className={testResult.ok ? css.badgeSuccess : css.badgeError} style={{ marginTop: 6 }}>
            {testResult.ok ? '✓ ' : '✕ '} {testResult.message}
          </div>
        )}
      </div>

      <div className={css.card}>
        <div className={css.cardTitle}>Active Protection Checkpoints</div>

        <label className={css.checkboxRow}>
          <input
            type="checkbox"
            className={css.checkbox}
            checked={config.scanPrompts}
            onChange={(e) => { setConfig(prev => ({ ...prev, scanPrompts: e.target.checked })) }}
          />
          <div className={css.checkboxLabelGroup}>
            <span className={css.checkboxTitle}>Scan User Prompts</span>
            <span className={css.checkboxDesc}>
              Inspects incoming prompts for prompt injections, jailbreaks, and sensitive data before dispatching.
            </span>
          </div>
        </label>

        <label className={css.checkboxRow}>
          <input
            type="checkbox"
            className={css.checkbox}
            checked={config.scanTools}
            onChange={(e) => { setConfig(prev => ({ ...prev, scanTools: e.target.checked })) }}
          />
          <div className={css.checkboxLabelGroup}>
            <span className={css.checkboxTitle}>Scan Shell Commands & Tool Calls</span>
            <span className={css.checkboxDesc}>
              Intercepts terminal commands (bash, curl, rm, eval) and file operations before execution.
            </span>
          </div>
        </label>

        <label className={css.checkboxRow}>
          <input
            type="checkbox"
            className={css.checkbox}
            checked={config.scanOutputs}
            onChange={(e) => { setConfig(prev => ({ ...prev, scanOutputs: e.target.checked })) }}
          />
          <div className={css.checkboxLabelGroup}>
            <span className={css.checkboxTitle}>Scan Model Outputs</span>
            <span className={css.checkboxDesc}>
              Inspects LLM generated outputs for policy violations or sensitive data leakage before rendering.
            </span>
          </div>
        </label>
      </div>

      <div className={css.card}>
        <div className={css.cardTitle}>Action on Threat / Violation</div>
        <div className={css.field}>
          <span className={css.fieldDesc}>
            What action to take when your security service flags a payload as <code>allowed: false</code>:
          </span>
          <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio"
                name="actionOnViolation"
                checked={config.actionOnViolation === 'block'}
                onChange={() => { setConfig(prev => ({ ...prev, actionOnViolation: 'block' })) }}
              />
              <span style={{ fontWeight: 500 }}>Block Execution (Recommended)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio"
                name="actionOnViolation"
                checked={config.actionOnViolation === 'warn'}
                onChange={() => { setConfig(prev => ({ ...prev, actionOnViolation: 'warn' })) }}
              />
              <span style={{ fontWeight: 500 }}>Warn & Log Only</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
