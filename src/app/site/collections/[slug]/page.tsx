import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeedRoute } from "@/components/storefront/feed/FeedRoute";
import { getPublishedCategory, listPublishedProducts } from "@/lib/storefront";
import { SITE_ROUTES } from "@/lib/storefront/paths";
import { routeMetadata } from "@/lib/storefront/route-metadata";

// ZP-514: one published collection folds into the feed on that collection
// (?c= behaviour), with its own title, description, canonical and share
// picture (the collection's hero picture, else its first piece's photo).
// Unknown or unpublished slug -> 404.
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const category = await getPublishedCategory(slug);
  if (!category) return {};
  const picture =
    category.heroImage ?? (await listPublishedProducts({ categorySlug: category.slug, pageSize: 1 })).items[0]?.images[0] ?? null;
  return routeMetadata(SITE_ROUTES.collection(category.slug), {
    title: category.name,
    description: category.description ?? `${category.name} at VYRA, one look at a time.`,
    image: picture ? { url: picture.url, alt: picture.alt } : null,
  });
}

export default async function CollectionPage(props: Props) {
  const { slug } = await props.params;
  const category = await getPublishedCategory(slug);
  if (!category) notFound();
  return <FeedRoute route={{ route: "collection", slug: category.slug }} />;
}
