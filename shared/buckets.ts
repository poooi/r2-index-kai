export const bucketNames = ['poi-db', 'poi-nightlies'] as const

export type BucketName = (typeof bucketNames)[number]

export const isBucketName = (value: string): value is BucketName =>
  bucketNames.includes(value as BucketName)

export interface R2BucketBindings {
  BUCKET_POI_DB: R2Bucket
  BUCKET_POI_NIGHTLIES: R2Bucket
}

export const getBucketBinding = (
  env: R2BucketBindings,
  bucket: BucketName,
): R2Bucket => {
  switch (bucket) {
    case 'poi-db':
      return env.BUCKET_POI_DB
    case 'poi-nightlies':
      return env.BUCKET_POI_NIGHTLIES
  }
}
