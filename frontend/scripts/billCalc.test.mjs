// Verifies src/lib/billCalc.js matches backend/transactions/calc.py exactly.
// Regenerate vectors: backend/venv/Scripts/python.exe frontend/scripts/gen_calc_vectors.py
import { readFileSync } from 'node:fs'
import { calcBill } from '../src/lib/billCalc.js'

const cases = JSON.parse(readFileSync(new URL('./calc-vectors.json', import.meta.url), 'utf8'))
let failures = 0
const norm = (v) => (typeof v === 'boolean' ? v : String(v))
cases.forEach((c, index) => {
  const result = calcBill(c.lines, c.options)
  const problems = []
  for (const [key, expected] of Object.entries(c.expected)) {
    const actual = key === 'manual_total' ? result.manual_total : result[key]
    // Python prints Decimal('0') for some zero fields; compare numerically
    if (typeof expected === 'boolean' ? actual !== expected : Number(expected) !== Number(actual) || !String(actual).match(/^-?\d+\.\d{2}$/)) {
      problems.push(`${key}: expected ${expected}, got ${actual}`)
    }
  }
  c.expected_lines.forEach((line, i) => {
    for (const [key, expected] of Object.entries(line)) {
      if (Number(expected) !== Number(result.lines[i][key])) problems.push(`line ${i} ${key}: expected ${expected}, got ${result.lines[i][key]}`)
    }
  })
  if (problems.length) {
    failures += 1
    if (failures <= 5) console.error(`Case ${index} failed:`, JSON.stringify(c.lines), JSON.stringify(c.options), '\n  ', problems.join('\n   '))
  }
})
console.log(`${cases.length - failures}/${cases.length} bill calculation cases match the server.`)
process.exit(failures ? 1 : 0)
