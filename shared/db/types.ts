export interface IndexedObject {
  bucket: string
  key: string
  parent_prefix: string
  name: string
  size: number
  uploaded_at: number
  etag: string | null
  seen_generation: number
  updated_at: number
}

export interface FolderStatsRow {
  prefix: string
  created_at: number | null
  modified_at: number | null
}
