import { newTraceId } from '@/lib/infra/runAudit'

export type OptimizeJobStatus = 'completed' | 'error'

export interface OptimizeJobRecord {
  id: string
  status: OptimizeJobStatus
  createdAt: string
  finishedAt?: string
  payload?: unknown
  error?: string
}

const store = new Map<string, OptimizeJobRecord>()
const MAX_JOBS = 200

function prune() {
  if (store.size <= MAX_JOBS) return
  const oldest = [...store.entries()].sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt))
  for (const [k] of oldest.slice(0, store.size - MAX_JOBS + 20)) {
    store.delete(k)
  }
}

export function putCompletedJob(payload: unknown): OptimizeJobRecord {
  prune()
  const id = newTraceId('optjob')
  const rec: OptimizeJobRecord = {
    id,
    status: 'completed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    payload,
  }
  store.set(id, rec)
  return rec
}

export function putFailedJob(message: string): OptimizeJobRecord {
  prune()
  const id = newTraceId('optjob')
  const rec: OptimizeJobRecord = {
    id,
    status: 'error',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: message,
  }
  store.set(id, rec)
  return rec
}

export function getJob(id: string): OptimizeJobRecord | undefined {
  return store.get(id)
}
