export const isFolderMarkerKey = (key: string) => key !== '' && key.endsWith('/')

export const normalizeObjectKeyForIndex = (key: string) =>
  isFolderMarkerKey(key) ? key.slice(0, -1) : key

export const getParentPrefix = (key: string) => {
  const normalized = normalizeObjectKeyForIndex(key)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index + 1)
}

export const getName = (key: string) => {
  const normalized = normalizeObjectKeyForIndex(key)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

export const getAncestorPrefixes = (key: string) => {
  const prefixes = ['']
  const normalized = normalizeObjectKeyForIndex(key)
  let slash = normalized.indexOf('/')
  while (slash !== -1) {
    prefixes.push(normalized.slice(0, slash + 1))
    slash = normalized.indexOf('/', slash + 1)
  }
  return prefixes
}

export const getPrefixUpperBound = (prefix: string) => {
  if (prefix === '') {
    return null
  }

  const codePoints = Array.from(prefix)
  const last = codePoints.at(-1)
  if (last === undefined) {
    return null
  }

  const lastCodePoint = last.codePointAt(0)!
  if (lastCodePoint >= 0x10ffff) {
    return null
  }

  return `${codePoints.slice(0, -1).join('')}${String.fromCodePoint(
    lastCodePoint + 1,
  )}`
}

export const getFolderMarkerPrefix = (key: string) =>
  isFolderMarkerKey(key) ? key : `${normalizeObjectKeyForIndex(key)}/`
