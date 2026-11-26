// ZP-1200: public product feed (RSS 2.0 with the g: namespace). 404 until the owner switches it on.
import { serveFeed } from '@/lib/marketing/feed-route'

export const dynamic = 'force-dynamic'

export const GET = (request: Request) => serveFeed(request, 'xml')
