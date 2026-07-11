// End-to-end encryption for the wiki.
//
// Model: a random 256-bit *vault key* encrypts every note (AES-GCM). The
// vault key is wrapped with a key derived from the user's password
// (PBKDF2-SHA256). The wrapped key + TOTP secret travel in
// settings/vault.json; notes travel as vault/<hash>.enc with titles hidden
// inside the ciphertext and hashed filenames. Nothing readable ever reaches
// the repo or the deployed site.

export const VAULT_SETTINGS_PATH = 'settings/vault.json'
export const VAULT_DIR = 'vault'
export const VAULT_LOCAL_KEY = 'closet-wiki-vault'

const PBKDF2_ITERATIONS = 210_000
const FILENAME_CONTEXT = 'closet-note:'

export interface VaultConfig {
  v: 1
  enabled: true
  salt: string
  verifier: string
  keyWrapIv: string
  wrappedKey: string
  totpIv: string
  totpCiphertext: string
  createdAt: number
  updatedAt: number
}

export interface VaultTombstone {
  v: 1
  disabled: true
  updatedAt: number
}

export type VaultRemote = VaultConfig | VaultTombstone

export function isTombstone(x: VaultRemote | null): x is VaultTombstone {
  return !!x && (x as VaultTombstone).disabled === true
}

// --- bytes/base64 ------------------------------------------------------------

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

// --- key derivation ------------------------------------------------------------

async function passwordMaterial(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ])
}

async function deriveWrapKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await passwordMaterial(password)
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Verifier decoupled from the wrap key by using a different iteration count. */
async function deriveVerifier(password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const material = await passwordMaterial(password)
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS + 1 },
    material,
    256,
  )
  const digest = await crypto.subtle.digest('SHA-256', bits)
  return bytesToBase64(new Uint8Array(digest))
}

// --- vault lifecycle -------------------------------------------------------------

export function validateVaultPassword(password: string) {
  if (password.length < 12) throw new Error('Use at least 12 characters for the vault password.')
}

export async function createVault(
  password: string,
  totpSecret: string,
): Promise<{ config: VaultConfig; key: CryptoKey }> {
  validateVaultPassword(password)
  const salt = randomBytes(16)
  const wrapKey = await deriveWrapKey(password, salt)
  const verifier = await deriveVerifier(password, salt)

  const rawVaultKey = randomBytes(32)
  const keyWrapIv = randomBytes(12)
  const wrappedKey = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: keyWrapIv }, wrapKey, rawVaultKey),
  )
  const totpIv = randomBytes(12)
  const totpCiphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: totpIv }, wrapKey, encoder.encode(totpSecret)),
  )

  const key = await crypto.subtle.importKey('raw', rawVaultKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
  const now = Date.now()
  return {
    key,
    config: {
      v: 1,
      enabled: true,
      salt: bytesToBase64(salt),
      verifier,
      keyWrapIv: bytesToBase64(keyWrapIv),
      wrappedKey: bytesToBase64(wrappedKey),
      totpIv: bytesToBase64(totpIv),
      totpCiphertext: bytesToBase64(totpCiphertext),
      createdAt: now,
      updatedAt: now,
    },
  }
}

export async function unlockVault(
  config: VaultConfig,
  password: string,
): Promise<{ key: CryptoKey; totpSecret: string }> {
  const salt = base64ToBytes(config.salt)
  const verifier = await deriveVerifier(password, salt)
  if (verifier !== config.verifier) throw new Error('Wrong password.')
  const wrapKey = await deriveWrapKey(password, salt)
  let rawVaultKey: ArrayBuffer
  let totpBytes: ArrayBuffer
  try {
    rawVaultKey = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(config.keyWrapIv) },
      wrapKey,
      base64ToBytes(config.wrappedKey),
    )
    totpBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(config.totpIv) },
      wrapKey,
      base64ToBytes(config.totpCiphertext),
    )
  } catch {
    throw new Error('Vault data is corrupt or the password is wrong.')
  }
  const key = await crypto.subtle.importKey('raw', rawVaultKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
  return { key, totpSecret: decoder.decode(totpBytes) }
}

// --- notes ------------------------------------------------------------------------

/** Deterministic, title-hiding filename for a note. */
export async function vaultFilename(title: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(FILENAME_CONTEXT + title.trim().toLowerCase()),
  )
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 24)}.enc`
}

export async function encryptNote(key: CryptoKey, title: string, content: string): Promise<string> {
  const iv = randomBytes(12)
  const plaintext = encoder.encode(JSON.stringify({ title, content }))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  return JSON.stringify({ v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(ct) })
}

export async function decryptNote(
  key: CryptoKey,
  body: string,
): Promise<{ title: string; content: string }> {
  const parsed = JSON.parse(body) as { v: number; iv: string; ct: string }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(parsed.iv) },
    key,
    base64ToBytes(parsed.ct),
  )
  const note = JSON.parse(decoder.decode(plaintext)) as { title: string; content: string }
  if (typeof note.title !== 'string' || typeof note.content !== 'string') {
    throw new Error('Malformed note payload.')
  }
  return note
}

// --- cross-device reconciliation ------------------------------------------------------

export type VaultReconcile = 'adopt-remote' | 'push-local' | 'delete-local' | 'none'

export function reconcileVault(local: VaultConfig | null, remote: VaultRemote | null): VaultReconcile {
  const localAt = local?.updatedAt ?? 0
  const remoteAt = remote?.updatedAt ?? 0
  if (!remote) return local ? 'push-local' : 'none'
  if (isTombstone(remote)) {
    if (local && remoteAt > localAt) return 'delete-local'
    return local ? 'push-local' : 'none'
  }
  if (!local || remoteAt > localAt) return 'adopt-remote'
  if (localAt > remoteAt) return 'push-local'
  return 'none'
}

// --- local storage -----------------------------------------------------------------------

export function loadVaultConfig(): VaultConfig | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(VAULT_LOCAL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<VaultConfig>
    if (parsed.enabled === true && parsed.salt && parsed.verifier && parsed.wrappedKey) {
      return parsed as VaultConfig
    }
  } catch {
    // Corrupt state: treat as not enrolled so the user can recover.
  }
  return null
}

export function saveVaultConfig(config: VaultConfig | null) {
  if (typeof localStorage === 'undefined') return
  if (config) localStorage.setItem(VAULT_LOCAL_KEY, JSON.stringify(config))
  else localStorage.removeItem(VAULT_LOCAL_KEY)
}
