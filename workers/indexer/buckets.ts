import { getBucketBinding, type BucketName } from '../../shared/buckets'
import type { IndexerEnv } from '../../shared/env'

export const getIndexerBucket = (env: IndexerEnv, bucket: BucketName) =>
  getBucketBinding(env, bucket)
