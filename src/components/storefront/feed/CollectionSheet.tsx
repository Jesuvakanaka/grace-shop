"use client";

import type { MouseEvent, RefObject } from "react";
import { looksLabel, type FeedTab } from "@/lib/storefront/feed";
import { cn } from "../cn";

type CollectionSheetProps = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  id: string;
  tabs: FeedTab[];
  current: string;
  onPick: (id: string) => void;
  /** Runs when the sheet closes (Esc, backdrop or a pick): return focus to the pill. */
  onClose: () => void;
};

/**
 * ZP-500: the collections bottom sheet, opened from the pill in the top bar.
 * A native modal <dialog>: focus moves into it and is trapped there, Esc
 * closes it, a tap on the backdrop closes it. Cream, a grab handle, the
 * "Collections" label and one row per collection with its number of looks;
 * the current one is highlighted and aria-pressed. On computers it is as wide
 * as the phone-shaped feed column.
 */
export function CollectionSheet({ dialogRef, id, tabs, current, onPick, onClose }: CollectionSheetProps) {
  const close = () => dialogRef.current?.close();
  // A click on the dialog box itself (outside the sheet content) is the backdrop.
  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) close();
  };
  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-label="Collections"
      onClose={onClose}
      onClick={onDialogClick}
      className="fixed inset-x-0 bottom-0 top-auto mx-auto my-0 w-full max-w-full rounded-t-[14px] border-0 bg-brand-cream p-0 text-brand-ink backdrop:bg-[rgba(20,20,18,0.45)] md:max-w-[calc((100svh-32px)*9/16)]"
    >
      <div className="flex flex-col px-6 pb-7 pt-2.5">
        <span aria-hidden="true" className="mb-3.5 h-1 w-10 self-center rounded-[2px] bg-brand-ink/25" />
        <span className="pb-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-brand-olive-700">Collections</span>
        {tabs.map((t) => {
          const pressed = t.id === current;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                close();
                onPick(t.id);
              }}
              className={cn(
                "sf-focus flex min-h-[52px] items-center justify-between gap-4 rounded-[2px] border-b border-brand-ink/10! text-left font-serif text-[26px] leading-tight",
                pressed ? "font-semibold text-brand-olive-700" : "font-medium text-brand-ink",
              )}
            >
              <span className="truncate">{t.label}</span>
              <span className="shrink-0 font-sans text-xs font-normal tracking-[0.1em] text-brand-ink-soft">{looksLabel(t.count)}</span>
            </button>
          );
        })}
      </div>
    </dialog>
  );
}
