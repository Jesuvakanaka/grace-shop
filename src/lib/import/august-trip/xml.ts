// Minimal XML helpers for the fixed, machine-written parts of an .xlsx package
// (ZP-468). The parts we read are small and regular, so a few targeted regular
// expressions are enough and avoid adding an XML parser dependency.
// Not a general XML parser: no DTDs, no CDATA, no comments inside elements.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** Decode the five XML entities plus numeric character references. */
export function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref.startsWith('#x')) return safeFromCodePoint(parseInt(ref.slice(2), 16), whole)
    if (ref.startsWith('#')) return safeFromCodePoint(parseInt(ref.slice(1), 10), whole)
    return NAMED_ENTITIES[ref] ?? whole
  })
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return fallback
  }
}

export type XmlElement = {
  /** Attributes, keyed by their qualified name (e.g. "r:id"). Values decoded. */
  attrs: Record<string, string>
  /** Raw inner XML ('' for self-closing elements). */
  inner: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Parse the attribute section of a start tag. */
export function parseAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrText))) {
    attrs[m[1]] = decodeXmlText(m[3] ?? m[4] ?? '')
  }
  return attrs
}

/**
 * All elements with the given qualified tag name, in document order.
 * Does not support an element nested inside another element of the same name,
 * which never happens for the tags we read.
 */
export function findElements(xml: string, tag: string): XmlElement[] {
  const t = escapeRegExp(tag)
  // Start tag followed by either "/>" or ">...</tag>". The (?=[\s/>]) stops
  // "<c" from matching "<cols".
  const re = new RegExp(`<${t}(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</${t}>)`, 'g')
  const out: XmlElement[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    out.push({ attrs: parseAttributes(m[1]), inner: m[2] ?? '' })
  }
  return out
}

export function findFirstElement(xml: string, tag: string): XmlElement | null {
  return findElements(xml, tag)[0] ?? null
}

/** Concatenated, decoded text of every <t> element (shared strings, inline strings). */
export function textOfRuns(innerXml: string): string {
  // Phonetic runs (<rPh>) hold reading hints, not cell text.
  const withoutPhonetic = innerXml.replace(/<rPh(?=[\s>])[\s\S]*?<\/rPh>/g, '')
  return findElements(withoutPhonetic, 't')
    .map((el) => decodeXmlText(el.inner))
    .join('')
}
