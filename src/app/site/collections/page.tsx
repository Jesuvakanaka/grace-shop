import type { Metadata } from "next";
import { Container } from "@/components/storefront";
import { CollectionTiles } from "@/components/storefront/collection/CollectionTiles";
import { ListingEmpty } from "@/components/storefront/collection/ListingEmpty";
import { ListingHeader } from "@/components/storefront/collection/ListingHeader";
import { listPublishedProducts } from "@/lib/storefront";
import { listingMetadata } from "@/lib/storefront/listing-page";
import { collectionsWithProducts } from "@/lib/storefront/listing-query";
import { SITE_ROUTES, sitePath } from "@/lib/storefront/paths";
import { getShellData } from "@/lib/storefront/shell";

// ZP-489: index of the published categories as photo tiles. Counts come from
// the cached catalogue (in memory, no extra cache entries).
const DESCRIPTION = "Browse VYRA by collection.";

export function generateMetadata(): Promise<Metadata> {
  return listingMetadata(SITE_ROUTES.collections, { title: "Collections", description: DESCRIPTION });
}

export default async function CollectionsIndexPage() {
  const shell = await getShellData();
  // Categories with no public products are left out (never an empty tile).
  const tiles = (await collectionsWithProducts({ listPublishedProducts }, shell.categories)).map(({ category: c, count }) => ({
    slug: c.slug,
    name: c.name,
    href: sitePath(shell.base, SITE_ROUTES.collection(c.slug)),
    heroImage: c.heroImage,
    count,
  }));

  return (
    <>
      <ListingHeader eyebrow="Explore" title="Collections" description={DESCRIPTION} />
      <Container className="pb-16 pt-10 lg:pb-24 lg:pt-14">
        <div className="border-t border-brand-ink/10! pt-8 lg:pt-12">
          {tiles.length ? <CollectionTiles tiles={tiles} /> : <ListingEmpty whatsappHref={shell.whatsappHref} />}
        </div>
      </Container>
    </>
  );
}
