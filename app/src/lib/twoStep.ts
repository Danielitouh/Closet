export interface TwoStepConfig {
  enabled: true
  salt: string
  verifier: string
  secretCiphertext: string
  secretIv: string
  createdAt: number
}

export const TWO_STEP_KEY = 'closet-wiki-two-step'

const ISSUER = 'Closet Wiki'
const ACCOUNT = 'Second brain'
const SECRET_BYTES = 20
const PBKDF2_ITERATIONS = 210_000
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6
const TOTP_WINDOW = 4

const encoder = new TextEncoder()
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function loadTwoStepConfig(): TwoStepConfig | null {
  try {
    const raw = localStorage.getItem(TWO_STEP_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TwoStepConfig>
    if (
      parsed.enabled === true &&
      parsed.salt &&
      parsed.verifier &&
      parsed.secretCiphertext &&
      parsed.secretIv
    ) {
      return parsed as TwoStepConfig
    }
  } catch {
    // Treat corrupt security state as not enrolled so the user can recover locally.
  }
  return null
}

export function saveTwoStepConfig(config: TwoStepConfig | null) {
  if (config) localStorage.setItem(TWO_STEP_KEY, JSON.stringify(config))
  else localStorage.removeItem(TWO_STEP_KEY)
}

export function generateTotpSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTES)
  crypto.getRandomValues(bytes)
  return base32Encode(bytes)
}

export function formatTotpSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

export function getOtpAuthUrl(secret: string): string {
  const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(ACCOUNT)}`
  const params = new URLSearchParams({
    secret,
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

export async function enrollTwoStep(password: string, secret: string, code: string): Promise<TwoStepConfig> {
  validatePassword(password)
  if (!(await verifyTotp(secret, code))) throw new Error('That authenticator code did not match.')

  const salt = randomBase64(16)
  const credential = await deriveCredential(password, salt)
  const encrypted = await encryptSecret(credential.key, secret)

  return {
    enabled: true,
    salt,
    verifier: credential.verifier,
    secretCiphertext: encrypted.ciphertext,
    secretIv: encrypted.iv,
    createdAt: Date.now(),
  }
}

export async function unlockTwoStep(config: TwoStepConfig, password: string, code: string): Promise<string> {
  const credential = await deriveCredential(password, config.salt)
  if (!timingSafeEqual(credential.verifier, config.verifier)) throw new Error('Password or code was incorrect.')

  let secret: string
  try {
    secret = await decryptSecret(credential.key, config.secretCiphertext, config.secretIv)
  } catch {
    throw new Error('Password or code was incorrect.')
  }
  if (!(await verifyTotp(secret, code))) throw new Error('Password or code was incorrect.')
  return secret
}

export async function verifyTotp(secret: string, code: string, at = Date.now()): Promise<boolean> {
  const normalized = normalizeCode(code)
  if (!/^\d{6}$/.test(normalized)) return false
  const counter = Math.floor(at / 1000 / TOTP_STEP_SECONDS)
  for (const offset of getVerificationOffsets(TOTP_WINDOW)) {
    const expected = await totp(secret, counter + offset)
    if (timingSafeEqual(expected, normalized)) return true
  }
  return false
}

export async function totp(secret: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secret)
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const counterBytes = new ArrayBuffer(8)
  const view = new DataView(counterBytes)
  view.setUint32(4, counter, false)
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes))
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

function validatePassword(password: string) {
  if (password.length < 12) throw new Error('Use at least 12 characters for the unlock password.')
}

async function deriveCredential(password: string, salt: string): Promise<{ key: CryptoKey; verifier: string }> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ])
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64ToBytes(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const verifierBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64ToBytes(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    256,
  )
  const digest = await crypto.subtle.digest('SHA-256', verifierBits)
  return { key, verifier: bytesToBase64(new Uint8Array(digest)) }
}

async function encryptSecret(key: CryptoKey, secret: string): Promise<{ ciphertext: string; iv: string }> {
  const ivBytes = new Uint8Array(12)
  crypto.getRandomValues(ivBytes)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, encoder.encode(secret))
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(ivBytes) }
}

async function decryptSecret(key: CryptoKey, ciphertext: string, iv: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

function normalizeCode(code: string): string {
  return code.replace(/[\s-]+/g, '')
}

function getVerificationOffsets(window: number): number[] {
  const offsets = [0]
  for (let i = 1; i <= window; i++) offsets.push(-i, i)
  return offsets
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s=]/g, '')
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid authenticator secret.')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(output)
}

function randomBase64(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytesToBase64(bytes)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function timingSafeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}
