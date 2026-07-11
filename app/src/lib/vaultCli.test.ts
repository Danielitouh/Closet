// Cross-compatibility: scripts/vault-cli.mjs must be byte-compatible with
// vault.ts — a vault created by the app must be readable/writable by the CLI
// and vice versa.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createVault, decryptNote, encryptNote, vaultFilename } from './vault'

const CLI_SRC = resolve(__dirname, '../../../scripts/vault-cli.mjs')
const PASSWORD = 'cross-compat-password!'

function setupRepo(configJson: string): string {
  const repo = mkdtempSync(join(tmpdir(), 'vault-cli-test-'))
  mkdirSync(join(repo, 'settings'), { recursive: true })
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  mkdirSync(join(repo, 'vault'), { recursive: true })
  writeFileSync(join(repo, 'settings/vault.json'), configJson)
  // The CLI resolves the repo root relative to its own path.
  writeFileSync(join(repo, 'scripts/vault-cli.mjs'), readFileSync(CLI_SRC))
  return repo
}

function cli(repo: string, args: string[], input?: string): string {
  return execFileSync('node', [join(repo, 'scripts/vault-cli.mjs'), ...args], {
    env: { ...process.env, VAULT_PASSWORD: PASSWORD },
    input,
    encoding: 'utf8',
  })
}

describe('vault-cli cross-compatibility', () => {
  it('CLI reads a note encrypted by the app', async () => {
    const { config, key } = await createVault(PASSWORD, 'JBSWY3DPEHPK3PXP')
    const repo = setupRepo(JSON.stringify(config))
    const body = await encryptNote(key, 'App Note', '# From the app\n\n[[Linked]]')
    writeFileSync(join(repo, 'vault', await vaultFilename('App Note')), body)

    expect(cli(repo, ['list']).trim()).toBe('App Note')
    expect(cli(repo, ['read', '--title', 'App Note'])).toContain('[[Linked]]')
  })

  it('app decrypts a note encrypted by the CLI', async () => {
    const { config, key } = await createVault(PASSWORD, 'JBSWY3DPEHPK3PXP')
    const repo = setupRepo(JSON.stringify(config))

    const out = cli(repo, ['add', '--title', 'CLI Note'], '# From the CLI\n\nSecret content.')
    expect(out).toContain('encrypted "CLI Note"')

    const files = readdirSync(join(repo, 'vault'))
    expect(files).toHaveLength(1)
    expect(files[0]).toBe(await vaultFilename('CLI Note'))

    const note = await decryptNote(key, readFileSync(join(repo, 'vault', files[0]), 'utf8'))
    expect(note.title).toBe('CLI Note')
    expect(note.content).toContain('Secret content.')
  })

  it('CLI rejects a wrong password', async () => {
    const { config } = await createVault(PASSWORD, 'S')
    const repo = setupRepo(JSON.stringify(config))
    expect(() =>
      execFileSync('node', [join(repo, 'scripts/vault-cli.mjs'), 'list'], {
        env: { ...process.env, VAULT_PASSWORD: 'not-the-password!' },
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow()
  })
})
