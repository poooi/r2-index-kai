import type { ScanJob } from './jobs'

export interface IngressEnv {
  R2_INDEX_CACHE: KVNamespace
  R2_INDEX_DB: D1Database
  BUCKET_POI_DB: R2Bucket
  BUCKET_POI_NIGHTLIES: R2Bucket
  INDEX_LIVE_FALLBACK?: 'true' | 'false'
}

export interface IndexerEnv {
  R2_INDEX_DB: D1Database
  R2_INDEX_SCAN_QUEUE: Queue<ScanJob>
  BUCKET_POI_DB: R2Bucket
  BUCKET_POI_NIGHTLIES: R2Bucket
}
