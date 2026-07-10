import { type FormEvent, useState } from 'react'

interface Props {
  onUnlock: (password: string, code: string) => Promise<void>
}

export default function SecurityGate({ onUnlock }: Props) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onUnlock(password, code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="security-screen">
      <form className="modal security-card" onSubmit={submit}>
        <header className="security-header">
          <div>
            <h1>Closet is locked</h1>
            <p>Enter your unlock password and authenticator code.</p>
          </div>
        </header>
        <label>Unlock password
          <input
            autoFocus
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>Authenticator code
          <input
            inputMode="numeric"
            pattern="[0-9 ]*"
            value={code}
            autoComplete="one-time-code"
            placeholder="123456"
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        {error && <p className="security-error">{error}</p>}
        <button className="btn primary" disabled={busy || !password || !code}>
          {busy ? 'Checking...' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
