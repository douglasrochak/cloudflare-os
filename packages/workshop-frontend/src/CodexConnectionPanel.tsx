import { useEffect, useRef, useState } from 'react'
import { Button, Select } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, CodexConnectionStatus, CodexLogin } from '@gadgets/workshop-shared/api'

/** Connects the current user's subscription without exposing OAuth tokens to the browser. */
export default function CodexConnectionPanel({ api, onSuccess, onBack }: {
  api: RpcStub<AuthenticatedApi>
  onSuccess: () => void
  onBack: () => void
}) {
  const [status, setStatus] = useState<CodexConnectionStatus | null>(null)
  const [login, setLogin] = useState<CodexLogin | null>(null)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const pending = useRef<string | null>(null)

  useEffect(() => {
    mounted.current = true
    api.getCodexConnection().then(value => {
      if (mounted.current) setStatus(value)
    }).catch(() => {
      if (mounted.current) setError('Could not load your connection. Go back and try again.')
    })
    return () => {
      mounted.current = false
      if (pending.current) void api.cancelCodexLogin(pending.current).catch(() => {})
    }
  }, [api])

  useEffect(() => {
    if (!login) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        if (Date.now() >= login.expiresAt) throw new Error('Your code expired. Start sign-in again.')
        const next = await api.pollCodexLogin(login.loginId)
        if (cancelled) return
        if (next.connected) {
          pending.current = null
          setLogin(null)
          setStatus(next)
        } else {
          timer = setTimeout(poll, login.intervalMs)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.')
          setLogin(null)
          void api.cancelCodexLogin(login.loginId).catch(() => {})
          pending.current = null
        }
      }
    }
    timer = setTimeout(poll, login.intervalMs)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [api, login])

  async function start() {
    setError('')
    setBusy(true)
    try {
      const next = await api.startCodexLogin()
      if (!mounted.current) {
        await api.cancelCodexLogin(next.loginId)
        return
      }
      pending.current = next.loginId
      setLogin(next)
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not start sign-in. Try again.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function add() {
    setBusy(true)
    setError('')
    try {
      await api.addCodexModel(model)
      if (mounted.current) onSuccess()
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not add this model. Try again.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setError('')
    try {
      await api.disconnectCodex()
      if (mounted.current) { setStatus({ connected: false }); setModel('') }
    } catch {
      if (mounted.current) setError('Could not disconnect. Please try again.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return <div className="space-y-4">
    <p className="text-sm text-kumo-subtle">
      Use your ChatGPT / Codex account. Usage follows your plan and its limits.
      This connection is saved only for your Cloudflare OS user.
    </p>
    {error && <p role="alert" className="text-sm text-kumo-danger">{error}</p>}
    <div aria-live="polite">
      {!status && !error && <p className="text-sm">Loading connection…</p>}
      {login && <div className="space-y-3">
        <p className="text-sm">Open OpenAI, sign in, and enter this code:</p>
        <p className="font-mono text-2xl font-semibold break-all select-all" aria-label={`Sign-in code: ${login.userCode}`}>
          {login.userCode}
        </p>
        <a href={login.verificationUri} target="_blank" rel="noopener noreferrer"
          className="inline-block text-kumo-link underline underline-offset-4 focus-visible:outline focus-visible:outline-2">
          Continue to OpenAI
        </a>
        <p className="text-sm text-kumo-subtle">Waiting for authorization. Code expires at {new Date(login.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
      </div>}
      {status?.connected && <div className="space-y-3">
        <p className="text-sm">ChatGPT / Codex connected.</p>
        <Select label="Codex model" className="w-full" value={model || undefined}
          renderValue={value => status.models?.find(item => item.id === value)?.name ?? String(value)}
          placeholder="Choose a model…" onValueChange={value => setModel(String(value))}>
          {status.models?.map(item => <Select.Option key={item.id} value={item.id}>{item.name}</Select.Option>)}
        </Select>
        <p className="text-sm text-kumo-subtle">Model availability depends on your account.</p>
        <Button variant="secondary" onClick={disconnect} disabled={busy}>Disconnect Codex</Button>
        <p className="text-xs text-kumo-subtle">Disconnecting removes your saved Codex models. Requests already running may finish.</p>
      </div>}
    </div>
    <div className="flex flex-wrap justify-end gap-2 pt-2">
      <Button variant="secondary" onClick={onBack} disabled={busy}>Back</Button>
      {status?.connected
        ? <Button variant="primary" onClick={add} disabled={busy || !model}>{busy ? 'Saving…' : 'Add Codex model'}</Button>
        : !login && <Button variant="primary" onClick={start} disabled={busy || !status}>
            {busy ? 'Starting sign-in…' : 'Sign in with ChatGPT / Codex'}
          </Button>}
    </div>
  </div>
}
