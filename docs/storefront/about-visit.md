# About and Visit us (ZP-491 → ZP-514)

ZP-514 (owner): one view. The About and Visit us pages are folded into the
feed's menu; their addresses keep working:

- `/about`: the feed with the menu open on **About VYRA**, expanded: the
  headline, the about picture and the whole story (paragraphs from the site
  settings; `MenuAbout`, `aboutParagraphs`). No story: no row.
- `/visit`: the feed with the menu open on **Visit us**, expanded: today's
  hours (highlighted), the week, holiday note, address, Get directions and,
  when the owner set one, "Open the map". The store's **LocalBusiness
  JSON-LD** (`localBusinessJsonLd`: ClothingStore with name, URL, phone,
  address, geo and grouped opening hours; missing parts left out) stays on
  this address.

After hydration the address becomes the feed's with `?o=about` / `?o=visit`
pushed on top (closing the menu or back leaves the visitor on the feed).
"Visit us" links inside the feed (the rail without WhatsApp, the end slide,
the details card's footer) open the menu on Visit us instead of loading
/visit. See docs/storefront/feed.md, "One view (ZP-514)".

The shared visit helpers stay in `src/lib/storefront/visit-model.ts`
(`dayInTimeZone`, `directionsLink`, `mapLink`, `mapEmbedUrl`,
`addressLines`, `meaningfulText`), tested in
`tests/storefront-about-visit.test.ts`. The old page views (`AboutView`,
`VisitView`, `MapEmbed`, `info-model`) are gone.
