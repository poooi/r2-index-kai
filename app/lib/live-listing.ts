import { DataType, type FileListing } from '@/components/file-listing/model'
import { isFolderMarkerKey } from '~/prefix'

type R2ListForListing = Pick<R2Objects, 'delimitedPrefixes' | 'objects'>
type R2BucketForExistence = Pick<R2Bucket, 'head'>

export const buildLiveFileListing = (
  listResult: R2ListForListing,
): FileListing[] => {
  const folderKeys = new Set(listResult.delimitedPrefixes)

  return [
    ...[...folderKeys].map((folderKey) => ({
      key: folderKey,
      href: `/${folderKey}`,
      type: DataType.Folder,
    })),
    ...listResult.objects
      .filter((object) => !isFolderMarkerKey(object.key))
      .map((object) => ({
        key: object.key,
        href: `/${object.key}`,
        type: DataType.File,
        size: object.size,
        created: object.uploaded.getTime(),
        modified: object.uploaded.getTime(),
      })),
  ] satisfies FileListing[]
}

export const liveDirectoryExists = async (
  bucket: R2BucketForExistence,
  prefix: string,
) => {
  if (prefix === '') {
    return true
  }

  const marker = await bucket.head(prefix)
  return marker !== null && isFolderMarkerKey(marker.key)
}
