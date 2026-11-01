# Storefront home page (ZP-488 → ZP-500, ZP-514)

The ZP-488 home sections (hero, new arrivals, featured, collections tiles,
visit teaser) were replaced by the flip feed in ZP-500
(docs/storefront/feed.md). ZP-514 removed their code
(`src/components/storefront/home/*`, the lookbook manifest) and tests; the
landing page is the feed, and every other storefront address folds into it.
