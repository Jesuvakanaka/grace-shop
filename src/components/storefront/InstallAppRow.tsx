"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { installMode, isIosDevice, type InstallMode } from "@/lib/storefront/install-app";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
};

// The prompt event fires once, whenever the browser decides: kept from when this
// module loads, before the menu is ever opened. It can be used only once.
let deferredPrompt: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentMode(): InstallMode | null {
  const standalone =
    installed ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return installMode({
    standalone,
    canPrompt: deferredPrompt !== null,
    ios: isIosDevice({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }),
  });
}

async function showPrompt() {
  const event = deferredPrompt;
  if (!event) return;
  deferredPrompt = null;
  notify();
  await event.prompt();
}

/** "Install the app" (the menu's row, the pop-up's button): the browser's prompt, or the steps on iPhone and iPad. Hidden when installed. */
export function InstallAppRow({ className }: { className: string }) {
  const mode = useSyncExternalStore(subscribe, currentMode, () => null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const stepsId = useId();
  if (!mode) return null;
  if (mode === "prompt") {
    return (
      <button type="button" onClick={() => void showPrompt()} className={className}>
        Install the app
        <InstallIcon />
      </button>
    );
  }
  return (
    <div>
      <button type="button" aria-expanded={stepsOpen} aria-controls={stepsId} onClick={() => setStepsOpen((v) => !v)} className={className}>
        Install the app
        <InstallIcon />
      </button>
      <p id={stepsId} hidden={!stepsOpen} className="m-0 py-3.5 text-sm leading-relaxed text-brand-ink-soft">
        Tap the Share button in your browser, then Add to Home Screen.
      </p>
    </div>
  );
}

function InstallIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
