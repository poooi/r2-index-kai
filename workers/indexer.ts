import type { IndexerEnv } from '../shared/env'
import type { ScanJob } from '../shared/jobs'

import {
  cleanupStalePage,
  finalizeFullScan,
  finishFullScan,
  handleFullScanPage,
  startScheduledScans,
} from './indexer/full-scan'
import { recomputeFolders } from './indexer/folders'
import { handleR2Event, normalizeR2Event } from './indexer/r2-events'

const getRetryDelay = (attempts: number) => Math.min(300, 2 ** attempts)

const handleScanJob = async (env: IndexerEnv, job: ScanJob) => {
  switch (job.kind) {
    case 'full-scan-page':
      await handleFullScanPage(env, job)
      return
    case 'finish-full-scan':
      await finishFullScan(env, job.bucket, job.generation)
      return
    case 'cleanup-stale-page':
      await cleanupStalePage(env, job)
      return
    case 'recompute-folders':
      await recomputeFolders(env, job.bucket, job.prefixes)
      return
    case 'finalize-full-scan':
      await finalizeFullScan(env, job)
      return
  }
  throw new Error(`Unsupported scan job kind: ${(job as { kind?: unknown }).kind}`)
}

export default {
  async scheduled(_controller, env) {
    await startScheduledScans(env)
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        if (batch.queue === 'r2-index-kai-events') {
          await handleR2Event(env, normalizeR2Event(message.body))
        } else {
          await handleScanJob(env, message.body as ScanJob)
        }
        message.ack()
      } catch (error) {
        console.error('indexer job failed', {
          queue: batch.queue,
          messageId: message.id,
          attempts: message.attempts,
          error,
        })
        message.retry({ delaySeconds: getRetryDelay(message.attempts) })
      }
    }
  },
} satisfies ExportedHandler<IndexerEnv, ScanJob>
