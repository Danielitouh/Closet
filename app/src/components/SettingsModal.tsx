import { useState } from 'react'
import type { SyncConfig } from '../lib/github'
import { formatTotpSecret, generateTotpSecret, getOtpAuthUrl } from '../lib/twoStep'
import type { VaultConfig } from '../lib/vault'

interface Props {
  config: SyncConfig
  syncing: boolean
  lastSyncInfo: string
  twoStepConfig: VaultConfig | null
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
          <h3>Encrypted vault &amp; two-step</h3>
          {twoStepConfig ? (
            <>
              <p className="hint">
                The vault is on: notes are <b>end-to-end encrypted</b> before they reach GitHub, and
                opening this wiki requires your vault password plus a six-digit authenticator code.
                Devices with your GitHub token adopt this lock automatically on their next sync.
              </p>
              <div className="row">
                <button className="btn" onClick={onLockNow}>Lock now</button>
                <button
                  className="btn danger"
                  onClick={() => {
                    if (
                      confirm(
                        'Disable the vault? Notes stay on this device, sync pauses, and other devices will also unlock. Make sure this device has the latest notes first.',
                      )
                    )
                      onDisableTwoStep()
                  }}
                >
                  Disable vault
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">
                Create the vault: your notes get <b>end-to-end encrypted</b> with a key only your
                password unlocks — nothing readable is ever stored on GitHub or the public site, and
                sync only runs encrypted. Save the manual key in your authenticator app, choose a
                vault password, then enter the current code. Enroll once; other devices with your
                GitHub token pick up the lock automatically.
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
                  {securityBusy ? 'Verifying...' : 'Enable encrypted vault'}
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
