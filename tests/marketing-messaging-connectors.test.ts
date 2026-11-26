// ZP-1200: WhatsApp Cloud, Twilio SMS and Brevo email connectors against a fake fetch. Exact request shapes. No network, no database.
import { describe, test, beforeEach, after } from 'node:test'
import assert from 'node:assert'
import { whatsappCloudConnector } from '../src/lib/marketing/connectors/whatsapp-cloud'
import { smsTwilioConnector, SMS_STOP_LINE } from '../src/lib/marketing/connectors/sms-twilio'
import { emailBrevoConnector } from '../src/lib/marketing/connectors/email-brevo'
import { getConnector } from '../src/lib/marketing/connectors'
import { META_GRAPH_VERSION } from '../src/lib/marketing/connectors/meta-graph'
import { getChannel, CHANNELS, connectFieldsError } from '../src/lib/marketing/channels'
import { CONNECTABLE_KINDS } from '../src/lib/marketing/connect'
import type { ConnectorContext, ConnectorMessage } from '../src/lib/marketing/connectors/types'
import { WebsiteError } from '../src/lib/website/http'

const savedEnv = process.env.GRACE_MARKETING_LIVE
beforeEach(() => { process.env.GRACE_MARKETING_LIVE = 'true' })
after(() => { if (savedEnv === undefined) delete process.env.GRACE_MARKETING_LIVE; else process.env.GRACE_MARKETING_LIVE = savedEnv })

interface Call { url: string; method: string; headers: Record<string, string>; body: string | undefined }
function fake(reply: () => Response) {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: { ...(init?.headers as Record<string, string>) }, body: init?.body as string | undefined })
    return reply()
  }
  return { fn, calls }
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

const goodGate = () => ({ settings: { liveEnabled: true }, channel: { status: 'CONNECTED', credentialsEnc: 'v1:x' }, post: { approvedBy: 'owner', approvedAt: new Date() } })
const ctx = (fetchFn: ConnectorContext['fetch'], credentials: Record<string, string>, o: Partial<ConnectorContext> = {}): ConnectorContext =>
  ({ credentials, externalId: null, config: null, fetch: fetchFn, gate: goodGate(), ...o })
const msg = (o: Partial<ConnectorMessage> = {}): ConnectorMessage => ({
  to: '+263771234567', toName: 'Tendai Moyo', text: 'New pink dresses are in.\nSee https://vyra.example/p/pink?src=mkabc', subject: 'New in at VYRA',
  templateName: null, templateLanguage: 'en', templateVars: [], unsubscribeUrl: null, ...o,
})

describe('registry', () => {
  test('the three kinds have connectors, connect fields and are connectable', () => {
    for (const k of ['WHATSAPP_CLOUD', 'SMS', 'EMAIL']) {
      assert.ok(getConnector(k)?.send, k)
      assert.strictEqual(getConnector(k)?.messagesOnly, true)
      assert.strictEqual(getChannel(k)?.connector, true)
      assert.ok((getChannel(k)?.connectFields.length ?? 0) >= 2)
      assert.ok((CONNECTABLE_KINDS as readonly string[]).includes(k))
      assert.ok(getChannel(k)?.connectFields.some((f) => f.kind === 'secret'))
    }
    assert.ok(CHANNELS.length > 20)
  })
  test('apiNotes carry the facts: coexistence and cost, Zimbabwe sender IDs, unsubscribe', () => {
    const wa = getChannel('WHATSAPP_CLOUD')!.apiNotes.join(' ')
    assert.match(wa, /coexistence/i); assert.match(wa, /broadcast lists become read-only/i); assert.match(wa, /charges per marketing template/i); assert.match(wa, /template/i)
    assert.match(getChannel('SMS')!.apiNotes.join(' '), /Zimbabwe sender IDs and pricing need checking/)
    assert.match(getChannel('EMAIL')!.apiNotes.join(' '), /unsubscribe/i)
  })
  test('connect fields accept good values and refuse blanks', () => {
    const f = getChannel('SMS')!.connectFields
    assert.strictEqual(connectFieldsError(f, { accountSid: 'AC' + 'a'.repeat(32), from: '+12025550123', authToken: 'tok' }), null)
    assert.ok(connectFieldsError(f, { accountSid: 'AC1', from: '', authToken: 'tok' }))
  })
})

describe('WhatsApp Cloud API', () => {
  const creds = { phoneNumberId: '109876543210', accessToken: 'WA-TOKEN-SECRET-9999' }
  test('template message: exact URL, headers and JSON', async () => {
    const f = fake(() => json({ messaging_product: 'whatsapp', contacts: [{ input: '263771234567', wa_id: '263771234567' }], messages: [{ id: 'wamid.ABC' }] }))
    const r = await whatsappCloudConnector.send!(msg({ templateName: 'new_arrivals', templateLanguage: 'en_GB', templateVars: ['Tendai', 'pink dresses'] }), ctx(f.fn, creds))
    assert.deepStrictEqual(r, { ok: true, externalId: 'wamid.ABC' })
    assert.strictEqual(f.calls.length, 1)
    const c = f.calls[0]
    assert.strictEqual(c.url, `https://graph.facebook.com/${META_GRAPH_VERSION}/109876543210/messages`)
    assert.strictEqual(c.method, 'POST')
    assert.strictEqual(c.headers.Authorization, 'Bearer WA-TOKEN-SECRET-9999')
    assert.strictEqual(c.headers['Content-Type'], 'application/json')
    assert.deepStrictEqual(JSON.parse(c.body as string), {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '263771234567', type: 'template',
      template: { name: 'new_arrivals', language: { code: 'en_GB' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Tendai' }, { type: 'text', text: 'pink dresses' }] }] },
    })
    assert.ok(!c.url.includes('SECRET'))
  })
  test('a template without fields has no components', async () => {
    const f = fake(() => json({ messages: [{ id: 'w1' }] }))
    await whatsappCloudConnector.send!(msg({ templateName: 'hello' }), ctx(f.fn, creds))
    assert.strictEqual(JSON.parse(f.calls[0].body as string).template.components, undefined)
  })
  test('no template name: refused with zero requests (free text is not allowed)', async () => {
    const f = fake(() => json({}))
    const r = await whatsappCloudConnector.send!(msg(), ctx(f.fn, creds))
    assert.strictEqual(r.ok, false); assert.strictEqual(f.calls.length, 0)
  })
  test('errors: token expired, rate limit, bad template, not delivered', async () => {
    const send = async (status: number, error: Record<string, unknown>) => whatsappCloudConnector.send!(msg({ templateName: 't' }), ctx(fake(() => json({ error }, status)).fn, creds))
    const dead = await send(401, { code: 190, message: 'expired' })
    assert.ok(!dead.ok && dead.code === 401 && !dead.retryable)
    const busy = await send(429, { code: 130429, message: 'rate' })
    assert.ok(!busy.ok && busy.retryable)
    const tmpl = await send(400, { code: 132001, message: 'template missing' })
    assert.ok(!tmpl.ok && !tmpl.retryable && /template/.test(tmpl.error))
    const mk = await send(400, { code: 131049, message: 'healthy ecosystem' })
    assert.ok(!mk.ok && !mk.retryable)
    for (const r of [dead, busy, tmpl, mk]) assert.ok(!(r as { error: string }).error.includes('WA-TOKEN'))
  })
  test('verify reads the phone number with the token in the header', async () => {
    const f = fake(() => json({ id: '109876543210', verified_name: 'VYRA', display_phone_number: '+263 77 123 4567' }))
    const v = await whatsappCloudConnector.verify(creds, f.fn)
    assert.deepStrictEqual(v, { ok: true, externalId: '109876543210', name: 'VYRA +263 77 123 4567' })
    assert.strictEqual(f.calls[0].url, `https://graph.facebook.com/${META_GRAPH_VERSION}/109876543210?fields=verified_name,display_phone_number`)
    assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer WA-TOKEN-SECRET-9999')
    const bad = await whatsappCloudConnector.verify(creds, fake(() => json({ error: { code: 190 } }, 401)).fn)
    assert.strictEqual(bad.ok, false)
  })
})

describe('Twilio SMS', () => {
  const creds = { accountSid: 'AC' + 'a'.repeat(32), authToken: 'TWILIO-AUTH-SECRET', from: '+12025550123' }
  test('exact request: form body, basic auth, STOP line added', async () => {
    const f = fake(() => json({ sid: 'SM123', status: 'queued' }, 201))
    const r = await smsTwilioConnector.send!(msg({ text: 'New dresses in. https://vyra.example/p/pink?src=mkabc' }), ctx(f.fn, creds))
    assert.deepStrictEqual(r, { ok: true, externalId: 'SM123' })
    const c = f.calls[0]
    assert.strictEqual(c.url, `https://api.twilio.com/2010-04-01/Accounts/AC${'a'.repeat(32)}/Messages.json`)
    assert.strictEqual(c.method, 'POST')
    assert.strictEqual(c.headers['Content-Type'], 'application/x-www-form-urlencoded')
    assert.strictEqual(c.headers.Authorization, `Basic ${Buffer.from(`AC${'a'.repeat(32)}:TWILIO-AUTH-SECRET`).toString('base64')}`)
    const form = new URLSearchParams(c.body)
    assert.deepStrictEqual([...form.keys()].sort(), ['Body', 'From', 'To'])
    assert.strictEqual(form.get('To'), '+263771234567')
    assert.strictEqual(form.get('From'), '+12025550123')
    assert.strictEqual(form.get('Body'), `New dresses in. https://vyra.example/p/pink?src=mkabc\n${SMS_STOP_LINE}`)
    assert.ok(!(c.body as string).includes('TWILIO-AUTH'))
  })
  test('a Messaging Service ID is sent as MessagingServiceSid; a text that already says STOP is not doubled', async () => {
    const f = fake(() => json({ sid: 'SM1' }, 201))
    await smsTwilioConnector.send!(msg({ text: 'Sale! Reply STOP to unsubscribe' }), ctx(f.fn, { ...creds, from: 'MG' + 'b'.repeat(32) }))
    const form = new URLSearchParams(f.calls[0].body)
    assert.strictEqual(form.get('MessagingServiceSid'), 'MG' + 'b'.repeat(32)); assert.strictEqual(form.get('From'), null)
    assert.strictEqual(form.get('Body'), 'Sale! Reply STOP to unsubscribe')
  })
  test('errors: STOP reply is reported as opted out; bad token; busy', async () => {
    const send = (status: number, body: unknown) => smsTwilioConnector.send!(msg(), ctx(fake(() => json(body, status)).fn, creds))
    const stop = await send(400, { code: 21610, message: 'unsubscribed recipient' })
    assert.ok(!stop.ok && stop.optedOut === true && !stop.retryable)
    const dead = await send(401, { code: 20003, message: 'Authenticate' })
    assert.ok(!dead.ok && dead.code === 401)
    const busy = await send(429, { code: 20429 })
    assert.ok(!busy.ok && busy.retryable)
    const bad = await send(400, { code: 21211, message: 'invalid To' })
    assert.ok(!bad.ok && !bad.retryable && !bad.optedOut)
  })
  test('invalid number or empty text: zero requests', async () => {
    const f = fake(() => json({}))
    assert.strictEqual((await smsTwilioConnector.send!(msg({ to: '0771234567' }), ctx(f.fn, creds))).ok, false)
    assert.strictEqual((await smsTwilioConnector.send!(msg({ text: '  ' }), ctx(f.fn, creds))).ok, false)
    assert.strictEqual(f.calls.length, 0)
  })
  test('verify: GET the account with basic auth', async () => {
    const f = fake(() => json({ friendly_name: 'VYRA' }))
    assert.deepStrictEqual(await smsTwilioConnector.verify(creds, f.fn), { ok: true, externalId: creds.accountSid, name: 'VYRA' })
    assert.strictEqual(f.calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}.json`)
    assert.strictEqual((await smsTwilioConnector.verify({ ...creds, accountSid: 'nope' }, f.fn)).ok, false)
  })
})

describe('Brevo email', () => {
  const creds = { apiKey: 'xkeysib-SECRET-KEY', senderEmail: 'hello@vyra.example' }
  const unsub = 'https://vyra.example/api/public/marketing/unsubscribe?t=5.EMAIL.sig'
  test('exact request: api-key header, JSON, List-Unsubscribe headers and footer link', async () => {
    const f = fake(() => json({ messageId: '<202611261200.1@smtp-relay.brevo.com>' }, 201))
    const r = await emailBrevoConnector.send!(msg({ unsubscribeUrl: unsub }), ctx(f.fn, creds))
    assert.deepStrictEqual(r, { ok: true, externalId: '<202611261200.1@smtp-relay.brevo.com>' })
    const c = f.calls[0]
    assert.strictEqual(c.url, 'https://api.brevo.com/v3/smtp/email')
    assert.strictEqual(c.method, 'POST')
    assert.strictEqual(c.headers['api-key'], 'xkeysib-SECRET-KEY')
    assert.strictEqual(c.headers['Content-Type'], 'application/json')
    const b = JSON.parse(c.body as string)
    assert.deepStrictEqual(Object.keys(b).sort(), ['headers', 'htmlContent', 'sender', 'subject', 'textContent', 'to'])
    assert.deepStrictEqual(b.sender, { name: 'VYRA', email: 'hello@vyra.example' })
    assert.deepStrictEqual(b.to, [{ email: '+263771234567', name: 'Tendai Moyo' }])
    assert.strictEqual(b.subject, 'New in at VYRA')
    assert.deepStrictEqual(b.headers, { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    assert.ok(b.htmlContent.includes(`href="${unsub}"`)); assert.ok(b.textContent.includes(unsub))
    assert.ok(b.htmlContent.includes('New pink dresses are in.'))
  })
  test('html is escaped', async () => {
    const f = fake(() => json({ messageId: 'm' }, 201))
    await emailBrevoConnector.send!(msg({ to: 'a@b.com', text: '<script>alert(1)</script> & more', unsubscribeUrl: unsub }), ctx(f.fn, creds))
    const html = JSON.parse(f.calls[0].body as string).htmlContent as string
    assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'))
  })
  test('no unsubscribe link, no subject or no words: nothing is sent', async () => {
    const f = fake(() => json({}))
    for (const m of [msg({ to: 'a@b.com', unsubscribeUrl: null }), msg({ to: 'a@b.com', unsubscribeUrl: unsub, subject: ' ' }), msg({ to: 'a@b.com', unsubscribeUrl: unsub, text: '' })]) {
      assert.strictEqual((await emailBrevoConnector.send!(m, ctx(f.fn, creds))).ok, false)
    }
    assert.strictEqual(f.calls.length, 0)
  })
  test('errors map to plain results and never echo the key', async () => {
    const send = (status: number, body: unknown) => emailBrevoConnector.send!(msg({ to: 'a@b.com', unsubscribeUrl: unsub }), ctx(fake(() => json(body, status)).fn, creds))
    const dead = await send(401, { code: 'unauthorized', message: 'Key not found' })
    assert.ok(!dead.ok && dead.code === 401)
    const busy = await send(429, { code: 'too_many_requests', message: 'slow' })
    assert.ok(!busy.ok && busy.retryable)
    const bad = await send(400, { code: 'invalid_parameter', message: 'sender not valid' })
    assert.ok(!bad.ok && !bad.retryable && !JSON.stringify(bad).includes('xkeysib'))
  })
  test('verify: GET /v3/account with the key', async () => {
    const f = fake(() => json({ companyName: 'VYRA Ltd', email: 'a@b.com' }))
    assert.deepStrictEqual(await emailBrevoConnector.verify(creds, f.fn), { ok: true, externalId: 'hello@vyra.example', name: 'VYRA Ltd' })
    assert.strictEqual(f.calls[0].url, 'https://api.brevo.com/v3/account')
    assert.strictEqual(f.calls[0].headers['api-key'], 'xkeysib-SECRET-KEY')
  })
})

describe('every message connector fails closed: each go-live condition blocks with zero requests', () => {
  const cases: [string, Record<string, string>, ConnectorMessage][] = [
    ['WHATSAPP_CLOUD', { phoneNumberId: '1', accessToken: 't' }, msg({ templateName: 't' })],
    ['SMS', { accountSid: 'AC' + 'a'.repeat(32), authToken: 't', from: '+12025550123' }, msg()],
    ['EMAIL', { apiKey: 'k', senderEmail: 'a@b.com' }, msg({ to: 'a@b.com', unsubscribeUrl: 'https://x/u' })],
  ]
  const breakers: [string, (g: ReturnType<typeof goodGate>) => unknown, (() => void)?][] = [
    ['env off', () => undefined, () => { process.env.GRACE_MARKETING_LIVE = 'false' }],
    ['settings off', (g) => { g.settings.liveEnabled = false }],
    ['channel not connected', (g) => { g.channel.status = 'NOT_CONNECTED' }],
    ['no credentials', (g) => { g.channel.credentialsEnc = '' }],
    ['not approved', (g) => { (g.post as { approvedBy: string | null }).approvedBy = null }],
  ]
  for (const [kind, credentials, m] of cases) {
    for (const [label, mutate, pre] of breakers) {
      test(`${kind}: ${label}`, async () => {
        const f = fake(() => json({}))
        const g = goodGate()
        mutate(g)
        pre?.()
        await assert.rejects(() => getConnector(kind)!.send!(m, ctx(f.fn, credentials, { gate: g })), (e: unknown) => e instanceof WebsiteError && e.status === 409)
        assert.strictEqual(f.calls.length, 0)
      })
    }
    test(`${kind}: no gate at all`, async () => {
      const f = fake(() => json({}))
      await assert.rejects(() => getConnector(kind)!.send!(m, ctx(f.fn, credentials, { gate: undefined })), WebsiteError)
      assert.strictEqual(f.calls.length, 0)
    })
  }
})
