import type { SortingFn, SortingState } from '@tanstack/react-table'

import { DataType, type FileListing } from './model'

export const defaultFileListingSorting: SortingState = [
  { id: 'modified', desc: true },
]

export const compareListingTypes = (
  listingA: FileListing,
  listingB: FileListing,
) => {
  if (listingA.type === listingB.type) {
    return 0
  }

  return listingA.type === DataType.Folder ? 1 : -1
}

export const compareOptionalNumbersAscending = (
  valueA: number | undefined,
  valueB: number | undefined,
) => {
  if (valueA === valueB) {
    return 0
  }
  if (valueA === undefined) {
    return 1
  }
  if (valueB === undefined) {
    return -1
  }

  return valueA < valueB ? -1 : 1
}

export const sortByNumber: SortingFn<FileListing> = (rowA, rowB, columnId) => {
  const typeComparison = compareListingTypes(rowA.original, rowB.original)
  if (typeComparison !== 0) {
    return typeComparison
  }

  return compareOptionalNumbersAscending(
    rowA.getValue<number | undefined>(columnId),
    rowB.getValue<number | undefined>(columnId),
  )
}

export const sortByString: SortingFn<FileListing> = (rowA, rowB, columnId) => {
  const typeComparison = compareListingTypes(rowA.original, rowB.original)
  if (typeComparison !== 0) {
    return typeComparison
  }

  return rowA
    .getValue<string>(columnId)
    .localeCompare(rowB.getValue<string>(columnId), 'en', {
      sensitivity: 'base',
      numeric: true,
    })
}
