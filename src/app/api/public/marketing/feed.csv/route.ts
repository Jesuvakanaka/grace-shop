// ZP-1200: public product feed (CSV) for Meta Catalog / Google Merchant Center. 404 until the owner switches it on.
import { serveFeed } from '@/lib/marketing/feed-route'

export const dynamic = 'force-dynamic'

export const GET = (request: Request) => serveFeed(request, 'csv')
