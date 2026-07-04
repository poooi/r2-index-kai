export enum DataType {
    File = 'file',
    Folder = 'folder',
  }

  export interface FileListing {
    key: string
    href: string
    type: DataType
    size?: number
    modified?: number
  }
