import type { BucketName } from '~/buckets'
import type { IngressEnv } from '~/env'

interface Site {
    title: string
    bucketName: BucketName
    bucket: R2Bucket
    description: string
  }

  export const getSite = (env: IngressEnv, hostname: string) => {
    const sites: Record<string, Site> = {
      'nightlies.poi.moe': {
        title: 'poi nightlies',
        bucketName: 'poi-nightlies',
        bucket: env.BUCKET_POI_NIGHTLIES,
        description: 'poi nightly builds',
      },
      'nightly.poi.moe': {
        title: 'poi nightlies',
        bucketName: 'poi-nightlies',
        bucket: env.BUCKET_POI_NIGHTLIES,
        description: 'poi nightly builds',
      },
      'db.poi.moe': {
        title: 'poi-db monthly dumps',
        bucketName: 'poi-db',
        bucket: env.BUCKET_POI_DB,
        description: 'poi-db monthly dumps',
      },
    }

    return sites[hostname] ?? sites['db.poi.moe']
  }
