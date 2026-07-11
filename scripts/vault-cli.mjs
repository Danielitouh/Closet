#!/usr/bin/env node
// Closet vault CLI — read/write the end-to-end-encrypted wiki from a repo
// clone. Byte-compatible with app/src/lib/vault.ts.
//
// The password comes ONLY from the VAULT_PASSWORD environment variable.
//
//   VAULT_PASSWORD=... node scripts/vault-cli.mjs list
//   VAULT_PASSWORD=... node scripts/vault-cli.mjs read  --title "Some Note"
//   VAULT_PASSWORD=... node scripts/vault-cli.mjs add   --title "Some Note" --file note.md
//   VAULT_PASSWORD=... node scripts/vault-cli.mjs add   --title "Some Note" < note.md
//
// `add` writes vault/<hash>.enc in the repo; commit and push as usual.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const subtle = globalThis.crypto.subtle
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SETTINGS = join(REPO, 'settings/vault.json')
const VAULT = join(REPO, 'vault')
const ITER = 210_000
const CTX = 'closet-note:'

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (u8) => Buffer.from(u8).toString('base64')
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))

function die(msg) {
  console.error(`vault-cli: ${msg}`)
  process.exit(1)
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function material(password) {
  return subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey'])
}

async function unlock(password) {
  if (!existsSync(SETTINGS)) die('settings/vault.json not found — is the vault enabled and the clone up to date?')
  const cfg = JSON.parse(readFileSync(SETTINGS, 'utf8'))
  if (cfg.disabled) die('the vault is disabled (tombstone present).')
  const salt = unb64(cfg.salt)
  const m = await material(password)
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER + 1 }, m, 256)
  const digest = await subtle.digest('SHA-256', bits)
  if (b64(new Uint8Array(digest)) !== cfg.verifier) die('wrong password.')
  const wrapKey = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER },
    m,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(cfg.keyWrapIv) }, wrapKey, unb64(cfg.wrappedKey))
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function filenameFor(title) {
  const digest = await subtle.digest('SHA-256', enc.encode(CTX + title.trim().toLowerCase()))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 24)}.enc`
}

async function decryptFile(key, path) {
  const { iv, ct } = JSON.parse(readFileSync(path, 'utf8'))
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct))
  return JSON.parse(dec.decode(plain)) // { title, content }
}

async function encryptToFile(key, title, content) {
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(iv)
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ title, content }))))
  mkdirSync(VAULT, { recursive: true })
  const name = await filenameFor(title)
  writeFileSync(join(VAULT, name), JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) }))
  return name
}

const password = process.env.VAULT_PASSWORD
if (!password) die('set VAULT_PASSWORD in the environment (never pass it as an argument).')
const cmd = process.argv[2]
const key = await unlock(password)

if (cmd === 'list') {
  if (!existsSync(VAULT)) {
    console.log('(vault empty)')
    process.exit(0)
  }
  for (const f of readdirSync(VAULT).filter((f) => f.endsWith('.enc')).sort()) {
    const note = await decryptFile(key, join(VAULT, f))
    console.log(note.title)
  }
} else if (cmd === 'read') {
  const title = arg('title') ?? die('read needs --title')
  const path = join(VAULT, await filenameFor(title))
  if (!existsSync(path)) die(`no note titled "${title}"`)
  const note = await decryptFile(key, path)
  console.log(note.content)
} else if (cmd === 'add') {
  const title = arg('title') ?? die('add needs --title')
  const file = arg('file')
  const content = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8')
  if (!content.trim()) die('empty content.')
  const name = await encryptToFile(key, title, content)
  console.log(`encrypted "${title}" -> vault/${name}`)
} else {
  die(`unknown command "${cmd ?? ''}" — use list | read | add`)
}
