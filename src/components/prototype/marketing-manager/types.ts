// AI Marketing Manager prototype: the shape of the browser-local demo state.
import type { ChannelId, DemoConnection, FormatId } from './catalog';

export type GoalId = 'reach' | 'convert' | 'collection' | 'repeat';
export type Stage = 'discovery' | 'demo' | 'trust' | 'invite' | 'followup';

export interface Business {
  name: string;
  sells: string;
  audience: string;
  areas: string;
  worthChoosing: string;
  /** Policies: null means unknown. The prototype never fills an unknown policy in for you. */
  delivery: string | null;
  returns: string | null;
  ordering: string | null;
  payment: string | null;
  language: string;
  voice: string;
  monthlyBudget: number;
}

export interface GoalInput {
  goal: GoalId;
  weeks: 1 | 2 | 4;
  budget: number;
  /** Set when the plan comes from a results recommendation. */
  fromRecommendation?: string;
}

export interface PlanChannel {
  id: ChannelId;
  why: string;
  /** Required channels cannot be removed while editing. */
  locked?: string;
}

export interface Plan {
  goal: GoalId;
  variant: number;
  name: string;
  collectionName: string;
  productIds: string[];
  audience: string;
  message: string;
  reason: string;
  channels: PlanChannel[];
  startDate: string;
  days: number;
  budget: number;
  adDaily: number;
  /** Fixed content costs (sample freelance rates). */
  content: { label: string; cost: number }[];
  fromRecommendation?: string;
  edited?: boolean;
}

/** Simulated visual treatments. Real image generation is out of scope. */
export type Look = 'original' | 'warm' | 'studio' | 'headline';

export interface Scene {
  image: string;
  text: string;
  secs: number;
}

export interface Version {
  n: number;
  caption: string;
  images: string[];
  look: Look;
  /** Video items only: the simulated storyboard. */
  scenes?: Scene[];
  by: 'manager' | 'owner' | 'revision';
  /** Short reason shown in the history ("You edited the caption"). */
  why: string;
}

export type MaterialStatus = 'awaiting' | 'approved' | 'changes';

export interface Material {
  id: string;
  campaignId: string;
  stage: Stage;
  title: string;
  purpose: string;
  productId: string;
  /** Exactly one format: each channel format has its own words, visuals and approval. */
  formats: FormatId[];
  versions: Version[];
  openings: string[];
  status: MaterialStatus;
  approvedVersion: number | null;
  /** True after an approved item was changed: it needs approval again. */
  reapproval: boolean;
  backNote?: string;
  date: string;
}

export type PlacementState = 'scheduled' | 'published' | 'manual' | 'failed' | 'paused';

export interface Placement {
  id: string;
  campaignId: string;
  materialId: string;
  format: FormatId;
  date: string;
  state: PlacementState;
  publishedVersion?: number;
  sharedByOwner?: boolean;
  failReason?: string;
  /** How many tries failed (for the history line). */
  failures?: number;
}

export interface Campaign {
  id: string;
  name: string;
  goal: GoalId;
  plan: Plan;
  status: 'active' | 'ended';
  startDate: string;
  endDate: string;
  scheduled: boolean;
  paused: boolean;
  /** Paid ads need their own approval to start spending, separate from approving the ad's content. */
  adApproved?: boolean;
}

export interface ActivityRecord {
  id: string;
  date: string;
  campaignId: string | null;
  channel: ChannelId | null;
  placementId?: string;
  reach: number;
  visits: number;
  /** Taps on "Ask on WhatsApp" that were tracked to this channel. Not the same as a conversation. */
  clicks: number;
}

export interface CostRecord {
  id: string;
  date: string;
  campaignId: string;
  kind: 'ads' | 'messaging' | 'content';
  amount: number;
  note: string;
}

export type SourceKind = 'tracked' | 'reported' | 'unknown';

export interface Source {
  kind: SourceKind;
  channel?: ChannelId;
  detail?: string;
}

export interface Customer {
  id: string;
  name: string;
  /** Agreed to promotional WhatsApp messages. */
  marketingOk: boolean;
}

export type EnquiryStage = 'new' | 'waiting' | 'replied' | 'followup' | 'won' | 'lost';

export interface ChatMessage {
  from: 'customer' | 'shop';
  text: string;
  date: string;
}

export interface Enquiry {
  id: string;
  customerId: string;
  productId: string;
  campaignId: string | null;
  source: Source;
  stage: EnquiryStage;
  messages: ChatMessage[];
  /** The customer's current question. */
  question: string;
  suggestedReply: string;
  /** Scripted next customer messages with their suggested replies (simulated). */
  script: { customer: string; question: string; suggestion: string }[];
  followUp?: { date: string; kind: 'promo' | 'service'; note: string };
  saleId?: string;
  lostReason?: string;
  created: string;
}

export interface Sale {
  id: string;
  date: string;
  customerId: string;
  productId: string;
  amount: number;
  enquiryId: string | null;
  campaignId: string | null;
  source: Source;
}

export interface LogEntry {
  id: string;
  date: string;
  text: string;
}

export interface DemoState {
  version: 1;
  onboarding: 'pending' | 'done' | 'skipped';
  today: string;
  business: Business;
  connections: Record<ChannelId, DemoConnection>;
  /** `recommended` is set when the marketing manager prepared the draft on its own, with its reason. */
  draft: { input: GoalInput; plan: Plan | null; recommended?: string } | null;
  campaigns: Campaign[];
  materials: Material[];
  placements: Placement[];
  activity: ActivityRecord[];
  costs: CostRecord[];
  customers: Customer[];
  enquiries: Enquiry[];
  sales: Sale[];
  log: LogEntry[];
  seq: number;
}
