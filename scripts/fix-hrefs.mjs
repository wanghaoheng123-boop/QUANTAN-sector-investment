import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

const DOUBLE_BRACE_PATTERNS = [
  [/\$\{sector\.slug\}\}/g, '${sector.slug}'],
  [/\$\{sector\.slug\}\}/g, '${sector.slug}'],
  [/\$\{s\.slug\}\}/g, '${s.slug}'],
  [/\$\{row\.slug\}\}/g, '${row.slug}'],
  [/\$\{brief\.id\}\}/g, '${brief.id}'],
  [/\$\{t\)\.slug\}\}/g, '${t).slug}'],  // desk page has a weird one
]

function processFile(filePath) {
  const content = readFileSync(filePath, 'utf8')
  let fixed = content
  let changed = false
  
  for (const [bad, good] of DOUBLE_BRACE_PATTERNS) {
    if (bad.test(fixed)) {
      fixed = fixed.replace(bad, good)
      changed = true
      console.log(`Fixed: ${filePath} — replaced "${bad}"`)
    }
  }
  
  if (changed) {
    writeFileSync(filePath, fixed, 'utf8')
    return true
  }
  return false
}

function walkDir(dir) {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory() && !entry.includes('node_modules') && !entry.includes('.next')) {
      walkDir(full)
    } else if (extname(entry) === '.tsx' || extname(entry) === '.ts') {
      processFile(full)
    }
  }
}

walkDir(ROOT)
console.log('Done')
