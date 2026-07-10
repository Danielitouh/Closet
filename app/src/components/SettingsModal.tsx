import { useState } from 'react'
import type { SyncConfig } from '../lib/github'
import type { TwoStepConfig } from '../lib/twoStep'
import { formatTotpSecret, generateTotpSecret, getOtpAuthUrl } from '../lib/twoStep'

interface Props {
  config: SyncConfig
  syncing: boolean
  lastSyncInfo: string
  twoStepConfig: TwoStepConfig | null
  onSave: (cfg: SyncConfig) => void
  onEnableTwoStep: (password: string, secret: string, code: string) => Promise<void>
  onDisableTwoStep: () => void
  onLockNow: () => void
  onSyncNow: () => void
  onGenerateTestNotes: (count: number) => void
  onClearTestNotes: () => void
  onExport: () => void
  onImport: (file: File) => void
  onClose: () => void
}

export default function SettingsModal({
  config,
  syncing,
  lastSyncInfo,
  twoStepConfig,
  onSave,
  onEnableTwoStep,
  onDisableTwoStep,
  onLockNow,
  onSyncNow,
  onGenerateTestNotes,
  onClearTestNotes,
  onExport,
  onImport,
  onClose,
}: Props) {
  const [token, setToken] = useState(config.token)
  const [owner, setOwner] = useState(config.owner)
  const [repo, setRepo] = useState(config.repo)
  const [branch, setBranch] = useState(config.branch)
  const [setupSecret, setSetupSecret] = useState(() => generateTotpSecret())
  const [securityPassword, setSecurityPassword] = useState('')
  const [securityCode, setSecurityCode] = useState('')
  const [securityBusy, setSecurityBusy] = useState(false)
  const [securityError, setSecurityError] = useState<string | null>(null)

  async function enableTwoStep() {
    setSecurityBusy(true)
    setSecurityError(null)
    try {
      await onEnableTwoStep(securityPassword, setupSecret, securityCode)
      setSecurityPassword('')
      setSecurityCode('')
      setSetupSecret(generateTotpSecret())
    } catch (err) {
      setSecurityError(err instanceof Error ? err.message : 'Could not enable two-step verification.')
    } finally {
      setSecurityBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Settings</h2>
          <button className="btn subtle" onClick={onClose}>✕</button>
        </header>

        <section>
          <h3>Two-step verification</h3>
          {twoStepConfig ? (
            <>
              <p className="hint">
                Two-step verification is on. Opening this wiki now requires your unlock password and a
                six-digit code from your authenticator app before notes or sync settings load.
              </p>
              <div className="row">
                <button className="btn" onClick={onLockNow}>Lock now</button>
                <button
                  className="btn danger"
                  onClick={() => {
                    if (confirm('Disable two-step verification for this browser?')) onDisableTwoStep()
                  }}
                >
                  Disable two-step
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">
                Add a local lock before this browser opens notes or GitHub sync settings. Save the
                manual key in your authenticator app, then enter the current code to turn it on.
              </p>
              <div className="secret-box">
                <span>Manual key</span>
                <code>{formatTotpSecret(setupSecret)}</code>
              </div>
              <label>Authenticator setup URI
                <input readOnly value={getOtpAuthUrl(setupSecret)} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <label>Unlock password
                <input
                  type="password"
                  value={securityPassword}
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
                  onChange={(e) => setSecurityPassword(e.target.value)}
                />
              </label>
              <label>Authenticator code
                <input
                  inputMode="numeric"
                  pattern="[0-9 ]*"
                  value={securityCode}
                  autoComplete="one-time-code"
                  placeholder="123456"
                  onChange={(e) => setSecurityCode(e.target.value)}
                />
              </label>
              {securityError && <p className="security-error">{securityError}</p>}
              <div className="row">
                <button
                  className="btn primary"
                  disabled={securityBusy || !securityPassword || !securityCode}
                  onClick={enableTwoStep}
                >
                  {securityBusy ? 'Verifying...' : 'Enable two-step'}
                </button>
                <button className="btn" onClick={() => setSetupSecret(generateTotpSecret())}>New key</button>
              </div>
            </>
          )}
        </section>

        <section>
          <h3>GitHub sync</h3>
          <p className="hint">
            Create a <b>fine-grained personal access token</b> scoped to just this repository with
            <b> Contents: Read &amp; write</b> permission (GitHub → Settings → Developer settings →
            Fine-grained tokens). The token is stored only in this browser.
          </p>
          <label>Token
            <input type="password" value={token} placeholder="github_pat_…" onChange={(e) => setToken(e.target.value)} />
          </label>
          <div className="row">
            <label>Owner
              <input value={owner} onChange={(e) => setOwner(e.target.value)} />
            </label>
            <label>Repo
              <input value={repo} onChange={(e) => setRepo(e.target.value)} />
            </label>
            <label>Branch
              <input value={branch} onChange={(e) => setBranch(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => onSave({ token, owner, repo, branch })}>Save</button>
            <button className="btn" disabled={syncing || !token} onClick={onSyncNow}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          <p className="hint">{lastSyncInfo}</p>
        </section>

        <section>
          <h3>Backup</h3>
          <div className="row">
            <button className="btn" onClick={onExport}>Export .zip</button>
            <label className="btn file-btn">
              Import .zip
              <input
                type="file"
                accept=".zip"
                hidden
                onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
              />
            </label>
          </div>
        </section>

        <section>
          <h3>Performance test</h3>
          <div className="row">
            <button className="btn" onClick={() => onGenerateTestNotes(1000)}>Generate 1,000 test notes</button>
            <button className="btn danger" onClick={onClearTestNotes}>Clear test notes</button>
          </div>
          <p className="hint">Test notes live only in this browser and are never synced.</p>
        </section>
      </div>
    </div>
  )
}
