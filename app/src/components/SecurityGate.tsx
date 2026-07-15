import { type FormEvent, useState } from 'react'

interface Props {
  onUnlock: (password: string, code: string) => Promise<void>
  onReset: () => Promise<{ hadRemoteVault: boolean }>
}

export default function SecurityGate({ onUnlock, onReset }: Props) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showReset, setShowReset] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetNote, setResetNote] = useState<string | null>(null)

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

  async function doReset() {
    setResetBusy(true)
    setResetNote(null)
    try {
      const { hadRemoteVault } = await onReset()
      if (hadRemoteVault) {
        // Unlock succeeded locally, but there ARE encrypted notes on GitHub
        // that this reset cannot open. Be honest about it.
        setResetNote(
          'This browser is unlocked, but notes already encrypted on GitHub can’t be opened without the original password — they are not recoverable. Any notes still on this device are back; set a new vault password to protect them going forward.',
        )
      }
      // On success the app swaps this gate out for the wiki (no remote vault).
    } catch {
      setResetNote('Reset failed. Try again.')
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <div className="security-screen">
      <form className="modal security-card" onSubmit={submit}>
        <header className="security-header">
          <div>
            <h1>Closet is locked</h1>
            <p>Enter your vault password and authenticator code to decrypt your notes.</p>
          </div>
        </header>
        <label>Vault password
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

        {!showReset ? (
          <button type="button" className="link-btn" onClick={() => setShowReset(true)}>
            Forgot your password?
          </button>
        ) : (
          <div className="reset-box">
            <p className="hint">
              <b>Resetting removes the lock from this browser only.</b> It <b>cannot</b> decrypt notes
              that are already encrypted on GitHub — those need the original password and are not
              recoverable. Use this only if your notes weren’t fully encrypted yet, or you have a
              backup.
            </p>
            {resetNote && <p className="security-error">{resetNote}</p>}
            <div className="row">
              <button type="button" className="btn danger" disabled={resetBusy} onClick={doReset}>
                {resetBusy ? 'Resetting...' : 'Reset this browser'}
              </button>
              <button type="button" className="btn subtle" onClick={() => setShowReset(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
