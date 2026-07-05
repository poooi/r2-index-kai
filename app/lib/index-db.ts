import { DataType, type FileListing } from '@/components/file-listing/model'
import type { BucketName } from '~/buckets'

export type D1Queryable = Pick<D1Database, 'prepare' | 'batch'> | D1DatabaseSession

interface IndexedDirectoryRow {
  type: 'folder' | 'file'
  key: string
  size: number
  created: number | null
  modified: number | null
}

export const listIndexedDirectory = async (
  db: D1Queryable,
  bucket: BucketName,
  prefix: string,
): Promise<FileListing[]> => {
  const result = await db
    .prepare(
      `
SELECT
  'folder' AS type,
  prefix AS key,
  size,
  created_at AS created,
  modified_at AS modified
FROM folders
WHERE bucket = ? AND parent_prefix = ?

UNION ALL

SELECT
  'file' AS type,
  key,
  size,
  uploaded_at AS created,
  uploaded_at AS modified
FROM objects
WHERE bucket = ? AND parent_prefix = ?

ORDER BY type DESC, key COLLATE NOCASE
`,
    )
    .bind(bucket, prefix, bucket, prefix)
    .all<IndexedDirectoryRow>()

  return result.results.map((row) => ({
    key: row.key,
    href: `/${row.key}`,
    type: row.type === 'folder' ? DataType.Folder : DataType.File,
    size: row.size,
    created: row.created ?? undefined,
    modified: row.modified ?? undefined,
  }))
}

export const getBucketIndexStatus = async (
  db: D1Queryable,
  bucket: BucketName,
) => {
  const result = await db
    .prepare('SELECT status FROM index_buckets WHERE bucket = ?')
    .bind(bucket)
    .first<{ status: string }>()

  return result?.status
}

export const indexedDirectoryExists = async (
  db: D1Queryable,
  bucket: BucketName,
  prefix: string,
) => {
  if (prefix === '') {
    return true
  }

  const result = await db
    .prepare('SELECT 1 AS found FROM folders WHERE bucket = ? AND prefix = ?')
    .bind(bucket, prefix)
    .first<{ found: number }>()

  return result !== null
}
