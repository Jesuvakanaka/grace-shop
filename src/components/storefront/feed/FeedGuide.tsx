"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject, type WheelEvent } from "react";
import {
  advanceGuide,
  guideNextLabel,
  guideProgressLabel,
  guideRing,
  guideSteps,
  type GuideLayout,
  type GuideMotion,
  type GuideRing,
} from "@/lib/storefront/feed-guide";
import { track } from "@/lib/analytics/client";
import { cn } from "../cn";
import { ChevronIcon } from "./feed-icons";

/** The ring around the eye button (design: 60px, plus a 52px lime ring). */
const RING_SIZE = 60;
/** A swipe on the layer of at least this many pixels counts as doing the step's gesture. */
const SWIPE_PX = 40;
/** The fingertip inside the 64px finger box (the SVG's lime dot), so the tip lands on the eye. */
const FINGERTIP = { x: 22, y: 10 };

// The finger animations from the approved design (vy-anim-*). React hoists
// and dedupes this <style> (href + precedence). Reduced motion: no
// animation, and static arrows next to the finger instead.
const GUIDE_CSS = `
@keyframes vy-guide-up{0%{transform:translateY(80px);opacity:0}15%{opacity:1}70%{transform:translateY(-80px);opacity:1}100%{transform:translateY(-100px);opacity:0}}
@keyframes vy-guide-side{0%{transform:translateX(80px);opacity:0}15%{opacity:1}70%{transform:translateX(-80px);opacity:1}100%{transform:translateX(-100px);opacity:0}}
@keyframes vy-guide-tap{0%,55%,100%{transform:scale(1)}30%{transform:scale(0.84)}}
@keyframes vy-guide-ring{0%{transform:scale(0.6);opacity:0.9}100%{transform:scale(1.7);opacity:0}}
.vy-guide-up{animation:vy-guide-up 1.8s ease-in-out infinite}
.vy-guide-side{animation:vy-guide-side 1.8s ease-in-out infinite}
.vy-guide-tap{animation:vy-guide-tap 1.4s ease-in-out infinite}
.vy-guide-ring{animation:vy-guide-ring 1.4s ease-out infinite}
.vy-guide-arrows{display:none}
@media (prefers-reduced-motion: reduce){
.vy-guide-up,.vy-guide-side,.vy-guide-tap,.vy-guide-ring{animation:none}
.vy-guide-ring{opacity:0.6}
.vy-guide-arrows{display:flex}
}
`;

const animClass: Record<GuideMotion, string> = { up: "vy-guide-up", side: "vy-guide-side", tap: "vy-guide-tap" };

type Box = { left: number; top: number; width: number; height: number };

type FeedGuideProps = {
  /** The feed column (full screen on phones, the phone-shaped column on computers). */
  frameRef: RefObject<HTMLElement | null>;
  /** The current look's eye button ("Show details"), for step 3's ring. */
  findEye: () => Element | null;
  /** Finished, skipped or closed with Escape. */
  onDone: () => void;
  /** Focus goes here afterwards when the element focused before is gone. */
  fallbackFocus: () => void;
};

function FingerIcon() {
  return (
    <svg
      width="60"
      height="60"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FBF9F4"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))" }}
    >
      <circle cx="8" cy="3.2" r="2.6" fill="rgba(155,178,30,0.55)" stroke="none" />
      <path d="M10 9.5V4a2 2 0 0 0-4 0v10" />
      <path d="M14 10V9a2 2 0 0 0-4 0v1" />
      <path d="M18 11v-1a2 2 0 0 0-4 0" />
      <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

/**
 * ZP-509: the first-visit guide. A native modal <dialog> (showModal: focus
 * moves in and stays in, the feed behind is inert, Escape skips) over the
 * first look, with a see-through dark layer and an animated finger:
 * 1 Swipe up, 2 Swipe sideways, 3 Tap for details (the finger taps the real
 * eye button, ringed from its measured rect). "1 of 3", dots, Skip and
 * Next / Got it; tapping the layer advances, and doing the step's gesture on
 * it (a swipe up, a swipe sideways, the mouse wheel down) completes the step.
 * Focus returns to where it was. See docs/storefront/feed.md.
 */
export function FeedGuide({ frameRef, findEye, onDone, fallbackFocus }: FeedGuideProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  /** The last pointer gesture completed a step: ignore the click that follows it. */
  const swiped = useRef(false);
  const [step, setStep] = useState(0);
  const [layout, setLayout] = useState<GuideLayout>("touch");
  const [frame, setFrame] = useState<Box | null>(null);
  const [ring, setRing] = useState<GuideRing | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const progressId = useId();

  const steps = guideSteps(layout);
  const tip = steps[Math.min(step, steps.length - 1)];

  const measure = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setFrame({ left: r.left, top: r.top, width: r.width, height: r.height });
    setRing(guideRing(findEye()?.getBoundingClientRect(), r, RING_SIZE));
  }, [frameRef, findEye]);

  // Open on mount: remember focus, show modally, focus Next.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    returnTo.current = document.activeElement;
    const desktop = window.matchMedia("(min-width: 768px) and (pointer: fine)").matches;
    const timer = setTimeout(() => setLayout(desktop ? "desktop" : "touch"));
    if (!d.open) d.showModal();
    nextButton.current?.focus();
    return () => {
      clearTimeout(timer);
      if (d.open) d.close();
    };
  }, []);

  // Position the layer on the feed column and the ring on the eye; again on resize.
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, step]);

  // ZP-493: guide_step for every step shown (1-based), then guide_completed
  // (Got it on the last step) or guide_skipped (Skip, Escape) with the step.
  const completed = useRef(false);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
    track("guide_step", { step: step + 1 });
  }, [step]);

  const finish = () => dialog.current?.close();
  const next = () => {
    const to = advanceGuide(step, steps.length);
    if (to === null) {
      completed.current = true;
      finish();
      return;
    }
    setStep(to);
    // A tap on the layer would otherwise leave focus on the dialog itself.
    nextButton.current?.focus({ preventScroll: true });
  };

  const onClose = () => {
    // A close queued by an effect cleanup (dev Strict Mode re-runs the mount
    // effect) arrives after it reopened: not the visitor closing it.
    if (dialog.current?.open) return;
    if (completed.current) track("guide_completed");
    else track("guide_skipped", { step: stepRef.current + 1 });
    const back = returnTo.current;
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
    else fallbackFocus();
    onDone();
  };

  // A tap on the layer (anything but the buttons) advances.
  const onLayerClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if ((event.target as Element).closest("button")) return;
    // A mouse drag recognised as the step's gesture also ends in a click: one step only.
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    next();
  };
  // Doing the real gesture completes that step.
  const onPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    swipe.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };
  const onPointerUp = (event: PointerEvent<HTMLDialogElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const done =
      (tip.motion === "up" && -dy > SWIPE_PX && Math.abs(dy) > Math.abs(dx)) ||
      (tip.motion === "side" && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy));
    if (done) {
      swiped.current = true;
      next();
    }
  };
  const onWheel = (event: WheelEvent<HTMLDialogElement>) => {
    if (tip.motion === "up" && event.deltaY > 20) next();
  };

  const h = frame?.height ?? 0;
  const w = frame?.width ?? 0;
  // Finger: centred, a little below the middle (design 470/844); on step 3 its tip on the eye.
  const finger =
    tip.motion === "tap" && ring
      ? { left: ring.centerX - FINGERTIP.x, top: ring.centerY - FINGERTIP.y }
      : { left: w / 2 - 32, top: h * 0.557 };
  const textTop = tip.motion === "tap" ? h * 0.355 : h * 0.284;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={`${progressId} ${bodyId}`}
      onClose={onClose}
      onClick={onLayerClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      // Full screen, transparent: the dark layer is the backdrop (70% ink keeps cream and lime text above 4.5:1 on white photos).
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none cursor-pointer touch-none overflow-hidden overscroll-contain border-0 bg-transparent p-0 text-brand-cream-50 backdrop:bg-[rgba(20,20,18,0.7)]"
    >
      <style href="vyra-feed-guide" precedence="default">
        {GUIDE_CSS}
      </style>
      {/* Measured before the first paint (layout effect); the whole screen until then. */}
      <div className="absolute" style={frame ?? { left: 0, top: 0, width: "100%", height: "100%" }}>
        {tip.motion === "tap" && ring ? (
          <>
            <span
              aria-hidden="true"
              className="vy-guide-ring pointer-events-none absolute rounded-full border-2 border-brand-cream-50"
              style={{ left: ring.left, top: ring.top, width: ring.size, height: ring.size }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full shadow-[0_0_0_3px_#9bb21e]"
              style={{ left: ring.left + 4, top: ring.top + 4, width: ring.size - 8, height: ring.size - 8 }}
            />
          </>
        ) : null}

        <div aria-hidden="true" className="pointer-events-none absolute" style={finger}>
          <div className={cn("flex h-16 w-16 items-center justify-center", animClass[tip.motion])}>
            <FingerIcon />
          </div>
          {/* Reduced motion: a still finger with arrows showing the direction. */}
          {tip.motion === "up" ? (
            <span className="vy-guide-arrows absolute -top-9 left-[10px] flex-col items-center">
              <ChevronIcon direction="up" className="h-7 w-7" />
            </span>
          ) : tip.motion === "side" ? (
            <span className="vy-guide-arrows absolute left-[-36px] right-[-36px] top-[10px] justify-between">
              <ChevronIcon direction="left" className="h-7 w-7" />
              <ChevronIcon direction="right" className="h-7 w-7" />
            </span>
          ) : null}
        </div>

        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-7 flex flex-col items-center gap-2.5 text-center [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]"
          style={{ top: textTop }}
        >
          <span id={progressId} className="text-[11px] font-medium uppercase tracking-[0.2em] text-brand-lime-200">
            {guideProgressLabel(step, steps.length)}
          </span>
          <h2 id={titleId} className="m-0 font-serif text-[30px] font-semibold leading-[1.1]">
            {tip.title}
          </h2>
          <p id={bodyId} className="m-0 text-[15px] leading-normal text-brand-cream-50">
            {tip.body}
          </p>
        </div>

        <div className="absolute inset-x-5 top-[74px] flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="sf-focus min-h-11 rounded-[2px] px-3 text-xs font-medium uppercase tracking-[0.16em] text-brand-cream-50"
          >
            Skip
          </button>
          <div aria-hidden="true" className="flex gap-1.5">
            {steps.map((s, i) => (
              <span key={s.title} className={cn("h-2 w-2 rounded-full", i === step ? "bg-brand-cream-50" : "bg-brand-cream-50/35")} />
            ))}
          </div>
          <button
            ref={nextButton}
            type="button"
            onClick={next}
            className="sf-focus min-h-11 rounded-full bg-brand-olive px-[18px] text-xs font-medium uppercase tracking-[0.16em] text-brand-cream-50 hover:bg-brand-olive-700"
          >
            {guideNextLabel(step, steps.length)}
          </button>
        </div>
      </div>
    </dialog>
  );
}
