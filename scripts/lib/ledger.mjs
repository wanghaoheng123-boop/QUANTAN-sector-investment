/**
 * Q-095 — the one way to add rows to reviews/findings-ledger.csv.
 *
 * CLAUDE.md: the ledger "IS the risk register". During the Q-088 review two
 * agents appended concurrently, one write left no trailing newline, and the
 * next row glued onto the last field — a 23-column row that swallowed a
 * CRITICAL finding, invisible to every reader. Seven more rows were malformed
 * by hand-written CSV (missing fields, unquoted commas, backslash "escapes"
 * that CSV does not have). These pure functions are what the append script
 * and the integrity guard both run, so the two cannot disagree about what a
 * row is.
 */

/** The values `severity` may take. An empty severity is not a finding. */
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

/** Columns that must carry text: without them a row cannot be acted on. */
export const REQUIRED_NON_EMPTY = ['id', 'severity', 'one_line', 'status']

/**
 * What an id may look like. `trim()` does not strip U+200B, so "WS-1" and
 * "WS-1\u200B" were two rows that look identical (red-team R2-238-2).
 */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Strict RFC 4180 parse: quoted fields may hold commas, quotes ("") and
 * newlines; a quote may only OPEN a field, and only a separator may follow a
 * closing quote.
 *
 * Throws on anything else, because each of those is a way to swallow rows
 * (red-team L1, 2026-10-17): a quote left open at end of file turns every row
 * after it into the tail of one field, and that row still has the header's
 * column count, so no column check can see it. A lenient parser reports a
 * well-formed register with a CRITICAL finding missing.
 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let quotedField = false // the current field opened with a quote
  let afterClose = false // a closing quote was just consumed
  let line = 1
  let openedAt = 0
  const fail = (what) => {
    throw new Error(`findings ledger is not valid CSV: ${what} (line ${line})`)
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false; afterClose = true }
      } else {
        if (c === '\n') line++
        field += c
      }
      continue
    }
    if (c === ',') { row.push(field); field = ''; quotedField = false; afterClose = false; continue }
    if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
      quotedField = false; afterClose = false; line++
      continue
    }
    if (c === '\r') continue
    if (afterClose) fail(`text after a closing quote in a field of row ${rows.length + 1}`)
    if (c === '"') {
      if (field !== '' || quotedField) fail('a quote in the middle of an unquoted field')
      inQuotes = true; quotedField = true; openedAt = line
      continue
    }
    field += c
  }
  if (inQuotes) {
    throw new Error(
      `findings ledger is not valid CSV: a quoted field opened on line ${openedAt} is never closed, ` +
      'so every row after it would be read as part of that field',
    )
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

/**
 * Every structural problem with the ledger text as it stands: an unparseable
 * file, or rows whose width is not the header's. An empty list means the file
 * is safe to append to.
 */
export function ledgerProblems(text) {
  let parsed
  try {
    parsed = parseCsv(text)
  } catch (e) {
    return { header: null, rows: [], problems: [e.message] }
  }
  const header = parsed[0] ?? []
  const rows = parsed.slice(1)
  const problems = []
  if (header[0] !== 'id') problems.push('the first column of the header is not `id`')
  for (const r of rows) {
    if (r.length !== header.length) problems.push(`row ${r[0]}: ${r.length} columns, expected ${header.length}`)
    // Red-team R2-238-1: an open quote CLOSED by a later stray `x",` still
    // swallows the well-formed rows between them — the two defects bracket a
    // CRITICAL finding and every column count passes. No field in the ledger
    // has ever held a newline (measured 2026-10-17), so a newline inside a
    // field is refused outright: a swallowed row always leaves one behind.
    r.forEach((f, k) => {
      if (/[\r\n]/.test(f)) problems.push(`row ${r[0]}: column ${header[k] ?? k} contains a line break, which is how a swallowed row looks`)
    })
    if (!ID_PATTERN.test(r[0].trim())) problems.push(`row ${JSON.stringify(r[0])}: id has characters outside ${ID_PATTERN}`)
  }
  return { header, rows, problems }
}

/** Quote a field only when it needs it, as RFC 4180 requires. */
export function quoteField(v) {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const formatRow = (fields) => fields.map(quoteField).join(',')

/** A row's values as written: strings, trimmed; ids carry no padding. */
export function normaliseRow(header, r) {
  const out = {}
  for (const h of header) out[h] = typeof r[h] === 'number' ? String(r[h]) : r[h]
  for (const h of header) if (typeof out[h] === 'string') out[h] = out[h].trim()
  return out
}

/**
 * Validate rows (objects keyed by header names) against the ledger as it is.
 * Returns the problems; an empty list means the rows may be appended.
 *
 * Refuses when the EXISTING file is malformed (L2): appending to a broken
 * register and then reporting the breakage after the write is how a caller
 * that trusts the exit code ends up retrying into "id already exists".
 */
export function validateNewRows(existingText, rows) {
  const { header, rows: existing, problems } = ledgerProblems(existingText)
  if (problems.length) {
    return { header, problems: problems.map((p) => `existing ledger: ${p} — repair it before appending`) }
  }
  if (!Array.isArray(rows)) return { header, problems: ['rows must be a JSON array of objects'] }
  if (rows.length === 0) return { header, problems: ['no rows given'] }

  // L4: compare trimmed ids on both sides, or " WS-1 " and "WS-1" are two rows.
  const ids = new Set(existing.map((r) => r[0].trim()))
  for (const [i, r] of rows.entries()) {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      problems.push(`row ${i}: not an object`)
      continue
    }
    const missing = header.filter((h) => !(h in r))
    const extra = Object.keys(r).filter((k) => !header.includes(k))
    if (missing.length) problems.push(`row ${i}: missing ${missing.join(', ')}`)
    if (extra.length) problems.push(`row ${i}: unknown ${extra.join(', ')}`)
    // L5: a value must be text. `null` was written as an empty severity and an
    // object as "[object Object]", both with exit 0.
    for (const h of header) {
      if (!(h in r)) continue
      const v = r[h]
      if (typeof v !== 'string' && typeof v !== 'number') problems.push(`row ${i}: ${h} must be a string, got ${v === null ? 'null' : typeof v}`)
    }
    const n = normaliseRow(header, r)
    for (const h of REQUIRED_NON_EMPTY) {
      if (header.includes(h) && typeof n[h] === 'string' && n[h] === '') problems.push(`row ${i}: empty ${h}`)
    }
    if (typeof n.severity === 'string' && n.severity !== '' && !SEVERITIES.includes(n.severity)) {
      problems.push(`row ${i}: severity ${JSON.stringify(n.severity)} is not one of ${SEVERITIES.join('/')}`)
    }
    const id = typeof n.id === 'string' ? n.id : ''
    if (id && !ID_PATTERN.test(id)) problems.push(`row ${i}: id ${JSON.stringify(id)} has characters outside ${ID_PATTERN}`)
    for (const h of header) {
      if (typeof n[h] === 'string' && /[\r\n]/.test(n[h])) problems.push(`row ${i}: ${h} contains a line break; write it on one line`)
    }
    if (id && ids.has(id)) problems.push(`row ${i}: id ${id} already exists`)
    if (id) ids.add(id)
  }
  return { header, problems }
}

/**
 * The text to append: guarantees the existing file ends with a newline first,
 * so the new row can never glue onto the previous one. Values are written
 * normalised (trimmed), matching what validateNewRows compared.
 */
export function appendText(existingText, header, rows) {
  const lead = existingText.length > 0 && !existingText.endsWith('\n') ? '\n' : ''
  return lead + rows.map((r) => {
    const n = normaliseRow(header, r)
    return formatRow(header.map((h) => n[h] ?? ''))
  }).join('\n') + '\n'
}

/**
 * After an append: every new id must now be a row of its own, and the file
 * must still be well-formed. The previous check counted columns only, so a row
 * swallowed by an open quote above it was reported as "appended".
 */
export function verifyAppended(textAfter, newIds) {
  const { rows, problems } = ledgerProblems(textAfter)
  const present = new Set(rows.map((r) => r[0].trim()))
  const absent = newIds.filter((id) => !present.has(String(id).trim()))
  return [...problems, ...absent.map((id) => `row ${id} is not in the ledger after the append`)]
}
