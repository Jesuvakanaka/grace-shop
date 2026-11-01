import { ColourBlock } from "@/components/storefront";
import { getHomeModel } from "@/components/storefront/home/home-data";
import { HomeHero } from "@/components/storefront/home/HomeHero";
import {
  BrandBand,
  Collections,
  FeaturedEdit,
  HomeTrustStrip,
  NewArrivals,
  VisitTeaser,
} from "@/components/storefront/home/HomeSections";

// ZP-488: the VYRA home page (docs/storefront/home.md). The title is the
// layout default ("VYRA – Wear Different."). Data comes only from the cached
// reads (settings, categories, catalogue); the layout's headers() call makes
// the route dynamic, so "today's hours" and new publishes are always current.
// Every block below the hero hides when its data is missing.
export default async function StorefrontHome() {
  const home = await getHomeModel();
  return (
    <>
      <HomeHero hero={home.hero} shopHref={home.links.shop} newArrivalsHref={home.links.newArrivals} />
      <HomeTrustStrip labels={home.trustLabels} />
      {home.newArrivals ? (
        <NewArrivals products={home.newArrivals} viewAllHref={home.links.newArrivals} productHref={home.productHref} />
      ) : null}
      {home.collections ? <Collections tiles={home.collections} /> : null}
      <BrandBand band={home.brandBand} />
      <ColourBlock statement={home.statement} action={{ label: "Our story", href: home.links.about }} />
      {home.featured ? (
        <FeaturedEdit featured={home.featured} viewAllHref={home.links.shop} productHref={home.productHref} />
      ) : null}
      {home.visit ? <VisitTeaser visit={home.visit} visitHref={home.links.visit} /> : null}
    </>
  );
}
