// VYRA Marketing hub (ZP-1200): contacts, consent history and CSV import. Server only.
// Nobody is ever opted in automatically: consent rows are written only from an explicit owner action
// or an explicit "yes" in the imported file (and the owner confirms the import).
import type { MarketingConsent, MarketingContact, Prisma } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import {
  CONSENT_CHANNELS, CONSENT_PURPOSES, CONSENT_STATUSES, CONTACT_SOURCES, consentSummary, latestConsent, normalizeEmail, normalizePhone, parseConsentCell,
  type ConsentChannel, type ConsentStatus,
} from './consent'
import { writeConsent } from './consent-records'
import { asObject, onlyKeys, oneOf, requiredText, text } from './validate'

export type ContactDto = Omit<MarketingContact, 'shopKey'> & {
  /** Promotional permission per channel. */
  consent: Record<ConsentChannel, ConsentStatus | 'NONE'>
  /** MM-12: permission for review and feedback requests per channel, kept apart from promotion. */
  feedbackConsent: Record<ConsentChannel, ConsentStatus | 'NONE'>
}
export type ConsentDto = MarketingConsent

const SHOP = 'vyra'

const toDto = (c: MarketingContact & { consents: MarketingConsent[] }): ContactDto => {
  const { consents, shopKey: _shopKey, ...rest } = c
  void _shopKey
  return { ...rest, consent: consentSummary(consents), feedbackConsent: consentSummary(consents, 'FEEDBACK') }
}

const bad = (m: string, field: string) => new WebsiteError(400, m, { field })

function parseDetails(o: Record<string, unknown>): { name?: string | null; phone?: string | null; email?: string | null; notes?: string | null } {
  const out: { name?: string | null; phone?: string | null; email?: string | null; notes?: string | null } = {}
  if ('name' in o) out.name = text(o.name, 'name', 120)
  if ('notes' in o) out.notes = text(o.notes, 'notes', 1000)
  if ('phone' in o) {
    const raw = text(o.phone, 'phone', 40)
    if (raw === null) out.phone = null
    else {
      const p = normalizePhone(raw)
      if (!p) throw bad('That does not look like a phone number. Use the full number, for example +263 77 123 4567 or 077 123 4567.', 'phone')
      out.phone = p
    }
  }
  if ('email' in o) {
    const raw = text(o.email, 'email', 254)
    if (raw === null) out.email = null
    else {
      const e = normalizeEmail(raw)
      if (!e) throw bad('That does not look like an email address.', 'email')
      out.email = e
    }
  }
  return out
}

async function assertFree(db: Db, d: { phone?: string | null; email?: string | null }, exceptId?: number) {
  if (d.phone) {
    const x = await db.marketingContact.findFirst({ where: { shopKey: SHOP, phone: d.phone, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })
    if (x) throw new WebsiteError(409, 'Someone with this phone number is already in your contacts.', { field: 'phone', contactId: x.id })
  }
  if (d.email) {
    const x = await db.marketingContact.findFirst({ where: { shopKey: SHOP, email: d.email, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })
    if (x) throw new WebsiteError(409, 'Someone with this email address is already in your contacts.', { field: 'email', contactId: x.id })
  }
}

export interface ContactFilter { q?: string | null; source?: string | null; channel?: string | null; status?: string | null; limit?: number; offset?: number }

/** Contacts, newest first. `channel` + `status` ('OPTED_IN' | 'OPTED_OUT' | 'NONE') filter on the latest consent. */
export async function listContacts(db: Db, f: ContactFilter = {}): Promise<{ contacts: ContactDto[]; total: number }> {
  const where: Prisma.MarketingContactWhereInput = { shopKey: SHOP }
  const q = (f.q ?? '').trim().slice(0, 80)
  if (q) {
    const digits = q.replace(/[^\d+]/g, '')
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits.replace(/^0/, '') } }] : []),
    ]
  }
  if (f.source) where.source = oneOf(f.source, 'source', CONTACT_SOURCES)
  const limit = Math.min(Math.max(Math.trunc(f.limit ?? 200) || 200, 1), 500)
  const offset = Math.max(Math.trunc(f.offset ?? 0) || 0, 0)
  const channel = f.channel ? oneOf(f.channel, 'channel', CONSENT_CHANNELS) : null
  const status = f.status ? oneOf(f.status, 'status', [...CONSENT_STATUSES, 'NONE'] as const) : null
  if (channel && status) {
    // The latest row decides, so filter after loading consents (lists are small).
    const all = await db.marketingContact.findMany({ where, include: { consents: true }, orderBy: { id: 'desc' }, take: 5000 })
    const kept = all.filter((c) => (consentSummary(c.consents)[channel] === status))
    return { contacts: kept.slice(offset, offset + limit).map(toDto), total: kept.length }
  }
  const [rows, total] = await Promise.all([
    db.marketingContact.findMany({ where, include: { consents: true }, orderBy: { id: 'desc' }, take: limit, skip: offset }),
    db.marketingContact.count({ where }),
  ])
  return { contacts: rows.map(toDto), total }
}

export async function getContact(db: Db, id: number): Promise<{ contact: ContactDto; history: ConsentDto[] }> {
  const c = await db.marketingContact.findUnique({ where: { id }, include: { consents: true } })
  if (!c || c.shopKey !== SHOP) throw new WebsiteError(404, 'Contact not found')
  const history = [...c.consents].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.id - a.id)
  return { contact: toDto(c), history }
}

/** Create a contact. It starts with NO consent for any channel. */
export async function createContact(db: Db, body: unknown, actor: string, source: string = 'MANUAL'): Promise<ContactDto> {
  const o = asObject(body)
  onlyKeys(o, ['name', 'phone', 'email', 'notes', 'source'])
  const d = parseDetails(o)
  if (!d.phone && !d.email) throw new WebsiteError(400, 'Give a phone number or an email address.', { field: 'phone' })
  const src = 'source' in o ? oneOf(o.source, 'source', CONTACT_SOURCES) : (source as (typeof CONTACT_SOURCES)[number])
  await assertFree(db, d)
  const c = await db.marketingContact.create({ data: { shopKey: SHOP, ...d, source: src, createdBy: actor }, include: { consents: true } })
  await writeAudit(db, { actor, action: 'contact.create', entity: 'contact', entityId: c.id, detail: { source: src } })
  return toDto(c)
}

export async function updateContact(db: Db, id: number, body: unknown, actor: string): Promise<ContactDto> {
  const o = asObject(body)
  onlyKeys(o, ['name', 'phone', 'email', 'notes'])
  const before = await db.marketingContact.findUnique({ where: { id } })
  if (!before || before.shopKey !== SHOP) throw new WebsiteError(404, 'Contact not found')
  const d = parseDetails(o)
  if (Object.keys(d).length === 0) throw new WebsiteError(400, 'Nothing to change.')
  const phone = 'phone' in d ? d.phone : before.phone
  const email = 'email' in d ? d.email : before.email
  if (!phone && !email) throw new WebsiteError(400, 'A contact needs a phone number or an email address.', { field: 'phone' })
  await assertFree(db, d, id)
  const c = await db.marketingContact.update({ where: { id }, data: d, include: { consents: true } })
  await writeAudit(db, { actor, action: 'contact.update', entity: 'contact', entityId: id, detail: { fields: Object.keys(d) } })
  return toDto(c)
}

/** Add one consent history row (the latest row wins). The method says how it was given. */
export async function recordConsent(db: Db, contactId: number, body: unknown, actor: string): Promise<ContactDto> {
  const o = asObject(body)
  onlyKeys(o, ['channel', 'purpose', 'status', 'method', 'evidence'])
  const channel = oneOf(o.channel, 'channel', CONSENT_CHANNELS)
  const purpose = o.purpose === undefined ? 'PROMOTION' : oneOf(o.purpose, 'purpose', CONSENT_PURPOSES)
  const status = oneOf(o.status, 'status', CONSENT_STATUSES)
  const method = requiredText(o.method, 'method', 300)
  const evidence = text(o.evidence, 'evidence', 1000)
  const c = await db.marketingContact.findUnique({ where: { id: contactId } })
  if (!c || c.shopKey !== SHOP) throw new WebsiteError(404, 'Contact not found')
  if (status === 'OPTED_IN') {
    if (channel === 'EMAIL' && !c.email) throw bad('This contact has no email address, so they cannot opt in to email.', 'channel')
    if (channel !== 'EMAIL' && !c.phone) throw bad('This contact has no phone number, so they cannot opt in to this channel.', 'channel')
  }
  // MM-12: restoration needs new evidence; an opt-out takes them off waiting messages at once.
  await writeConsent(db, { contactId, channel, purpose, status, method, evidence, recordedBy: actor })
  return (await getContact(db, contactId)).contact
}

// ---------------------------------------------------------------- CSV import

/** Small CSV reader: quotes, doubled quotes, commas or semicolons, CRLF, BOM. */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^﻿/, '')
  const firstLine = s.split(/\r?\n/, 1)[0] ?? ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++ } else quoted = false } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else cur += ch
  }
  row.push(cur)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

const HEADER_ALIASES: Record<string, string> = {
  name: 'name', 'full name': 'name', fullname: 'name', customer: 'name',
  phone: 'phone', mobile: 'phone', cell: 'phone', 'phone number': 'phone', number: 'phone', whatsapp_number: 'phone',
  email: 'email', 'e-mail': 'email', 'email address': 'email',
  notes: 'notes', note: 'notes',
  whatsapp_consent: 'WHATSAPP', sms_consent: 'SMS', email_consent: 'EMAIL',
  consent_method: 'method', consent_evidence: 'evidence',
}

export interface ImportRowPlan {
  line: number
  name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  action: 'create' | 'update' | 'skip'
  existingId?: number
  /** Why a row is skipped, or something to know about it. */
  problems: string[]
  /** Consent rows this row will write. */
  consent: { channel: ConsentChannel; status: ConsentStatus; method: string; evidence: string | null }[]
}

export interface ImportPlan {
  rows: ImportRowPlan[]
  hasConsentColumns: boolean
  consentColumns: string[]
  totals: { create: number; update: number; skip: number; optIns: number; optOuts: number; ignoredOptIns: number }
}

export const IMPORT_MAX_ROWS = 2000
export const IMPORT_MAX_CHARS = 600_000

/**
 * Work out what an import would do, writing nothing. Consent is taken ONLY from an explicit consent column
 * (whatsapp_consent, sms_consent, email_consent). Without one every row is created with no consent at all.
 * A "yes" never overrides an existing opt-out.
 */
export async function planImport(db: Db, csv: string, fileName = 'the file'): Promise<ImportPlan> {
  if (typeof csv !== 'string' || csv.trim() === '') throw new WebsiteError(400, 'The file is empty.', { field: 'csv' })
  if (csv.length > IMPORT_MAX_CHARS) throw new WebsiteError(400, 'The file is too big. Import up to 2000 contacts at a time.', { field: 'csv' })
  const table = parseCsv(csv)
  if (table.length < 2) throw new WebsiteError(400, 'The file needs a header row (name, phone, email ...) and at least one contact.', { field: 'csv' })
  if (table.length - 1 > IMPORT_MAX_ROWS) throw new WebsiteError(400, 'Import up to 2000 contacts at a time.', { field: 'csv' })
  const cols: Record<string, number> = {}
  table[0].forEach((h, i) => {
    const key = HEADER_ALIASES[h.trim().toLowerCase()]
    if (key && !(key in cols)) cols[key] = i
  })
  if (!('phone' in cols) && !('email' in cols)) throw new WebsiteError(400, 'The first row must name a "phone" or an "email" column.', { field: 'csv' })
  const consentColumns = CONSENT_CHANNELS.filter((c) => c in cols)
  const cell = (r: string[], k: string) => (k in cols ? (r[cols[k]] ?? '').trim() : '')

  const rows: ImportRowPlan[] = []
  const seenPhone = new Set<string>()
  const seenEmail = new Set<string>()
  const totals = { create: 0, update: 0, skip: 0, optIns: 0, optOuts: 0, ignoredOptIns: 0 }

  for (let i = 1; i < table.length; i++) {
    const r = table[i]
    const problems: string[] = []
    const rawPhone = cell(r, 'phone')
    const rawEmail = cell(r, 'email')
    const phone = rawPhone ? normalizePhone(rawPhone) : null
    const email = rawEmail ? normalizeEmail(rawEmail) : null
    if (rawPhone && !phone) problems.push(`"${rawPhone.slice(0, 30)}" is not a usable phone number`)
    if (rawEmail && !email) problems.push(`"${rawEmail.slice(0, 40)}" is not a usable email address`)
    const plan: ImportRowPlan = {
      line: i + 1, name: cell(r, 'name').slice(0, 120) || null, phone, email, notes: cell(r, 'notes').slice(0, 1000) || null,
      action: 'create', problems, consent: [],
    }
    if (!phone && !email) {
      if (problems.length === 0) problems.push('no phone number or email address')
      plan.action = 'skip'
    } else if ((phone && seenPhone.has(phone)) || (email && seenEmail.has(email))) {
      problems.push('appears twice in the file')
      plan.action = 'skip'
    } else {
      if (phone) seenPhone.add(phone)
      if (email) seenEmail.add(email)
      const byPhone = phone ? await db.marketingContact.findFirst({ where: { shopKey: SHOP, phone }, select: { id: true } }) : null
      const byEmail = email ? await db.marketingContact.findFirst({ where: { shopKey: SHOP, email }, select: { id: true } }) : null
      if (byPhone && byEmail && byPhone.id !== byEmail.id) {
        problems.push('the phone number and the email belong to two different contacts')
        plan.action = 'skip'
      } else if (byPhone || byEmail) {
        plan.action = 'update'
        plan.existingId = (byPhone ?? byEmail)!.id
      }
    }

    if (plan.action !== 'skip' && consentColumns.length > 0) {
      const existing = plan.existingId ? await db.marketingConsent.findMany({ where: { contactId: plan.existingId } }) : []
      for (const ch of consentColumns) {
        const answer = parseConsentCell(cell(r, ch))
        if (!answer) continue
        const needs = ch === 'EMAIL' ? email : phone
        if (!needs) { problems.push(`${ch.toLowerCase()} consent ignored: no ${ch === 'EMAIL' ? 'email address' : 'phone number'}`); if (answer === 'OPTED_IN') totals.ignoredOptIns++; continue }
        const current = latestConsent(existing, ch)?.status
        if (answer === 'OPTED_IN' && current === 'OPTED_OUT') {
          problems.push(`${ch.toLowerCase()} yes ignored: this person opted out before and stays opted out`)
          totals.ignoredOptIns++
          continue
        }
        if (current === answer) continue
        plan.consent.push({
          channel: ch, status: answer,
          method: cell(r, 'method').slice(0, 300) || `Marked "${answer === 'OPTED_IN' ? 'yes' : 'no'}" in the imported file ${fileName.slice(0, 80)}`,
          evidence: cell(r, 'evidence').slice(0, 1000) || null,
        })
        if (answer === 'OPTED_IN') totals.optIns++
        else totals.optOuts++
      }
    }
    totals[plan.action]++
    rows.push(plan)
  }
  return { rows, hasConsentColumns: consentColumns.length > 0, consentColumns, totals }
}

export async function previewImport(db: Db, body: unknown): Promise<ImportPlan> {
  const o = asObject(body)
  onlyKeys(o, ['csv', 'fileName', 'confirmConsent', 'commit'])
  return planImport(db, o.csv as string, text(o.fileName, 'fileName', 120) ?? 'the file')
}

/**
 * Write an import. If it would record any opt-in the owner must have confirmed ("confirmConsent": true).
 * Audited with the file name and the counts. New contacts start with no consent unless the file says yes.
 */
export async function commitImport(db: Db, body: unknown, actor: string): Promise<{ plan: Pick<ImportPlan, 'totals'>; created: number; updated: number }> {
  const o = asObject(body)
  onlyKeys(o, ['csv', 'fileName', 'confirmConsent', 'commit'])
  const fileName = text(o.fileName, 'fileName', 120) ?? 'the file'
  const plan = await planImport(db, o.csv as string, fileName)
  if (plan.totals.optIns > 0 && o.confirmConsent !== true) {
    throw new WebsiteError(409, `This file says "yes" for ${plan.totals.optIns} consent${plan.totals.optIns === 1 ? '' : 's'}. Tick the box to confirm these people really agreed to hear from you on that channel.`, { field: 'confirmConsent' })
  }
  let created = 0
  let updated = 0
  for (const r of plan.rows) {
    if (r.action === 'skip') continue
    let id = r.existingId
    if (r.action === 'create') {
      const c = await db.marketingContact.create({ data: { shopKey: SHOP, name: r.name, phone: r.phone, email: r.email, notes: r.notes, source: 'IMPORT', createdBy: actor } })
      id = c.id
      created++
    } else {
      const cur = await db.marketingContact.findUnique({ where: { id } })
      if (cur) {
        await db.marketingContact.update({
          where: { id: cur.id },
          // Only fill what is empty: an import never overwrites what you typed yourself.
          data: { name: cur.name ?? r.name, phone: cur.phone ?? r.phone, email: cur.email ?? r.email, notes: cur.notes ?? r.notes },
        })
      }
      updated++
    }
    for (const c of r.consent) {
      // A file's consent column is about promotion. Restoration after an opt-out is already refused by the plan.
      await writeConsent(db, { contactId: id as number, channel: c.channel, purpose: 'PROMOTION', status: c.status, method: c.method, evidence: c.evidence, recordedBy: actor }, { via: 'import' })
    }
  }
  await writeAudit(db, { actor, action: 'contacts.import', entity: 'contacts', detail: { fileName, created, updated, skipped: plan.totals.skip, optIns: plan.totals.optIns, optOuts: plan.totals.optOuts, ignoredOptIns: plan.totals.ignoredOptIns, consentColumns: plan.consentColumns } })
  return { plan: { totals: plan.totals }, created, updated }
}
