import type { Metadata } from "next";
import { lookbookImage } from "@/components/storefront";
import { ListingPage } from "@/components/storefront/collection/ListingPage";
import { getListingView, listingMetadata } from "@/lib/storefront/listing-page";
import { SITE_ROUTES } from "@/lib/storefront/paths";

// ZP-489: every published product. ?sort=&soldout=hide&page= (docs/storefront/collections.md).
const TITLE = "The collection";
const DESCRIPTION = "Every piece in store now. Ask us on WhatsApp about sizes and colours.";

export function generateMetadata(): Promise<Metadata> {
  return listingMetadata(SITE_ROUTES.shop, { title: "Shop", description: DESCRIPTION });
}

export default async function ShopPage(props: PageProps<"/site/shop">) {
  const view = await getListingView({ kind: "all" }, SITE_ROUTES.shop, await props.searchParams);
  return (
    <ListingPage
      base={view.shell.base}
      eyebrow="Shop"
      title={TITLE}
      description={DESCRIPTION}
      image={lookbookImage("olive-print-jumpsuit")}
      path={view.path}
      query={view.query}
      sortOptions={view.sortOptions}
      chips={view.chips}
      activeChip={view.activeChip}
      items={view.page.items}
      total={view.page.total}
      page={view.page.page}
      pageCount={view.page.pageCount}
      whatsappHref={view.shell.whatsappHref}
    />
  );
}
