import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Phase 3 gate: every rule in FR-1 to FR-4, FR-7 and FR-8 has an integration test whose title
// carries its id. Phase 4 adds FR-5, FR-6 and FR-9 to this list.
const required = [
  'FR-1.1',
  'FR-1.2',
  'FR-2.1',
  'FR-2.2',
  'FR-2.3',
  'FR-2.4',
  'FR-2.5',
  'FR-2.6',
  'FR-2.7',
  'FR-3.1',
  'FR-3.2',
  'FR-3.3',
  'FR-3.4',
  'FR-4.1',
  'FR-4.2',
  'FR-4.3',
  'FR-4.4',
  'FR-7.1',
  'FR-7.2',
  'FR-8.1',
  'FR-8.2',
  'FR-8.3',
]

const testDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test')

function testTitles() {
  return readdirSync(testDir)
    .filter((file) => file.endsWith('.int.test.ts'))
    .flatMap((file) => {
      const source = readFileSync(path.join(testDir, file), 'utf8')
      return [...source.matchAll(/\bit\(\s*(['"`])(.+?)\1/g)].map((m) => m[2])
    })
}

describe('functional requirements', () => {
  it('each have an integration test titled with their id', () => {
    const covered = new Set(testTitles().flatMap((title) => title.match(/FR-\d+\.\d+/g) ?? []))
    expect(required.filter((id) => !covered.has(id))).toEqual([])
  })
})
