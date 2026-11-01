"use client";

import { useId, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";
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
 * A native modal <dialog>, labelled by its visible "Collections" heading:
 * focus is trapped inside (the opener focuses the current row), Esc closes
 * it, a tap on the backdrop closes it. Cream, a grab handle and one row per
 * collection with its number of looks; the current one is highlighted and
 * aria-current. On computers it is as wide as the phone-shaped feed column.
 */
export function CollectionSheet({ dialogRef, id, tabs, current, onPick, onClose }: CollectionSheetProps) {
  const headingId = useId();
  /** The pointer went down on the backdrop (not a drag that started inside the sheet). */
  const downOnBackdrop = useRef(false);
  // ZP-514: onClose runs at once too (idempotent; the close event follows).
  const close = () => {
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    dialog.close();
    onClose();
  };
  // The dialog box itself (outside the sheet content) is the backdrop. Close
  // only when both pointerdown and click happened there.
  const onPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    downOnBackdrop.current = event.target === event.currentTarget;
  };
  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    const both = downOnBackdrop.current && event.target === event.currentTarget;
    downOnBackdrop.current = false;
    if (both) close();
  };
  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-labelledby={headingId}
      onClose={onClose}
      onPointerDown={onPointerDown}
      onClick={onDialogClick}
      className="fixed inset-x-0 bottom-0 top-auto mx-auto my-0 w-full max-w-full rounded-t-[14px] border-0 bg-brand-cream p-0 text-brand-ink backdrop:bg-[rgba(20,20,18,0.45)] md:max-w-[calc((100svh-32px)*9/16)]"
    >
      <div className="flex flex-col px-6 pb-7 pt-2.5">
        <span aria-hidden="true" className="mb-3.5 h-1 w-10 self-center rounded-[2px] bg-brand-ink/25" />
        <h2 id={headingId} className="m-0 pb-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-brand-olive-700">
          Collections
        </h2>
        {tabs.map((t) => {
          const isCurrent = t.id === current;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => {
                close();
                onPick(t.id);
              }}
              className={cn(
                "sf-focus flex min-h-[52px] items-center justify-between gap-4 rounded-[2px] border-b border-brand-ink/10! text-left font-serif text-[26px] leading-tight",
                isCurrent ? "font-semibold text-brand-olive-700" : "font-medium text-brand-ink",
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
