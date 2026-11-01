"use client";

// ZP-508: the approved reviews of a piece, 5 at a time with "Show more".
// Items arrive already formatted by the server (relative date), so the
// server and browser render the same text.
import { useState } from "react";

export const REVIEWS_PAGE_SIZE = 5;

export type ReviewListItem = {
  stars: number;
  starsText: string;
  starsLabel: string;
  comment: string;
  name: string;
  /** "2 weeks ago" */
  date: string;
  /** ISO, for <time dateTime>. */
  dateTime: string;
  reply: string | null;
  photo: { url: string; srcSet: string; alt: string } | null;
};

export function ReviewList({ items }: { items: ReviewListItem[] }) {
  const [shown, setShown] = useState(REVIEWS_PAGE_SIZE);
  const visible = items.slice(0, shown);
  const more = items.length - visible.length;
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
        {visible.map((r, i) => (
          <li key={`${r.dateTime}-${i}`}>
            <article className="flex flex-col gap-2 border-b border-brand-ink/10! pb-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="tracking-[0.06em] text-brand-olive-700" role="img" aria-label={r.starsLabel}>
                  {r.starsText}
                </span>
                <time dateTime={r.dateTime} className="text-xs text-brand-ink-soft">
                  {r.date}
                </time>
              </div>
              <p className="m-0 whitespace-pre-line break-words text-[15px] leading-relaxed text-brand-ink">{r.comment}</p>
              {r.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- storefront photos use <img srcset> (public data layer)
                <img
                  src={r.photo.url}
                  srcSet={r.photo.srcSet}
                  sizes="96px"
                  alt={r.photo.alt}
                  width={96}
                  height={120}
                  loading="lazy"
                  decoding="async"
                  className="block h-[120px] w-24 rounded-[2px] object-cover"
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium">{r.name}</span>
                <span className="inline-flex items-center gap-1 rounded-[2px] bg-brand-olive-100 px-[7px] py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-olive-800">
                  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                  Verified buyer
                </span>
              </div>
              {r.reply ? (
                <div className="ml-3 border-l-2 border-brand-olive! bg-brand-cream-100 px-3 py-2.5 text-[13px] leading-normal text-brand-ink-soft">
                  <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-olive-700">Reply from VYRA</span>
                  <span className="whitespace-pre-line break-words">{r.reply}</span>
                </div>
              ) : null}
            </article>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + REVIEWS_PAGE_SIZE)}
          className="sf-focus inline-flex min-h-11 items-center justify-center self-start rounded-[2px] border border-brand-ink/25! px-4 text-[13px] font-medium uppercase tracking-[0.14em] text-brand-ink hover:border-brand-ink!"
        >
          Show more reviews ({more})
        </button>
      ) : null}
    </>
  );
}
