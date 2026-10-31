// Reading an .xlsx (OOXML zip) package: parts, relationships and target paths.
import { unzipSync } from 'fflate'
import { findElements } from './xml'

export type XlsxPackage = {
  /** Part path (no leading slash, e.g. "xl/media/image1.jpeg") -> bytes. */
  parts: Map<string, Uint8Array>
}

export type Relationship = { id: string; type: string; target: string; external: boolean }

/** Unzip an .xlsx file. Throws a readable error for anything that is not a zip. */
export function readXlsxPackage(bytes: Uint8Array): XlsxPackage {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (err) {
    throw new Error(`Not a readable .xlsx file (zip error: ${err instanceof Error ? err.message : String(err)})`)
  }
  const parts = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(files)) parts.set(name.replace(/^\/+/, ''), data)
  return { parts }
}

export function readPartText(pkg: XlsxPackage, path: string): string | null {
  const data = pkg.parts.get(path)
  return data ? new TextDecoder('utf-8').decode(data) : null
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

/** Resolve a relationship target relative to the part that owns the .rels file. */
export function resolvePartTarget(sourcePart: string, target: string): string {
  const raw = target.startsWith('/') ? target.slice(1) : [dirname(sourcePart), target].filter(Boolean).join('/')
  const out: string[] = []
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** Relationships of a part, keyed by id. Missing .rels file -> empty map. */
export function readRelationships(pkg: XlsxPackage, sourcePart: string): Map<string, Relationship> {
  const relsPath = [dirname(sourcePart), '_rels', `${basename(sourcePart)}.rels`].filter(Boolean).join('/')
  const xml = readPartText(pkg, relsPath)
  const rels = new Map<string, Relationship>()
  if (!xml) return rels
  for (const el of findElements(xml, 'Relationship')) {
    const { Id: id, Type: type = '', Target: target = '', TargetMode: mode } = el.attrs
    if (!id) continue
    const external = mode === 'External'
    rels.set(id, { id, type, external, target: external ? target : resolvePartTarget(sourcePart, target) })
  }
  return rels
}

/** First relationship whose Type ends with the given suffix (e.g. "/sharedStrings"). */
export function findRelByType(rels: Map<string, Relationship>, typeSuffix: string): Relationship | null {
  for (const rel of rels.values()) if (rel.type.endsWith(typeSuffix)) return rel
  return null
}
