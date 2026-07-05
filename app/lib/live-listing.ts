import { DataType, type FileListing } from '@/components/file-listing/model'
import { getFolderMarkerPrefix, isFolderMarkerKey } from '~/prefix'

type R2ListForListing = Pick<R2Objects, 'delimitedPrefixes' | 'objects'>

export const buildLiveFileListing = (
  listResult: R2ListForListing,
): FileListing[] => {
  const folderKeys = new Set([
    ...listResult.delimitedPrefixes,
    ...listResult.objects
      .filter((object) => isFolderMarkerKey(object.key))
      .map((object) => getFolderMarkerPrefix(object.key)),
  ])

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
