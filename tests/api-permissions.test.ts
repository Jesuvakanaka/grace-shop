/**
 * ZP-465: server-side permission matrix for every API route handler.
 *
 * Each handler is called directly with a Request that has
 *   - no cookie            -> must be 401
 *   - a STAFF token        -> 403 for OWNER-only handlers, otherwise allowed
 *   - an OWNER token       -> allowed
 *
 * "Allowed" means the request got past the auth check (status is neither 401 nor 403).
 * Mutating handlers are called with a malformed body so that, once past the auth
 * check, they fail at request parsing and never write to the database.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert';

process.env.JWT_SECRET = 'zp465-permission-tests-secret-0123456789abcdef';

import { createToken } from '../src/lib/auth';

import * as changePassword from '../src/app/api/auth/change-password/route';
import * as login from '../src/app/api/auth/login/route';
import * as setup from '../src/app/api/auth/setup/route';
import * as cash from '../src/app/api/cash/route';
import * as closing from '../src/app/api/closing/route';
import * as closingClose from '../src/app/api/closing/[id]/close/route';
import * as creditors from '../src/app/api/creditors/route';
import * as creditorById from '../src/app/api/creditors/[id]/route';
import * as creditorPayment from '../src/app/api/creditors/[id]/payment/route';
import * as dashboard from '../src/app/api/dashboard/route';
import * as debtors from '../src/app/api/debtors/route';
import * as debtorById from '../src/app/api/debtors/[id]/route';
import * as debtorPayment from '../src/app/api/debtors/[id]/payment/route';
import * as exchangeRate from '../src/app/api/exchange-rate/route';
import * as expenseCategories from '../src/app/api/expenses/categories/route';
import * as expenses from '../src/app/api/expenses/route';
import * as importCancel from '../src/app/api/import/cancel/route';
import * as importConfirm from '../src/app/api/import/confirm/route';
import * as importHistory from '../src/app/api/import/history/route';
import * as importTemplates from '../src/app/api/import/templates/[type]/route';
import * as importUpload from '../src/app/api/import/upload/route';
import * as products from '../src/app/api/products/route';
import * as productById from '../src/app/api/products/[id]/route';
import * as saleById from '../src/app/api/sales/[id]/route';
import * as sales from '../src/app/api/sales/route';
import * as saleRefunds from '../src/app/api/sales/[id]/refunds/route';
import * as saleCancel from '../src/app/api/sales/[id]/cancel/route';
import * as refundVoid from '../src/app/api/sale-refunds/[id]/void/route';
import * as mkSales from '../src/app/api/marketing/sales/route';
import * as mkSaleAttribution from '../src/app/api/marketing/sales/[id]/attribution/route';
import * as stockAdjust from '../src/app/api/stock-movements/adjust/route';
import * as stockMovements from '../src/app/api/stock-movements/route';
import * as upload from '../src/app/api/upload/route';
import * as imageByKey from '../src/app/api/images/[key]/route';
import * as captureList from '../src/app/api/capture/route';
import * as captureHouseModel from '../src/app/api/capture/house-model/route';
import * as captureById from '../src/app/api/capture/[id]/route';
import * as captureRun from '../src/app/api/capture/[id]/run/route';
import * as captureRegenerate from '../src/app/api/capture/[id]/regenerate/route';
import * as captureApprove from '../src/app/api/capture/[id]/approve/route';
import * as websiteSettings from '../src/app/api/website/settings/route';
import * as websiteProducts from '../src/app/api/website/products/route';
import * as websiteProductById from '../src/app/api/website/products/[id]/route';
import * as websiteProductPublish from '../src/app/api/website/products/[id]/publish/route';
import * as websiteProductPreview from '../src/app/api/website/products/[id]/preview-token/route';
import * as websiteProductImages from '../src/app/api/website/products/[id]/images/route';
import * as websiteProductImage from '../src/app/api/website/products/[id]/images/[imageId]/route';
import * as websiteProductsBulk from '../src/app/api/website/products/bulk/route';
import * as websiteCategories from '../src/app/api/website/categories/route';
import * as websiteCategoryById from '../src/app/api/website/categories/[id]/route';
import * as mkSettings from '../src/app/api/marketing/settings/route';
import * as mkChannels from '../src/app/api/marketing/channels/route';
import * as mkCampaigns from '../src/app/api/marketing/campaigns/route';
import * as mkCampaignById from '../src/app/api/marketing/campaigns/[id]/route';
import * as mkContent from '../src/app/api/marketing/content/route';
import * as mkContentById from '../src/app/api/marketing/content/[id]/route';
import * as mkPosts from '../src/app/api/marketing/posts/route';
import * as mkPostById from '../src/app/api/marketing/posts/[id]/route';
import * as mkPostTransition from '../src/app/api/marketing/posts/[id]/transition/route';
import * as mkConnect from '../src/app/api/marketing/channels/connect/route';
import * as mkDisconnect from '../src/app/api/marketing/channels/[id]/disconnect/route';
import * as mkSyncProducts from '../src/app/api/marketing/channels/[id]/sync-products/route';
import * as mkAudit from '../src/app/api/marketing/audit/route';
import * as mkDraft from '../src/app/api/marketing/content/[id]/draft/route';
import * as mkSuggestions from '../src/app/api/marketing/suggestions/route';
import * as mkPlan from '../src/app/api/marketing/plan/route';
import * as mkPlanApply from '../src/app/api/marketing/plan/apply/route';
import * as mkStatus from '../src/app/api/marketing/status/route';
import * as mkProducts from '../src/app/api/marketing/products/route';
import * as mkCatalogue from '../src/app/api/marketing/catalogue/route';
import * as mkProfileConfirm from '../src/app/api/marketing/products/[id]/profile/confirm/route';
import * as mkContentPosts from '../src/app/api/marketing/content/[id]/posts/route';
import * as mkAudiences from '../src/app/api/marketing/audiences/route';
import * as mkAudienceById from '../src/app/api/marketing/audiences/[id]/route';
import * as mkAds from '../src/app/api/marketing/ads/route';
import * as mkAdById from '../src/app/api/marketing/ads/[id]/route';
import * as mkAdTransition from '../src/app/api/marketing/ads/[id]/transition/route';
import * as mkAdSync from '../src/app/api/marketing/ads/[id]/sync/route';
import * as mkAdDraft from '../src/app/api/marketing/ads/[id]/draft/route';
import * as mkBudget from '../src/app/api/marketing/budget/route';
import * as mkResults from '../src/app/api/marketing/results/route';
import * as mkResultsSync from '../src/app/api/marketing/results/sync/route';
import * as mkRecs from '../src/app/api/marketing/recommendations/route';
import * as mkRecsGenerate from '../src/app/api/marketing/recommendations/generate/route';
import * as mkRecById from '../src/app/api/marketing/recommendations/[id]/route';
import * as pubFeedCsv from '../src/app/api/public/marketing/feed.csv/route';
import * as pubFeedXml from '../src/app/api/public/marketing/feed.xml/route';
import * as mkContacts from '../src/app/api/marketing/contacts/route';
import * as mkContactById from '../src/app/api/marketing/contacts/[id]/route';
import * as mkContactConsent from '../src/app/api/marketing/contacts/[id]/consent/route';
import * as mkContactsImport from '../src/app/api/marketing/contacts/import/route';
import * as mkResultsTruth from '../src/app/api/marketing/results/truth/route';
import * as mkResultsAdvice from '../src/app/api/marketing/results/advice/route';
import * as mkEnquiries from '../src/app/api/marketing/enquiries/route';
import * as mkEnquiryById from '../src/app/api/marketing/enquiries/[id]/route';
import * as mkEnquiryStatus from '../src/app/api/marketing/enquiries/[id]/status/route';
import * as mkEnquiryContact from '../src/app/api/marketing/enquiries/[id]/contact/route';
import * as mkEnquiryReply from '../src/app/api/marketing/enquiries/[id]/reply/route';
import * as mkBroadcasts from '../src/app/api/marketing/broadcasts/route';
import * as mkBroadcastById from '../src/app/api/marketing/broadcasts/[id]/route';
import * as mkBroadcastTransition from '../src/app/api/marketing/broadcasts/[id]/transition/route';
import * as mkBroadcastRecipients from '../src/app/api/marketing/broadcasts/[id]/recipients/route';
import * as mkPartners from '../src/app/api/marketing/partners/route';
import * as mkPartnerById from '../src/app/api/marketing/partners/[id]/route';
import * as mkPartnerKit from '../src/app/api/marketing/partners/[id]/kit/route';
import * as pubUnsubscribe from '../src/app/api/public/marketing/unsubscribe/route';

// PUBLIC: no session needed (sign-in routes). "Allowed" for every caller, including no cookie.
type Policy = 'PUBLIC' | 'SESSION' | 'OWNER';
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface Case {
  method: string;
  path: string;
  handler: Handler;
  policy: Policy;
  params?: Record<string, string>;
}

const h = (fn: unknown) => fn as Handler;

// A path that does not exist, so allowed GET-by-id calls end in 404, not real data.
const MISSING_ID = '987654321';

const cases: Case[] = [
  { method: 'POST', path: '/api/auth/login', handler: h(login.POST), policy: 'PUBLIC' },
  // Tells the login page whether to show the first-time setup link.
  { method: 'GET', path: '/api/auth/setup', handler: h(setup.GET), policy: 'PUBLIC' },

  { method: 'POST', path: '/api/auth/change-password', handler: h(changePassword.POST), policy: 'SESSION' },

  { method: 'GET', path: '/api/cash', handler: h(cash.GET), policy: 'SESSION' },
  { method: 'POST', path: '/api/cash', handler: h(cash.POST), policy: 'SESSION' },

  { method: 'GET', path: '/api/closing?date=2000-01-01', handler: h(closing.GET), policy: 'SESSION' },
  { method: 'POST', path: '/api/closing', handler: h(closing.POST), policy: 'SESSION' },
  { method: 'POST', path: `/api/closing/${MISSING_ID}/close`, handler: h(closingClose.POST), policy: 'OWNER', params: { id: MISSING_ID } },

  { method: 'GET', path: '/api/creditors', handler: h(creditors.GET), policy: 'SESSION' },
  { method: 'POST', path: '/api/creditors', handler: h(creditors.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/creditors/${MISSING_ID}`, handler: h(creditorById.GET), policy: 'SESSION', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/creditors/${MISSING_ID}/payment`, handler: h(creditorPayment.POST), policy: 'SESSION', params: { id: MISSING_ID } },

  { method: 'GET', path: '/api/dashboard', handler: h(dashboard.GET), policy: 'SESSION' },

  { method: 'GET', path: '/api/debtors', handler: h(debtors.GET), policy: 'SESSION' },
  { method: 'POST', path: '/api/debtors', handler: h(debtors.POST), policy: 'SESSION' },
  { method: 'GET', path: `/api/debtors/${MISSING_ID}`, handler: h(debtorById.GET), policy: 'SESSION', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/debtors/${MISSING_ID}/payment`, handler: h(debtorPayment.POST), policy: 'SESSION', params: { id: MISSING_ID } },

  { method: 'GET', path: '/api/exchange-rate', handler: h(exchangeRate.GET), policy: 'SESSION' },
  { method: 'POST', path: '/api/exchange-rate', handler: h(exchangeRate.POST), policy: 'OWNER' },

  { method: 'GET', path: '/api/expenses/categories', handler: h(expenseCategories.GET), policy: 'SESSION' },
  { method: 'GET', path: '/api/expenses', handler: h(expenses.GET), policy: 'SESSION' },
  { method: 'POST', path: '/api/expenses', handler: h(expenses.POST), policy: 'SESSION' },

  { method: 'POST', path: '/api/import/cancel', handler: h(importCancel.POST), policy: 'OWNER' },
  { method: 'POST', path: '/api/import/confirm', handler: h(importConfirm.POST), policy: 'OWNER' },
  { method: 'GET', path: '/api/import/history', handler: h(importHistory.GET), policy: 'OWNER' },
  { method: 'GET', path: '/api/import/templates/PRODUCT_LIST', handler: h(importTemplates.GET), policy: 'OWNER', params: { type: 'PRODUCT_LIST' } },
  { method: 'POST', path: '/api/import/upload', handler: h(importUpload.POST), policy: 'OWNER' },

  { method: 'GET', path: '/api/products', handler: h(products.GET), policy: 'SESSION' },
  { method: 'POST', path: '/api/products', handler: h(products.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/products/${MISSING_ID}`, handler: h(productById.GET), policy: 'SESSION', params: { id: MISSING_ID } },
  { method: 'PUT', path: `/api/products/${MISSING_ID}`, handler: h(productById.PUT), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'DELETE', path: `/api/products/${MISSING_ID}`, handler: h(productById.DELETE), policy: 'OWNER', params: { id: MISSING_ID } },

  { method: 'GET', path: '/api/sales', handler: h(sales.GET), policy: 'SESSION' },
  { method: 'POST', path: '/api/sales', handler: h(sales.POST), policy: 'SESSION' },
  { method: 'GET', path: `/api/sales/${MISSING_ID}`, handler: h(saleById.GET), policy: 'SESSION', params: { id: MISSING_ID } },
  // ZP-1118: refunds, cancellations and corrections pay money out or change what is owed: OWNER only.
  { method: 'POST', path: `/api/sales/${MISSING_ID}/refunds`, handler: h(saleRefunds.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/sales/${MISSING_ID}/cancel`, handler: h(saleCancel.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/sale-refunds/${MISSING_ID}/void`, handler: h(refundVoid.POST), policy: 'OWNER', params: { id: MISSING_ID } },

  { method: 'GET', path: '/api/stock-movements', handler: h(stockMovements.GET), policy: 'SESSION' },
  { method: 'POST', path: '/api/stock-movements/adjust', handler: h(stockAdjust.POST), policy: 'OWNER' },

  { method: 'POST', path: '/api/upload', handler: h(upload.POST), policy: 'OWNER' },

  // ZP-468: product pictures. A key that is never stored, so allowed calls end in 404.
  { method: 'GET', path: `/api/images/${'0'.repeat(32)}.webp`, handler: h(imageByKey.GET), policy: 'SESSION', params: { key: `${'0'.repeat(32)}.webp` } },

  // ZP-486: website site settings. OWNER-only for reading too (the public site uses getPublicSiteSettings()).
  { method: 'GET', path: '/api/website/settings', handler: h(websiteSettings.GET), policy: 'OWNER' },
  { method: 'PUT', path: '/api/website/settings', handler: h(websiteSettings.PUT), policy: 'OWNER' },

  // ZP-1100: AI product capture. Every route is OWNER only, reads included.
  { method: 'GET', path: '/api/capture', handler: h(captureList.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/capture', handler: h(captureList.POST), policy: 'OWNER' },
  { method: 'GET', path: '/api/capture/house-model', handler: h(captureHouseModel.GET), policy: 'OWNER' },
  { method: 'PUT', path: '/api/capture/house-model', handler: h(captureHouseModel.PUT), policy: 'OWNER' },
  { method: 'DELETE', path: '/api/capture/house-model', handler: h(captureHouseModel.DELETE), policy: 'OWNER' },
  { method: 'GET', path: `/api/capture/${MISSING_ID}`, handler: h(captureById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/capture/${MISSING_ID}`, handler: h(captureById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'DELETE', path: `/api/capture/${MISSING_ID}`, handler: h(captureById.DELETE), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/capture/${MISSING_ID}/run`, handler: h(captureRun.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/capture/${MISSING_ID}/regenerate`, handler: h(captureRegenerate.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/capture/${MISSING_ID}/approve`, handler: h(captureApprove.POST), policy: 'OWNER', params: { id: MISSING_ID } },

  // ZP-1200: marketing hub. Every route is OWNER only, reads included.
  { method: 'GET', path: '/api/marketing/settings', handler: h(mkSettings.GET), policy: 'OWNER' },
  { method: 'PUT', path: '/api/marketing/settings', handler: h(mkSettings.PUT), policy: 'OWNER' },
  { method: 'GET', path: '/api/marketing/channels', handler: h(mkChannels.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/channels/connect', handler: h(mkConnect.POST), policy: 'OWNER' },
  { method: 'POST', path: `/api/marketing/channels/${MISSING_ID}/disconnect`, handler: h(mkDisconnect.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/channels/${MISSING_ID}/sync-products`, handler: h(mkSyncProducts.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/marketing/campaigns', handler: h(mkCampaigns.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/campaigns', handler: h(mkCampaigns.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/campaigns/${MISSING_ID}`, handler: h(mkCampaignById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/marketing/campaigns/${MISSING_ID}`, handler: h(mkCampaignById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'DELETE', path: `/api/marketing/campaigns/${MISSING_ID}`, handler: h(mkCampaignById.DELETE), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/marketing/content', handler: h(mkContent.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/content', handler: h(mkContent.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/content/${MISSING_ID}`, handler: h(mkContentById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/marketing/content/${MISSING_ID}`, handler: h(mkContentById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'DELETE', path: `/api/marketing/content/${MISSING_ID}`, handler: h(mkContentById.DELETE), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/marketing/posts', handler: h(mkPosts.GET), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/posts/${MISSING_ID}`, handler: h(mkPostById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/marketing/posts/${MISSING_ID}`, handler: h(mkPostById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/posts/${MISSING_ID}/transition`, handler: h(mkPostTransition.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/marketing/audit', handler: h(mkAudit.GET), policy: 'OWNER' },
  { method: 'POST', path: `/api/marketing/content/${MISSING_ID}/draft`, handler: h(mkDraft.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/marketing/suggestions', handler: h(mkSuggestions.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/plan', handler: h(mkPlan.POST), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/plan/apply', handler: h(mkPlanApply.POST), policy: 'OWNER' },
  { method: 'GET', path: '/api/marketing/status', handler: h(mkStatus.GET), policy: 'OWNER' },
  { method: 'GET', path: '/api/marketing/products', handler: h(mkProducts.GET), policy: 'OWNER' },
  // ZP-1106: the catalogue's truth and confirming a selling profile.
  { method: 'GET', path: '/api/marketing/catalogue', handler: h(mkCatalogue.GET), policy: 'OWNER' },
  { method: 'GET', path: '/api/marketing/sales?from=2000-01-01&to=2000-01-02', handler: h(mkSales.GET), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/sales/${MISSING_ID}/attribution`, handler: h(mkSaleAttribution.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PUT', path: `/api/marketing/sales/${MISSING_ID}/attribution`, handler: h(mkSaleAttribution.PUT), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/products/${MISSING_ID}/profile/confirm`, handler: h(mkProfileConfirm.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/content/${MISSING_ID}/posts`, handler: h(mkContentPosts.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  // ZP-1200: ads, audiences, budget (OWNER only) and the public product feed (PUBLIC: no sign-in; 404 until switched on).
  { method: 'GET', path: '/api/marketing/audiences', handler: h(mkAudiences.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/audiences', handler: h(mkAudiences.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/audiences/${MISSING_ID}`, handler: h(mkAudienceById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/marketing/audiences/${MISSING_ID}`, handler: h(mkAudienceById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'DELETE', path: `/api/marketing/audiences/${MISSING_ID}`, handler: h(mkAudienceById.DELETE), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/marketing/ads', handler: h(mkAds.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/ads', handler: h(mkAds.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/ads/${MISSING_ID}`, handler: h(mkAdById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/marketing/ads/${MISSING_ID}`, handler: h(mkAdById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'DELETE', path: `/api/marketing/ads/${MISSING_ID}`, handler: h(mkAdById.DELETE), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/ads/${MISSING_ID}/transition`, handler: h(mkAdTransition.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/ads/${MISSING_ID}/sync`, handler: h(mkAdSync.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/ads/${MISSING_ID}/draft`, handler: h(mkAdDraft.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/marketing/budget', handler: h(mkBudget.GET), policy: 'OWNER' },
  { method: 'GET', path: '/api/marketing/results', handler: h(mkResults.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/results/sync', handler: h(mkResultsSync.POST), policy: 'OWNER' },
  { method: 'GET', path: '/api/marketing/recommendations', handler: h(mkRecs.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/recommendations/generate', handler: h(mkRecsGenerate.POST), policy: 'OWNER' },
  { method: 'PATCH', path: `/api/marketing/recommendations/${MISSING_ID}`, handler: h(mkRecById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/public/marketing/feed.csv', handler: h(pubFeedCsv.GET), policy: 'PUBLIC' },
  { method: 'GET', path: '/api/public/marketing/feed.xml', handler: h(pubFeedXml.GET), policy: 'PUBLIC' },
  // ZP-1200: contacts, broadcasts and partners are OWNER only; the unsubscribe link is PUBLIC (the signed token is the permission).
  { method: 'GET', path: '/api/marketing/contacts', handler: h(mkContacts.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/contacts', handler: h(mkContacts.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/contacts/${MISSING_ID}`, handler: h(mkContactById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/marketing/contacts/${MISSING_ID}`, handler: h(mkContactById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/contacts/${MISSING_ID}/consent`, handler: h(mkContactConsent.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: '/api/marketing/contacts/import', handler: h(mkContactsImport.POST), policy: 'OWNER' },
  // ZP-1119 (MM-14): results meaning and advice are OWNER only.
  { method: 'GET', path: '/api/marketing/results/truth', handler: h(mkResultsTruth.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/results/advice', handler: h(mkResultsAdvice.POST), policy: 'OWNER' },
  // ZP-1116 (MM-11): enquiries are OWNER only.
  { method: 'GET', path: '/api/marketing/enquiries', handler: h(mkEnquiries.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/enquiries', handler: h(mkEnquiries.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/enquiries/${MISSING_ID}`, handler: h(mkEnquiryById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/marketing/enquiries/${MISSING_ID}`, handler: h(mkEnquiryById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/enquiries/${MISSING_ID}/status`, handler: h(mkEnquiryStatus.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/enquiries/${MISSING_ID}/contact`, handler: h(mkEnquiryContact.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/enquiries/${MISSING_ID}/reply`, handler: h(mkEnquiryReply.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/marketing/broadcasts', handler: h(mkBroadcasts.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/broadcasts', handler: h(mkBroadcasts.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/broadcasts/${MISSING_ID}`, handler: h(mkBroadcastById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/marketing/broadcasts/${MISSING_ID}`, handler: h(mkBroadcastById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/marketing/broadcasts/${MISSING_ID}/transition`, handler: h(mkBroadcastTransition.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: `/api/marketing/broadcasts/${MISSING_ID}/recipients`, handler: h(mkBroadcastRecipients.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/marketing/partners', handler: h(mkPartners.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/marketing/partners', handler: h(mkPartners.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/marketing/partners/${MISSING_ID}`, handler: h(mkPartnerById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/marketing/partners/${MISSING_ID}`, handler: h(mkPartnerById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: `/api/marketing/partners/${MISSING_ID}/kit`, handler: h(mkPartnerKit.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'GET', path: '/api/public/marketing/unsubscribe', handler: h(pubUnsubscribe.GET), policy: 'PUBLIC' },
  { method: 'POST', path: '/api/public/marketing/unsubscribe', handler: h(pubUnsubscribe.POST), policy: 'PUBLIC' },

  // ZP-483: admin website tools. Every route is OWNER only, reads included.
  { method: 'GET', path: '/api/website/products', handler: h(websiteProducts.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/website/products/bulk', handler: h(websiteProductsBulk.POST), policy: 'OWNER' },
  { method: 'GET', path: `/api/website/products/${MISSING_ID}`, handler: h(websiteProductById.GET), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/website/products/${MISSING_ID}`, handler: h(websiteProductById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/website/products/${MISSING_ID}/publish`, handler: h(websiteProductPublish.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/website/products/${MISSING_ID}/preview-token`, handler: h(websiteProductPreview.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'POST', path: `/api/website/products/${MISSING_ID}/images`, handler: h(websiteProductImages.POST), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PUT', path: `/api/website/products/${MISSING_ID}/images`, handler: h(websiteProductImages.PUT), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'PATCH', path: `/api/website/products/${MISSING_ID}/images/${MISSING_ID}`, handler: h(websiteProductImage.PATCH), policy: 'OWNER', params: { id: MISSING_ID, imageId: MISSING_ID } },
  { method: 'DELETE', path: `/api/website/products/${MISSING_ID}/images/${MISSING_ID}`, handler: h(websiteProductImage.DELETE), policy: 'OWNER', params: { id: MISSING_ID, imageId: MISSING_ID } },
  { method: 'GET', path: '/api/website/categories', handler: h(websiteCategories.GET), policy: 'OWNER' },
  { method: 'POST', path: '/api/website/categories', handler: h(websiteCategories.POST), policy: 'OWNER' },
  { method: 'PUT', path: '/api/website/categories', handler: h(websiteCategories.PUT), policy: 'OWNER' },
  { method: 'PATCH', path: `/api/website/categories/${MISSING_ID}`, handler: h(websiteCategoryById.PATCH), policy: 'OWNER', params: { id: MISSING_ID } },
  { method: 'DELETE', path: `/api/website/categories/${MISSING_ID}`, handler: h(websiteCategoryById.DELETE), policy: 'OWNER', params: { id: MISSING_ID } },
];

function makeRequest(c: Case, token?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.cookie = `auth-token=${token}`;
  const init: RequestInit = { method: c.method, headers };
  // Malformed JSON: once past the auth check, mutating handlers fail while parsing the body.
  if (c.method !== 'GET') init.body = '{not-json';
  return new Request(`http://localhost${c.path}`, init);
}

async function call(c: Case, token?: string): Promise<number> {
  const res = await c.handler(makeRequest(c, token), { params: Promise.resolve(c.params ?? {}) });
  return res.status;
}

describe('API permission matrix (ZP-465)', () => {
  let staffToken: string;
  let ownerToken: string;

  before(async () => {
    staffToken = await createToken(900001, 'perm-staff', 'STAFF');
    ownerToken = await createToken(900002, 'perm-owner', 'OWNER');
  });

  for (const c of cases) {
    const label = `${c.method} ${c.path.split('?')[0]} [${c.policy}]`;

    if (c.policy === 'PUBLIC') {
      test(`${label}: no cookie -> allowed`, async () => {
        const status = await call(c);
        assert.ok(![401, 403].includes(status), `expected a public route, got ${status}`);
      });

      test(`${label}: tampered token -> allowed (token ignored)`, async () => {
        const status = await call(c, `${ownerToken}x`);
        assert.ok(![401, 403].includes(status), `expected a public route, got ${status}`);
      });
    } else {
      test(`${label}: no cookie -> 401`, async () => {
        assert.strictEqual(await call(c), 401);
      });

      test(`${label}: tampered token -> 401`, async () => {
        assert.strictEqual(await call(c, `${ownerToken}x`), 401);
      });
    }

    test(`${label}: STAFF -> ${c.policy === 'OWNER' ? '403' : 'allowed'}`, async () => {
      const status = await call(c, staffToken);
      if (c.policy === 'OWNER') assert.strictEqual(status, 403);
      else assert.ok(![401, 403].includes(status), `expected STAFF to be allowed, got ${status}`);
    });

    test(`${label}: OWNER -> allowed`, async () => {
      const status = await call(c, ownerToken);
      assert.ok(![401, 403].includes(status), `expected OWNER to be allowed, got ${status}`);
    });
  }

  test('401 and 403 responses use a consistent JSON body', async () => {
    const adjust = cases.find((c) => c.path === '/api/stock-movements/adjust')!;
    const r401 = await adjust.handler(makeRequest(adjust), { params: Promise.resolve({}) });
    assert.deepStrictEqual(await r401.json(), { error: 'Unauthorized' });
    const r403 = await adjust.handler(makeRequest(adjust, staffToken), { params: Promise.resolve({}) });
    assert.deepStrictEqual(await r403.json(), { error: 'Forbidden' });
  });

  test('misconfigured JWT secret: authorize() returns a generic 500 without the config detail', async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { NODE_ENV: env.NODE_ENV, JWT_SECRET: env.JWT_SECRET };
    const originalError = console.error;
    env.NODE_ENV = 'production';
    delete env.JWT_SECRET;
    console.error = () => {};
    try {
      const adjust = cases.find((c) => c.path === '/api/stock-movements/adjust')!;
      const res = await adjust.handler(makeRequest(adjust, ownerToken), { params: Promise.resolve({}) });
      assert.strictEqual(res.status, 500);
      const text = await res.text();
      assert.deepStrictEqual(JSON.parse(text), { error: 'Server misconfigured' });
      assert.doesNotMatch(text, /JWT/);
    } finally {
      console.error = originalError;
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
    }
  });

  test('a token with an unknown role is treated as non-owner', async () => {
    const weird = await createToken(900003, 'perm-weird', 'ADMIN');
    const adjust = cases.find((c) => c.path === '/api/stock-movements/adjust')!;
    assert.strictEqual(await call(adjust, weird), 403);
  });
});
