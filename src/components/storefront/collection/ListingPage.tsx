import { LISTING_PAGE_SIZE, listingHref, type ListingQuery, type ListingSort } from "@/lib/storefront/listing-query";
import { SITE_ROUTES, sitePath, type SiteBase } from "@/lib/storefront/paths";
import { ProductCard, ProductGrid } from "../ProductCard";
import { Container } from "../Section";
import type { PublicProduct, StorefrontImageData } from "../types";
import { ListingEmpty } from "./ListingEmpty";
import { ListingFilters } from "./ListingFilters";
import { ListingHeader } from "./ListingHeader";
import { Pagination } from "./Pagination";

export type ListingPageProps = {
  base: SiteBase;
  eyebrow?: string;
  title: string;
  description?: string | null;
  image?: StorefrontImageData | null;
  /** This listing's link, without a query. */
  path: string;
  query: ListingQuery;
  sortOptions: { label: string; value: ListingSort }[];
  chips: { label: string; value: string; href: string }[];
  activeChip: string;
  items: PublicProduct[];
  total: number;
  page: number;
  pageCount: number;
  whatsappHref: string | null;
};

const pieces = (n: number) => `${n} ${n === 1 ? "piece" : "pieces"}`;

/**
 * A product listing (ZP-489): header, filter row, 2 / 3 / 4 column grid,
 * page links, or the WhatsApp empty state. Server component; the filter row
 * is the only client part.
 */
export function ListingPage(props: ListingPageProps) {
  const { base, path, query, items, total, page, pageCount } = props;
  const sortHrefs = Object.fromEntries(
    props.sortOptions.map((o) => [o.value, listingHref(path, { sort: o.value, hideSoldOut: query.hideSoldOut })]),
  );
  // Nothing in this listing at all: no filters, just the empty state. With
  // "Hide sold out" on, keep the filters so it can be turned off again.
  const showFilters = total > 0 || query.hideSoldOut;
  const firstIndex = (page - 1) * LISTING_PAGE_SIZE;

  return (
    <>
      <ListingHeader eyebrow={props.eyebrow} title={props.title} description={props.description} image={props.image} />
      <Container className="pb-16 pt-8 sm:pt-10 lg:pb-24 lg:pt-14">
        {showFilters ? (
          <ListingFilters
            chips={props.chips}
            activeChip={props.activeChip}
            sortOptions={props.sortOptions}
            sort={query.sort}
            sortHrefs={sortHrefs}
            hideSoldOut={query.hideSoldOut}
            soldOutHref={listingHref(path, { sort: query.sort, hideSoldOut: !query.hideSoldOut })}
            resultLabel={pageCount > 1 ? `${pieces(total)} · page ${page} of ${pageCount}` : pieces(total)}
          />
        ) : null}
        {items.length ? (
          <>
            <h2 className="sr-only">{pageCount > 1 ? `Pieces, page ${page} of ${pageCount}` : "Pieces"}</h2>
            <ProductGrid columns={4} className="mt-8 lg:mt-12">
              {items.map((product, i) => (
                <li key={product.slug}>
                  <ProductCard
                    product={product}
                    hrefFor={(slug) => sitePath(base, SITE_ROUTES.product(slug))}
                    // The header photo is the LCP image; on phones the first row may be too.
                    eager={firstIndex + i < 2 && !props.image}
                  />
                </li>
              ))}
            </ProductGrid>
            <Pagination page={page} pageCount={pageCount} hrefFor={(n) => listingHref(path, { ...query, page: n })} />
          </>
        ) : (
          <ListingEmpty whatsappHref={props.whatsappHref} />
        )}
      </Container>
    </>
  );
}
