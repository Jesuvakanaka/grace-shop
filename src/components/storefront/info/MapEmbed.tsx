"use client";

import { useState } from "react";
import { buttonClasses } from "../Button";
import { MapPinIcon } from "../icons";

// ZP-491: click-to-load Google map. Nothing is requested from Google until
// the visitor asks for the map; the "Open in Google Maps" link works without it.
export function MapEmbed({ src, label }: { src: string; label: string }) {
  const [shown, setShown] = useState(false);
  if (shown) {
    return (
      <div className="relative w-full overflow-hidden bg-brand-cream-100" style={{ aspectRatio: "4 / 3" }}>
        <iframe
          src={src}
          title={label}
          loading="lazy"
          // Google's embed needs scripts and its own origin; "Open in Maps" opens a new tab.
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" onClick={() => setShown(true)} className={buttonClasses("ghost")}>
        <MapPinIcon className="h-4 w-4 shrink-0" />
        <span>Show map</span>
      </button>
      <p className="font-sans text-xs text-brand-ink-soft">The map loads from Google when you choose to show it.</p>
    </div>
  );
}
