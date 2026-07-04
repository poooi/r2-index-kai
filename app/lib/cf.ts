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

export interface FolderStats {
  size: number;
  created: number;
  modified: number;
}

export interface BucketDirectoryListing {
  objects: R2Object[];
  folders: Map<string, FolderStats>;
}

export async function listDirectoryWithFolderStats(
  bucket: R2Bucket,
  options: R2ListOptions = {}
): Promise<BucketDirectoryListing> {
  // One subtree scan aggregates all immediate folder stats; avoid one R2 list per folder.
  const prefix = options.prefix ?? "";
  const objects: R2Object[] = [];
  const folders = new Map<string, FolderStats>();

  const requestOptions = {
    ...options,
    prefix,
    delimiter: undefined,
    limit: undefined,
    cursor: undefined,
  };

  let cursor = undefined;
  while (true) {
    const index = await bucket.list({
      ...requestOptions,
      cursor,
    });

    for (const object of index.objects) {
      const relativeKey = object.key.slice(prefix.length);
      if (relativeKey === "") {
        continue;
      }

      const separatorIndex = relativeKey.indexOf("/");
      if (separatorIndex === -1) {
        objects.push(object);
        continue;
      }

      const folderKey = `${prefix}${relativeKey.slice(0, separatorIndex + 1)}`;
      const uploaded = object.uploaded.getTime();
      const stats = folders.get(folderKey);

      if (stats) {
        stats.size += object.size;
        stats.created = Math.min(stats.created, uploaded);
        stats.modified = Math.max(stats.modified, uploaded);
      } else {
        folders.set(folderKey, {
          size: object.size,
          created: uploaded,
          modified: uploaded,
        });
      }
    }

    if (!index.truncated) {
      break;
    }
    cursor = index.cursor;
  }

  return {
    objects,
    folders,
  };
}

export const getBucketDataCacheKey = (prefix: string, host: string) =>
  `bucket-data:${host}:${prefix}`;

export const getR2IndexMissKey = (host: string, pathname: string) =>
  `r2-index-miss:${host}:${pathname}`;
