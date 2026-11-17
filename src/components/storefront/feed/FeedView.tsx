"use client";

// ZP-543 / ZP-544 (view part): the feed view in the browser. See
// src/lib/storefront/feed-view.ts for the rules and the shared contract.
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  applyFeedView,
  FEED_VIEW_ATTR,
  FEED_VIEW_DEFAULT_MODE,
  feedViewScript,
  previewFromSearch,
  readDatasetView,
  resolveFeedView,
  type FeedView,
  type FeedViewMode,
} from "@/lib/storefront/feed-view";

const ModeContext = createContext<FeedViewMode>(FEED_VIEW_DEFAULT_MODE);

/** The owner's setting for this page load (CLEAN outside the storefront layout). */
export function useFeedViewMode(): FeedViewMode {
  return useContext(ModeContext);
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [FEED_VIEW_ATTR] });
  return () => observer.disconnect();
}

/**
 * The view in effect (<html data-feed-view>), or null while it is not known:
 * on the server and during hydration, so the first client render matches the
 * server HTML (FeedSlide then renders serverViews(), CSS shows the right one).
 */
export function useFeedView(): FeedView | null {
  return useSyncExternalStore(
    subscribe,
    () => readDatasetView(document.documentElement.dataset),
    () => null,
  );
}

/**
 * Rendered first in the storefront layout. Its inline script runs while the
 * HTML is parsed, before anything below it is painted, and sets
 * <html data-feed-view> (and data-feed-view-test for an A/B visit).
 *
 * The script is text/javascript in the server HTML only (Next.js guide
 * "Preventing flash before hydration": React does not run scripts it renders
 * on the client). When this layout mounts without a full page load, nothing
 * set the view yet: it is resolved once here, the same way, before any child
 * effect (analytics' visit_start) reads it.
 */
export function FeedViewProvider({ mode, children }: { mode: FeedViewMode; children: ReactNode }) {
  useState(() => {
    if (typeof document === "undefined" || readDatasetView(document.documentElement.dataset)) return null;
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      // Blocked: random view, not a test visit.
    }
    applyFeedView(
      document.documentElement,
      resolveFeedView({ mode, preview: previewFromSearch(window.location.search), storage, random: Math.random }),
    );
    return null;
  });
  return (
    <ModeContext.Provider value={mode}>
      <script
        type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: feedViewScript(mode) }}
      />
      {children}
    </ModeContext.Provider>
  );
}
