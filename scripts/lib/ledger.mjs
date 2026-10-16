/**
 * Q-095 — the one way to add rows to reviews/findings-ledger.csv.
 *
 * CLAUDE.md: the ledger "IS the risk register". During the Q-088 review two
 * agents appended concurrently, one write left no trailing newline, and the
 * next row glued onto the last field — a 23-column row that swallowed a
 * CRITICAL finding, invisible to every reader. Seven more rows were malformed
 * by hand-written CSV (missing fields, unquoted commas, backslash "escapes"
 * that CSV does not have). These pure functions are what the append script
 * runs; they are unit-tested so the rules hold without a real append.
 */

/** RFC 4180 parse: quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

/** Quote a field only when it needs it, as RFC 4180 requires. */
export function quoteField(v) {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const formatRow = (fields) => fields.map(quoteField).join(',')

/**
 * Validate rows (objects keyed by header names) against the ledger as it is.
 * Returns the problems; an empty list means the rows may be appended.
 */
export function validateNewRows(existingText, rows) {
  const parsed = parseCsv(existingText)
  const header = parsed[0]
  const ids = new Set(parsed.slice(1).map((r) => r[0]))
  const problems = []
  if (!Array.isArray(rows) || rows.length === 0) problems.push('no rows given')
  for (const [i, r] of (rows ?? []).entries()) {
    const keys = Object.keys(r ?? {})
    const missing = header.filter((h) => !(h in (r ?? {})))
    const extra = keys.filter((k) => !header.includes(k))
    if (missing.length) problems.push(`row ${i}: missing ${missing.join(', ')}`)
    if (extra.length) problems.push(`row ${i}: unknown ${extra.join(', ')}`)
    const id = String(r?.id ?? '').trim()
    if (!id) problems.push(`row ${i}: empty id`)
    else if (ids.has(id)) problems.push(`row ${i}: id ${id} already exists`)
    ids.add(id)
  }
  return { header, problems }
}

/**
 * The text to append: guarantees the existing file ends with a newline first,
 * so the new row can never glue onto the previous one.
 */
export function appendText(existingText, header, rows) {
  const lead = existingText.length > 0 && !existingText.endsWith('\n') ? '\n' : ''
  return lead + rows.map((r) => formatRow(header.map((h) => r[h] ?? ''))).join('\n') + '\n'
}
