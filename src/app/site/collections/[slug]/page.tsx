import type { Metadata } from "next";
import { toImageData } from "@/components/storefront";
import { ListingPage } from "@/components/storefront/collection/ListingPage";
import { getPublishedCategory } from "@/lib/storefront";
import { getListingView, listingMetadata } from "@/lib/storefront/listing-page";
import { SITE_ROUTES } from "@/lib/storefront/paths";

// ZP-489: one published category. Unknown or unpublished slug -> notFound()
// (categories have no slug redirects in the data model).
export async function generateMetadata(props: PageProps<"/site/collections/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const category = await getPublishedCategory(slug);
  if (!category) return {};
  return listingMetadata(SITE_ROUTES.collection(category.slug), {
    title: category.name,
    description: category.description,
  });
}

export default async function CollectionPage(props: PageProps<"/site/collections/[slug]">) {
  const { slug } = await props.params;
  const view = await getListingView({ kind: "category", slug }, SITE_ROUTES.collection(slug), await props.searchParams);
  const category = view.category!;
  return (
    <ListingPage
      base={view.shell.base}
      eyebrow="Collection"
      title={category.name}
      description={category.description}
      image={category.heroImage ? toImageData(category.heroImage) : null}
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
