import type { BucketName } from './buckets'

export interface FullScanPageJob {
  kind: 'full-scan-page'
  bucket: BucketName
  generation: number
  cursor?: string
}

export interface CleanupStalePageJob {
  kind: 'cleanup-stale-page'
  bucket: BucketName
  generation: number
  afterKey?: string
}

export interface FinishFullScanJob {
  kind: 'finish-full-scan'
  bucket: BucketName
  generation: number
}

export interface RecomputeFoldersJob {
  kind: 'recompute-folders'
  bucket: BucketName
  prefixes: string[]
}

export interface FinalizeFullScanJob {
  kind: 'finalize-full-scan'
  bucket: BucketName
  generation: number
}

export type ScanJob =
  | FullScanPageJob
  | CleanupStalePageJob
  | FinishFullScanJob
  | RecomputeFoldersJob
  | FinalizeFullScanJob
