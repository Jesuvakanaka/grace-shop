// ZP-488: the data the home page needs. Server only.
//
// Only the existing cached reads: getShellData() (settings + categories,
// React-cache deduped with the layout) and listPublishedProducts() (answered
// in memory from the one cached catalogue entry). No per-visitor database
// query. Publishing a product calls revalidateStorefront({ productSlugs }),
// which expires the catalogue (`storefront:products`), so the home page shows
// it on the next request without a deploy.
import "server-only";
import { listPublishedProducts, type PublicImage } from "@/lib/storefront";
import { getShellData } from "@/lib/storefront/shell";
import { buildHomeModel, FEATURED_LIMIT, NEW_ARRIVALS_LIMIT, type HomeModel } from "./home-model";

export async function getHomeModel(now: Date = new Date()): Promise<HomeModel> {
  const shell = await getShellData();
  const [newArrivals, featured] = await Promise.all([
    listPublishedProducts({ newOnly: true, sort: "newest", pageSize: NEW_ARRIVALS_LIMIT }),
    // Default sort is the admin order: featured first, then sortOrder, then newest.
    listPublishedProducts({ featuredOnly: true, pageSize: FEATURED_LIMIT }),
  ]);

  // Tiles without a hero image use their category's first product photo.
  const covers: Record<string, PublicImage | undefined> = {};
  await Promise.all(
    shell.categories
      .filter((c) => !c.heroImage)
      .map(async (c) => {
        const page = await listPublishedProducts({ categorySlug: c.slug, pageSize: 12 });
        covers[c.slug] = page.items.find((p) => p.images.length > 0)?.images[0];
      }),
  );

  return buildHomeModel({
    settings: shell.settings,
    newArrivals: newArrivals.items,
    featured: featured.items,
    categories: shell.categories,
    categoryCovers: covers,
    base: shell.base,
    now,
  });
}
