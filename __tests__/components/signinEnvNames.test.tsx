/**
 * The sign-in page prints setup instructions naming the env vars an operator must
 * set. Those names are prose — nothing type-checks them against the code that
 * reads the variables, so they can drift silently and the only symptom is an
 * operator setting variables nothing reads while the page keeps insisting
 * "OAuth not configured".
 *
 * That is exactly what happened: the page said GITHUB_ID / GITHUB_SECRET from the
 * start while lib/auth.ts gated on GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET, as did
 * .env.example. Found 2026-08-14 while checking why production reports zero auth
 * providers.
 *
 * These tests read the SOURCE of all three files and assert they agree, so the
 * next drift fails here instead of costing an operator a debugging session on a
 * page that gives no feedback.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const authSrc = read('lib/auth.ts')
const pageSrc = read('app/auth/signin/page.tsx')
const envExample = read('.env.example')

/** Every process.env.X that lib/auth.ts gates a provider on. */
function providerEnvNamesReadByCode(): string[] {
  const matches = authSrc.match(/process\.env\.(GOOGLE|GITHUB)[A-Z_]*/g) ?? []
  return [...new Set(matches.map(m => m.replace('process.env.', '')))].sort()
}

describe('sign-in page env-var instructions match the code that reads them', () => {
  const codeNames = providerEnvNamesReadByCode()

  it('lib/auth.ts gates on the four provider variables', () => {
    expect(codeNames).toEqual([
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ])
  })

  for (const name of [
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  ]) {
    it(`the sign-in page instructs the operator to set ${name}`, () => {
      expect(pageSrc).toContain(name)
    })

    it(`.env.example declares ${name}`, () => {
      expect(envExample).toContain(name)
    })
  }

  it('the page does NOT instruct the operator to set variables the code never reads', () => {
    // Scan only what renders. Comments explaining the historical defect necessarily
    // contain the wrong names, and a comment is not an instruction — stripping them
    // is what keeps this test about operator-visible text.
    const rendered = pageSrc
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '') // {/* JSX comment */}
      .replace(/\/\*[\s\S]*?\*\//g, '') //          /* block comment */
      .replace(/^\s*\/\/.*$/gm, '') //              // line comment

    // The specific historical defect: GITHUB_ID / GITHUB_SECRET are NextAuth's older
    // convention and are not what lib/auth.ts reads. The negative lookahead stops
    // GITHUB_CLIENT_ID from counting as a hit for GITHUB_ID.
    for (const bogus of ['GITHUB_ID', 'GITHUB_SECRET']) {
      const standalone = new RegExp(`\\bGITHUB_(?!CLIENT_)${bogus.slice(7)}\\b`, 'g')
      const hits = rendered.match(standalone) ?? []
      expect(hits, `${bogus} is shown to the operator but nothing reads it`).toEqual([])
    }
  })

  it('NEXTAUTH_SECRET is named by both the page and .env.example', () => {
    expect(pageSrc).toContain('NEXTAUTH_SECRET')
    expect(envExample).toContain('NEXTAUTH_SECRET')
  })
})
