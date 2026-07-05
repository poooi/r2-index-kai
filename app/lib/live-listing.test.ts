import { describe, expect, it } from 'vitest'

import { DataType } from '@/components/file-listing/model'
import { buildLiveFileListing, liveDirectoryExists } from './live-listing'

const createObject = (key: string, size = 0) =>
  ({
    key,
    size,
    uploaded: new Date(1000),
  }) as R2Object

describe('buildLiveFileListing', () => {
  it('renders folder marker objects as folders and deduplicates prefixes', () => {
    expect(
      buildLiveFileListing({
        delimitedPrefixes: ['a/'],
        objects: [createObject('a/'), createObject('file.txt', 4)],
      }),
    ).toEqual([
      {
        key: 'a/',
        href: '/a/',
        type: DataType.Folder,
      },
      {
        key: 'file.txt',
        href: '/file.txt',
        type: DataType.File,
        size: 4,
        created: 1000,
        modified: 1000,
      },
    ])
  })

  describe('liveDirectoryExists', () => {
    it('detects empty marker-backed directories', async () => {
      await expect(
        liveDirectoryExists(
          {
            head: async () => createObject('empty/'),
          },
          'empty/',
        ),
      ).resolves.toBe(true)
    })

    it('does not treat missing marker objects as directories', async () => {
      await expect(
        liveDirectoryExists(
          {
            head: async () => null,
          },
          'missing/',
        ),
      ).resolves.toBe(false)
    })
  })

  it('ignores marker objects that are not returned as delimited prefixes', () => {
    expect(
      buildLiveFileListing({
        delimitedPrefixes: [],
        objects: [createObject('a/')],
      }),
    ).toEqual([])
  })
})
