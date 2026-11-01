import { CategoryTile } from "../CategoryTile";
import { LOOKBOOK_STEMS, lookbookImage } from "../lookbook";
import { toImageData } from "../product";
import type { PublicImage } from "../types";

export type CollectionTileData = {
  slug: string;
  name: string;
  href: string;
  heroImage: PublicImage | null;
  /** Public products in the category. */
  count: number;
};

// Categories without a hero photo borrow an owner lookbook photo (campaign
// image, not linked to a product), cycling so neighbours differ.
const FALLBACK_STEMS = [
  "chartreuse-fringe-knit-set",
  "bronze-pleated-set",
  "olive-print-jumpsuit",
  "olive-print-pleated-dress",
  "lime-pleated-dress",
] as const satisfies readonly (typeof LOOKBOOK_STEMS)[number][];

/** The /collections index grid: 2 columns on phones, 3 from md. */
export function CollectionTiles({ tiles }: { tiles: CollectionTileData[] }) {
  return (
    <ul role="list" className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-5 md:grid-cols-3 lg:gap-x-6 lg:gap-y-8">
      {tiles.map((t, i) => (
        <li key={t.slug}>
          <CategoryTile
            name={t.name}
            href={t.href}
            image={t.heroImage ? toImageData(t.heroImage) : lookbookImage(FALLBACK_STEMS[i % FALLBACK_STEMS.length], { alt: "" })}
            meta={t.count > 0 ? `${t.count} ${t.count === 1 ? "piece" : "pieces"}` : undefined}
            sizes="(min-width: 1200px) 380px, (min-width: 768px) 33vw, 50vw"
          />
        </li>
      ))}
    </ul>
  );
}
