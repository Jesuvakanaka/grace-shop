"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { GUIDE_TITLE, guideTips, type GuideIcon, type GuideLayout } from "@/lib/storefront/feed-guide";
import { track } from "@/lib/analytics/client";
import { WhatsAppLogoIcon } from "../icons";
import { InstallAppRow } from "../InstallAppRow";
import { ChevronIcon, EyeIcon, MenuLinesIcon } from "./feed-icons";

type FeedGuideProps = {
  /** Closed; `hide`: the visitor chose not to see it again. */
  onDone: (hide: boolean) => void;
  /** Focus goes here afterwards when the element focused before is gone. */
  fallbackFocus: () => void;
};

function FingerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 9.5V4a2 2 0 0 0-4 0v10" />
      <path d="M14 10V9a2 2 0 0 0-4 0v1" />
      <path d="M18 11v-1a2 2 0 0 0-4 0" />
      <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

const icons: Record<GuideIcon, ReactNode> = {
  up: <ChevronIcon direction="up" className="h-5 w-5" />,
  side: (
    <>
      <ChevronIcon direction="left" className="h-4 w-4" />
      <ChevronIcon direction="right" className="h-4 w-4" />
    </>
  ),
  tap: <FingerIcon />,
  eye: <EyeIcon className="h-5 w-5" />,
  contact: <WhatsAppLogoIcon className="h-5 w-5" />,
  menu: <MenuLinesIcon className="h-5 w-5" />,
};

/**
 * ZP-518: the navigation pop-up. A native modal <dialog> (showModal: focus
 * moves in and stays in, the feed behind is inert) listing how to get around
 * the site, and Install the app where the browser allows it (InstallAppRow).
 * Got it closes it for now; "Don't show this again" keeps it away.
 * Escape closes it for now, like Got it. Tapping outside does nothing, so it
 * is not closed by accident. Focus returns to where it was. See docs/storefront/feed.md.
 */
export function FeedGuide({ onDone, fallbackFocus }: FeedGuideProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const gotIt = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);
  const choice = useRef<"got-it" | "hide" | null>(null);
  const mounted = useRef(false);
  const [layout, setLayout] = useState<GuideLayout>("touch");
  const titleId = useId();

  // Open on mount: remember focus, show modally, focus Got it.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    mounted.current = true;
    returnTo.current = document.activeElement;
    const desktop = window.matchMedia("(min-width: 768px) and (pointer: fine)").matches;
    const timer = setTimeout(() => setLayout(desktop ? "desktop" : "touch"));
    if (!d.open) d.showModal();
    gotIt.current?.focus();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      if (d.open) d.close();
    };
  }, []);

  const closeWith = (value: "got-it" | "hide") => {
    choice.current = value;
    dialog.current?.close();
  };

  const onClose = () => {
    // A close from an effect cleanup is not the visitor closing it: the page is
    // leaving, or (dev Strict Mode re-runs the mount effect) it has reopened.
    if (!mounted.current || dialog.current?.open) return;
    if (choice.current === "hide") track("guide_hidden");
    else if (choice.current === "got-it") track("guide_completed");
    else track("guide_skipped", {});
    const back = returnTo.current;
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
    else fallbackFocus();
    onDone(choice.current === "hide");
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[400px] overflow-y-auto overscroll-contain rounded-[4px] border-0 bg-brand-cream-50 p-6 text-brand-ink backdrop:bg-[rgba(20,20,18,0.6)]"
    >
      <h2 id={titleId} className="m-0 font-serif text-[28px] font-semibold leading-[1.1]">
        {GUIDE_TITLE}
      </h2>
      <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
        {guideTips(layout).map((tip) => (
          <li key={tip.title} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-cream-200 text-brand-olive-700"
            >
              {icons[tip.icon]}
            </span>
            <span className="flex flex-col">
              <span className="text-[15px] font-medium leading-snug">{tip.title}</span>
              <span className="text-[13px] leading-snug text-brand-ink-soft">{tip.body}</span>
            </span>
          </li>
        ))}
      </ul>
      <button
        ref={gotIt}
        type="button"
        onClick={() => closeWith("got-it")}
        className="sf-focus mt-5 min-h-12 w-full rounded-[2px] bg-brand-olive px-6 text-[13px] font-medium uppercase tracking-[0.14em] text-white transition-colors duration-200 hover:bg-brand-olive-700"
      >
        Got it
      </button>
      <div className="mt-2">
        <InstallAppRow className="sf-focus flex min-h-12 w-full items-center justify-center gap-2 rounded-[2px] border border-brand-olive-700 px-6 text-[13px] font-medium uppercase tracking-[0.14em] text-brand-olive-700 transition-colors duration-200 hover:bg-brand-cream-200" />
      </div>
      <button
        type="button"
        onClick={() => closeWith("hide")}
        className="sf-focus mt-1 min-h-11 w-full rounded-[2px] text-[13px] text-brand-ink-soft underline decoration-brand-ink/25 underline-offset-4 hover:text-brand-ink"
      >
        Don&apos;t show this again
      </button>
    </dialog>
  );
}
