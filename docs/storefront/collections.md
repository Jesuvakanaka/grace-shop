# Shop, New in and collections (ZP-489 → ZP-514)

ZP-514 (owner): one view. The listing pages are folded into the flip feed
and their addresses keep working:

| Address | Shows |
| --- | --- |
| `/shop` | the feed on New in |
| `/new` | the feed on New in |
| `/collections` | the feed on New in with the collections sheet open |
| `/collections/<slug>` | the feed on that collection (`?c=` behaviour); unknown or unpublished slug: 404 |

Each keeps its own metadata (`routeMetadata`: title, description,
canonical = the address, Open Graph / Twitter; a collection's picture is its
hero picture, else its first piece's photo). After hydration the address
becomes the feed's (`/` or `/?c=<slug>`; `/collections` also pushes
`?o=collections`, so closing the sheet or back leaves the visitor on the
feed). See docs/storefront/feed.md, "One view (ZP-514)".

The grid pages, `ProductCard`, the filter bar, pagination, the listing query
(`listing-query.ts`) and page helpers (`listing-page.ts`) are gone. The
public data layer (`listPublishedProducts`, `listRelatedProducts`) and the
public products API are unchanged.
