import type { Metadata } from "next";
import { lookbookImage } from "@/components/storefront";
import { ListingPage } from "@/components/storefront/collection/ListingPage";
import { getListingView, listingMetadata } from "@/lib/storefront/listing-page";
import { SITE_ROUTES } from "@/lib/storefront/paths";
import { NEW_ARRIVAL_DAYS } from "@/lib/storefront-model";

// ZP-489: new arrivals only (first published within NEW_ARRIVAL_DAYS).
const DESCRIPTION = `Pieces added in the last ${NEW_ARRIVAL_DAYS} days.`;

export function generateMetadata(): Promise<Metadata> {
  return listingMetadata(SITE_ROUTES.newArrivals, { title: "New arrivals", description: DESCRIPTION });
}

export default async function NewArrivalsPage(props: PageProps<"/site/new">) {
  const view = await getListingView({ kind: "new" }, SITE_ROUTES.newArrivals, await props.searchParams);
  return (
    <ListingPage
      base={view.shell.base}
      eyebrow="Just in"
      title="New arrivals"
      description={DESCRIPTION}
      image={lookbookImage("chartreuse-fringe-knit-set")}
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
