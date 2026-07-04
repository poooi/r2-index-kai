export async function listBucket(
  bucket: R2Bucket,
  options?: R2ListOptions
): Promise<R2Objects> {
  // List all objects in the bucket, launch new request if list is truncated
  const objects: R2Object[] = [];
  const delimitedPrefixes: string[] = [];

  // delete limit, cursor in passed options
  const requestOptions = {
    ...options,
    limit: undefined,
    cursor: undefined,
  };

  let cursor = undefined;
  while (true) {
    const index = await bucket.list({
      ...requestOptions,
      cursor,
    });
    objects.push(...index.objects);
    delimitedPrefixes.push(...index.delimitedPrefixes);
    if (!index.truncated) {
      break;
    }
    cursor = index.cursor;
  }
  return {
    objects,
    delimitedPrefixes,
    truncated: false,
  };
}

export const getBucketDataCacheKey = (prefix: string, host: string) =>
  `bucket-data:${host}:${prefix}`;

export const getR2IndexMissKey = (host: string, pathname: string) =>
  `r2-index-miss:${host}:${pathname}`;
