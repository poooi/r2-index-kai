import type { BucketName } from '../../shared/buckets'
import type {
  CleanupStalePageJob,
  FinalizeFullScanJob,
  FinishFullScanJob,
  FullScanPageJob,
  RecomputeFoldersJob,
  ScanJob,
} from '../../shared/jobs'

const RECOMPUTE_CHUNK_SIZE = 25

export const enqueueFullScan = (
  queue: Queue<ScanJob>,
  bucket: BucketName,
  generation: number,
  cursor?: string,
) =>
  queue.send({
    kind: 'full-scan-page',
    bucket,
    generation,
    cursor,
  } satisfies FullScanPageJob)

export const enqueueFinishFullScan = (
  queue: Queue<ScanJob>,
  bucket: BucketName,
  generation: number,
) =>
  queue.send({
    kind: 'finish-full-scan',
    bucket,
    generation,
  } satisfies FinishFullScanJob)

export const enqueueCleanupStalePage = (
  queue: Queue<ScanJob>,
  bucket: BucketName,
  generation: number,
  afterKey?: string,
) =>
  queue.send({
    kind: 'cleanup-stale-page',
    bucket,
    generation,
    afterKey,
  } satisfies CleanupStalePageJob)

export const enqueueFinalizeFullScan = (
  queue: Queue<ScanJob>,
  bucket: BucketName,
  generation: number,
  delaySeconds?: number,
) =>
  queue.send(
    {
      kind: 'finalize-full-scan',
      bucket,
      generation,
    } satisfies FinalizeFullScanJob,
    delaySeconds ? { delaySeconds } : undefined,
  )

export const enqueueRecomputeFolders = async (
  queue: Queue<ScanJob>,
  bucket: BucketName,
  prefixes: string[],
) => {
  const uniquePrefixes = [...new Set(prefixes)]

  for (let index = 0; index < uniquePrefixes.length; index += RECOMPUTE_CHUNK_SIZE) {
    await queue.send({
      kind: 'recompute-folders',
      bucket,
      prefixes: uniquePrefixes.slice(index, index + RECOMPUTE_CHUNK_SIZE),
    } satisfies RecomputeFoldersJob)
  }
}
