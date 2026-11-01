// ZP-505: the Insights report as the API returns it. Shared by the server
// (report.ts, csv.ts) and the admin page. No personal data: only totals per
// day / source / piece / photo. Rates are 0..1 (or null when there is
// nothing to divide by); seconds are means, not medians.
import type { ScoreParts } from '@/lib/ranking/score'
import type { InsightsRange } from './range'

/** Below these the page says "too few to rank" instead of ranking. */
export const THRESHOLDS = {
  /** look_view events of a piece. */
  lookViews: 20,
  /** photo_dwell events of a photo (for "best cover photo"). */
  photoDwells: 10,
  /** video_start events of a video. */
  videoStarts: 10,
  /** visits of a funnel / source segment, and of the whole range for averages. */
  visits: 20,
} as const

export const FUNNEL_STEPS = [
  'Landed',
  'Saw a 2nd look',
  'Show details',
  'Opened a piece',
  'Chose a size',
  'WhatsApp',
] as const

export type SourceShare = { source: string; visits: number; share: number | null }

export type Overview = {
  visits: number
  newVisits: number
  returningVisits: number
  /** Visits with a visit_end (the averages are over these). */
  endedVisits: number
  looksPerVisit: number | null
  avgSeconds: number | null
  bounceRate: number | null
  whatsappTaps: number
  enquiringVisits: number
  restockRequests: number
  topSources: SourceShare[]
  enough: boolean
}

export type LookRow = {
  productId: number
  name: string
  slug: string
  thumbnail: string | null
  views: number
  viewers: number
  meanDwell: number | null
  /** Visits that swiped to a 2nd photo / visits that saw the look. */
  photoSwipeRate: number | null
  /** Show details taps per look view. */
  detailsRate: number | null
  /** Visits that opened the piece (product page or ZP-510 details sheet) / visits that saw the look. */
  openRate: number | null
  whatsapp: number
  shares: number
  restockRequests: number
  /** loveOn - loveOff in the range (hearts, ZP-507). */
  hearts: number
  /**
   * ZP-506: the popularity score from the latest nightly run (100 = average
   * look; last 28 days, decayed, not the selected range). null before the
   * piece was first ranked (not public at the last run).
   */
  popularity: number | null
  /** ZP-506: position in today's feed (null while the feed is newest first). */
  rank: number | null
  /** ZP-506: why it scores what it does. */
  scoreParts: ScoreParts | null
  /** ZP-506: got the new-piece boost today. */
  coldStart: boolean
  /** ZP-506: picked for the automatic Featured set. */
  autoFeatured: boolean
  enough: boolean
}

/** ZP-506: the latest ranking run, for the Top looks note. */
export type RankingStatus = {
  mode: 'AUTO' | 'NEWEST'
  /** false: too little data, the feed is newest first. */
  ranked: boolean
  day: string
  computedAt: string
}

export type PhotoRow = {
  /** Position in the gallery when it was seen (1 = first). */
  index: number
  /** Stored file name "<32 hex>.webp", "" when the event did not say. */
  image: string
  url: string | null
  views: number
  viewers: number
  dwellCount: number
  meanSeconds: number | null
  /** Share of the piece's viewers who saw this photo. */
  reach: number | null
  isCover: boolean
  enough: boolean
}

export type PiecePhotos = {
  productId: number
  name: string
  slug: string
  viewers: number
  photos: PhotoRow[]
  /** The photo that holds people longest, when it is not the cover already and has enough data. */
  bestCover: {
    image: string
    index: number
    url: string | null
    meanSeconds: number
    /** ZP-506: the gallery image id, for "Use as first photo"; null when the photo is no longer in the gallery. */
    imageId: number | null
  } | null
}

export type VideoRow = {
  productId: number
  name: string
  slug: string
  thumbnail: string | null
  starts: number
  viewers: number
  /** Share of starts that reached 25 / 50 / 75 / 100 %. */
  completion: [number | null, number | null, number | null, number | null]
  avgSeconds: number | null
  replays: number
  enough: boolean
}

export type FunnelSegment = {
  key: string
  /** Visits reaching each of FUNNEL_STEPS (furthest step). */
  counts: number[]
  /** Share lost from the step before (null for the first step or when the step before is 0). */
  lost: (number | null)[]
  enough: boolean
}

export type Funnel = {
  steps: readonly string[]
  all: FunnelSegment
  byDevice: FunnelSegment[]
  bySource: FunnelSegment[]
}

export type Depth = {
  visits: number
  /** Visits that reached look 1..N (N = deepest seen, capped). */
  reach: { look: number; visits: number; share: number | null }[]
  /** The deepest bucket means "this many or more". */
  capped: boolean
  endOfFeedVisits: number
  endOfFeedRate: number | null
}

export type OptionCount = { value: string; selects: number; enquiries: number; restockRequests: number }

export type Demand = {
  /** Pieces with restock requests in the range (asked while sold out); soldOutNow = no stock today. */
  soldOut: {
    productId: number
    name: string
    slug: string
    thumbnail: string | null
    soldOutNow: boolean
    restockRequests: number
    sizes: { value: string; count: number }[]
  }[]
  options: { productId: number; name: string; slug: string; sizes: OptionCount[]; colours: OptionCount[] }[]
  askForPrice: { productId: number; name: string; slug: string; views: number; enquiries: number; rate: number | null }[]
}

export type SourceRow = { source: string; visits: number; enquiringVisits: number; whatsappTaps: number; share: number | null; enough: boolean }

export type Sources = {
  bySource: SourceRow[]
  byCampaign: { source: string; campaign: string; visits: number; enquiringVisits: number; whatsappTaps: number; enough: boolean }[]
  /** Non-empty cells only. weekday 1 = Monday .. 7 = Sunday (ISO); hour 0-23 Harare (visit start). */
  heatmap: { weekday: number; hour: number; visits: number; whatsappTaps: number }[]
}

export type Health = {
  days: { day: string; slowLoads: number; loadErrors: number; failedActions: number }[]
  byDetail: { kind: string; detail: string; events: number; visits: number }[]
}

/** ZP-508 reviews: counts only (no text, names or photos). Weeks start on Monday, Harare time. */
export type ReviewsSummary = {
  /** Reviews submitted in the range (any status). */
  received: number
  approved: number
  /** Mean stars of the approved reviews submitted in the range. */
  averageStars: number | null
  /** Waiting for the owner right now (any submission date). */
  pendingNow: number
  perWeek: { week: string; received: number; approved: number }[]
}

export type InsightsReport = {
  range: InsightsRange & {
    /** Days computed from raw events for this answer (today; yesterday before the nightly rollup ran). Read-only. */
    liveDays: string[]
    /** Live days whose query failed (e.g. timed out): left out of the numbers. */
    liveUnavailable: string[]
    /** Days rolled up before the ZP-505 rollups existed: no funnel / depth / hour / health / option rows yet. */
    notRecalculated: string[]
    generatedAt: string
  }
  thresholds: typeof THRESHOLDS
  overview: Overview
  /** ranking (ZP-506): the latest nightly ranking run, null before the first one. Optional for older fixtures. */
  looks: { rows: LookRow[]; hasHearts: boolean; ranking?: RankingStatus | null }
  photos: PiecePhotos[]
  videos: VideoRow[]
  funnel: Funnel
  depth: Depth
  demand: Demand
  sources: Sources
  health: Health
  reviews: ReviewsSummary
}

function emptySegment(key: string): FunnelSegment {
  return { key, counts: FUNNEL_STEPS.map(() => 0), lost: FUNNEL_STEPS.map(() => null), enough: false }
}

export function emptyInsights(range: InsightsRange): InsightsReport {
  return {
    range: { ...range, liveDays: [], liveUnavailable: [], notRecalculated: [], generatedAt: new Date(0).toISOString() },
    thresholds: THRESHOLDS,
    overview: {
      visits: 0,
      newVisits: 0,
      returningVisits: 0,
      endedVisits: 0,
      looksPerVisit: null,
      avgSeconds: null,
      bounceRate: null,
      whatsappTaps: 0,
      enquiringVisits: 0,
      restockRequests: 0,
      topSources: [],
      enough: false,
    },
    looks: { rows: [], hasHearts: false },
    photos: [],
    videos: [],
    funnel: { steps: FUNNEL_STEPS, all: emptySegment('all'), byDevice: [], bySource: [] },
    depth: { visits: 0, reach: [], capped: false, endOfFeedVisits: 0, endOfFeedRate: null },
    demand: { soldOut: [], options: [], askForPrice: [] },
    sources: { bySource: [], byCampaign: [], heatmap: [] },
    health: { days: [], byDetail: [] },
    reviews: { received: 0, approved: 0, averageStars: null, pendingNow: 0, perWeek: [] },
  }
}
