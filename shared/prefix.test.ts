import { describe, expect, it } from 'vitest'

import {
  getAncestorPrefixes,
  getName,
  getParentPrefix,
  getPrefixUpperBound,
  isFolderMarkerKey,
  normalizeObjectKeyForIndex,
} from './prefix'

describe('prefix helpers', () => {
  it('handles a root-level key', () => {
    expect(getParentPrefix('file.zip')).toBe('')
    expect(getName('file.zip')).toBe('file.zip')
    expect(getAncestorPrefixes('file.zip')).toEqual([''])
  })

  it('handles a single-level key', () => {
    expect(getParentPrefix('a/file.zip')).toBe('a/')
    expect(getName('a/file.zip')).toBe('file.zip')
    expect(getAncestorPrefixes('a/file.zip')).toEqual(['', 'a/'])
  })

  it('handles a nested key', () => {
    expect(getParentPrefix('a/b/file.zip')).toBe('a/b/')
    expect(getName('a/b/file.zip')).toBe('file.zip')
    expect(getAncestorPrefixes('a/b/file.zip')).toEqual(['', 'a/', 'a/b/'])
  })

  it('handles unicode keys', () => {
    expect(getParentPrefix('艦/poi.txt')).toBe('艦/')
    expect(getName('艦/poi.txt')).toBe('poi.txt')
    expect(getPrefixUpperBound('艦/')).toBe('艦0')
  })

  it('normalizes trailing-slash folder marker keys', () => {
    expect(isFolderMarkerKey('a/b/')).toBe(true)
    expect(normalizeObjectKeyForIndex('a/b/')).toBe('a/b')
    expect(getParentPrefix('a/b/')).toBe('a/')
    expect(getName('a/b/')).toBe('b')
    expect(getAncestorPrefixes('a/b/')).toEqual(['', 'a/'])
  })

  it('computes prefix upper bounds', () => {
    expect(getPrefixUpperBound('a/')).toBe('a0')
    expect(getPrefixUpperBound('')).toBeNull()
  })
})
