import { describe, expect, it } from 'vitest'
import {
  createVault,
  decryptNote,
  encryptNote,
  isTombstone,
  reconcileVault,
  unlockVault,
  vaultFilename,
  type VaultConfig,
  type VaultTombstone,
} from './vault'

const PASSWORD = 'a-long-vault-password'

describe('vault lifecycle', () => {
  it('creates and unlocks with the right password', async () => {
    const { config, key } = await createVault(PASSWORD, 'JBSWY3DPEHPK3PXP')
    expect(config.enabled).toBe(true)
    const unlocked = await unlockVault(config, PASSWORD)
    expect(unlocked.totpSecret).toBe('JBSWY3DPEHPK3PXP')
    // both keys decrypt the same note
    const body = await encryptNote(key, 'T', 'C')
    const note = await decryptNote(unlocked.key, body)
    expect(note).toEqual({ title: 'T', content: 'C' })
  })

  it('rejects a wrong password', async () => {
    const { config } = await createVault(PASSWORD, 'JBSWY3DPEHPK3PXP')
    await expect(unlockVault(config, 'wrong-password-123')).rejects.toThrow('Wrong password')
  })

  it('rejects passwords under 12 chars', async () => {
    await expect(createVault('short', 'S')).rejects.toThrow('12 characters')
  })
})

describe('note encryption', () => {
  it('round-trips unicode titles and content', async () => {
    const { key } = await createVault(PASSWORD, 'S')
    const body = await encryptNote(key, '小红书研究 — Émphase', '# Body\n\n[[Link]] #tag ünïcode')
    const note = await decryptNote(key, body)
    expect(note.title).toBe('小红书研究 — Émphase')
    expect(note.content).toContain('[[Link]]')
  })

  it('produces ciphertext that leaks neither title nor content', async () => {
    const { key } = await createVault(PASSWORD, 'S')
    const body = await encryptNote(key, 'Secret Plans', 'buy flowers for mum')
    expect(body).not.toContain('Secret')
    expect(body).not.toContain('flowers')
  })

  it('different vaults cannot read each other', async () => {
    const a = await createVault(PASSWORD, 'S')
    const b = await createVault(PASSWORD, 'S')
    const body = await encryptNote(a.key, 'T', 'C')
    await expect(decryptNote(b.key, body)).rejects.toThrow()
  })
})

describe('vaultFilename', () => {
  it('is deterministic and case/whitespace-insensitive', async () => {
    expect(await vaultFilename('My Note')).toBe(await vaultFilename('  my note '))
  })

  it('does not contain the title and differs across titles', async () => {
    const a = await vaultFilename('Secret Plans')
    const b = await vaultFilename('Secret Plans 2')
    expect(a).not.toContain('Secret')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f]{24}\.enc$/)
  })
})

describe('reconcileVault', () => {
  const cfg = (updatedAt: number): VaultConfig => ({
    v: 1, enabled: true, salt: 's', verifier: 'v', keyWrapIv: 'i', wrappedKey: 'w',
    totpIv: 'ti', totpCiphertext: 'tc', createdAt: 1, updatedAt,
  })
  const tomb = (updatedAt: number): VaultTombstone => ({ v: 1, disabled: true, updatedAt })

  it('adopts newer remote', () => {
    expect(reconcileVault(cfg(1), cfg(2))).toBe('adopt-remote')
    expect(reconcileVault(null, cfg(2))).toBe('adopt-remote')
  })

  it('pushes local when remote missing or older', () => {
    expect(reconcileVault(cfg(2), null)).toBe('push-local')
    expect(reconcileVault(cfg(3), cfg(2))).toBe('push-local')
  })

  it('propagates newer tombstones, resurrects over older ones', () => {
    expect(reconcileVault(cfg(1), tomb(2))).toBe('delete-local')
    expect(reconcileVault(cfg(3), tomb(2))).toBe('push-local')
    expect(reconcileVault(null, tomb(2))).toBe('none')
  })

  it('does nothing when in sync', () => {
    expect(reconcileVault(cfg(2), cfg(2))).toBe('none')
    expect(reconcileVault(null, null)).toBe('none')
  })

  it('isTombstone type guard', () => {
    expect(isTombstone(tomb(1))).toBe(true)
    expect(isTombstone(cfg(1))).toBe(false)
    expect(isTombstone(null)).toBe(false)
  })
})
