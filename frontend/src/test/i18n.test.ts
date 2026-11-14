import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'
import hi from '../i18n/locales/hi.json'

type Tree = { [k: string]: string | Tree }
const flatten = (t: Tree, p = ''): string[] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : flatten(v, `${p}${k}.`)))

// Every non-test source file, as raw text (resolved by Vite at test time).
const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('translations', () => {
  const enKeys = new Set(flatten(en as Tree))

  it('English and Hindi have exactly the same keys', () => {
    expect(flatten(hi as Tree).sort()).toEqual([...enKeys].sort())
  })

  it('every literal t("…") key used in the code exists', () => {
    const missing: string[] = []
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    for (const [file, text] of Object.entries(sources)) {
      for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        const key = m[1]
        if (!enKeys.has(key) && !enKeys.has(`${key}_one`)) missing.push(`${file}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('Hindi values are not left in English', () => {
    const untranslated = flatten(hi as Tree).filter((k) => {
      const get = (t: Tree) => k.split('.').reduce<string | Tree>((acc, part) => (acc as Tree)[part], t)
      const v = get(hi as Tree) as string
      return v === get(en as Tree) && /[a-z]{4,}/i.test(v) && !/GovPath|^\{\{/.test(v)
    })
    expect(untranslated).toEqual([])
  })
})
