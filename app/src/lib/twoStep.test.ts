import { describe, expect, it } from 'vitest'
import { enrollTwoStep, totp, unlockTwoStep, verifyTotp } from './twoStep'

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('two-step verification', () => {
  it('generates RFC-compatible TOTP codes', async () => {
    await expect(totp(RFC_SECRET, Math.floor(59 / 30))).resolves.toBe('287082')
    await expect(totp(RFC_SECRET, Math.floor(1_111_111_109 / 30))).resolves.toBe('081804')
    await expect(totp(RFC_SECRET, Math.floor(1_111_111_111 / 30))).resolves.toBe('050471')
  })

  it('accepts only valid nearby authenticator codes', async () => {
    await expect(verifyTotp(RFC_SECRET, '287 082', 59_000)).resolves.toBe(true)
    await expect(verifyTotp(RFC_SECRET, '000000', 59_000)).resolves.toBe(false)
  })

  it('enrolls with a proven code and unlocks with password plus current code', async () => {
    const code = await totp(RFC_SECRET, Math.floor(Date.now() / 1000 / 30))
    const config = await enrollTwoStep('correct horse battery', RFC_SECRET, code)

    await expect(unlockTwoStep(config, 'correct horse battery', code)).resolves.toBe(RFC_SECRET)
    await expect(unlockTwoStep(config, 'wrong horse battery', code)).rejects.toThrow(
      'Password or code was incorrect.',
    )
  })
})
