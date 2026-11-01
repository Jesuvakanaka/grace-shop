"use client";

// ZP-508: the customer review form and thank-you screen (Review.dc.html).
// Stars are real buttons (aria-pressed) in a fieldset; nothing is
// preselected. The comment counter mirrors the server rule (10-1000). The
// name shows as "First L." (deriveDisplayName, same code as the server). The
// optional photo uploads at once through the token-gated endpoint (it is
// re-encoded there with all metadata and location removed); it is shown on
// the site only with the consent box ticked and after VYRA approves the
// review. The server validates everything again.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  LINK_MESSAGES,
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN,
  REVIEW_NAME_MAX,
  REVIEW_PHOTO_MAX_BYTES,
  REVIEW_TOKEN_HEADER,
  deriveDisplayName,
  normaliseComment,
} from "@/lib/reviews/rules";
import { Wordmark } from "../Brand";
import { cn } from "../cn";

type Piece = { name: string; image: { url: string; srcSet: string; alt: string } | null };

type Props = {
  token: string;
  /** null = shop-only review. */
  piece: Piece | null;
  nameHint: string | null;
  googleReviewUrl: string | null;
  homeHref: string;
};

type PhotoState =
  | { kind: "none" }
  | { kind: "uploading"; preview: string }
  | { kind: "ready"; preview: string }
  | { kind: "failed"; message: string };

const labelClass = "text-xs font-medium uppercase tracking-[0.16em]";
const hintClass = "text-xs text-brand-ink-soft";
const fieldClass =
  "sf-focus box-border w-full rounded-[2px] border border-brand-ink/30! bg-white px-3 text-[15px] text-brand-ink";

function StarRow({
  value,
  onPick,
  size,
  idPrefix,
}: {
  value: number;
  onPick: (n: number) => void;
  size: "lg" | "md";
  idPrefix: string;
}) {
  return (
    <div className={cn("flex", size === "lg" ? "gap-1.5" : "gap-1")}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          id={`${idPrefix}-${n}`}
          type="button"
          aria-pressed={value === n}
          aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
          onClick={() => onPick(value === n && size === "md" ? 0 : n)}
          className={cn(
            "sf-focus m-0 cursor-pointer rounded-[2px] border-0 bg-transparent p-0 leading-none transition-colors",
            size === "lg" ? "h-12 w-12 text-[34px]" : "h-11 w-11 text-[28px]",
            n <= value ? "text-brand-olive" : "text-brand-ink/25",
          )}
        >
          <span aria-hidden="true">★</span>
        </button>
      ))}
    </div>
  );
}

export function ReviewForm({ token, piece, nameHint, googleReviewUrl, homeHref }: Props) {
  const uid = useId();
  const [stars, setStars] = useState(0);
  const [shopStars, setShopStars] = useState(0);
  const [comment, setComment] = useState("");
  const [name, setName] = useState(nameHint ?? "");
  const [photo, setPhoto] = useState<PhotoState>({ kind: "none" });
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ firstName: string } | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const thanksRef = useRef<HTMLHeadingElement>(null);

  const shopOnly = piece === null;
  const length = Array.from(normaliseComment(comment)).length;
  const shownName = deriveDisplayName(name);
  const canSubmit = stars > 0 && length >= REVIEW_COMMENT_MIN && length <= REVIEW_COMMENT_MAX && !!shownName && photo.kind !== "uploading" && !sending;

  // Free the local preview when it changes or the form goes away.
  const preview = photo.kind === "ready" || photo.kind === "uploading" ? photo.preview : null;
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    // The thank-you screen is shorter than the form: start it at the top.
    if (done) {
      window.scrollTo({ top: 0 });
      thanksRef.current?.focus({ preventScroll: true });
    }
  }, [done]);

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (file.size > REVIEW_PHOTO_MAX_BYTES) {
      setPhoto({ kind: "failed", message: `That photo is too large (max ${REVIEW_PHOTO_MAX_BYTES / 1024 / 1024} MB).` });
      return;
    }
    const local = URL.createObjectURL(file);
    setPhoto({ kind: "uploading", preview: local });
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch("/api/public/reviews/photo", {
        method: "POST",
        body,
        credentials: "same-origin",
        headers: { [REVIEW_TOKEN_HEADER]: token },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setPhoto({ kind: "ready", preview: local });
      else {
        URL.revokeObjectURL(local);
        if (res.status === 410) setClosed(data.error ?? LINK_MESSAGES.used);
        setPhoto({ kind: "failed", message: data.error ?? "The photo could not be uploaded. Please try again." });
      }
    } catch {
      URL.revokeObjectURL(local);
      setPhoto({ kind: "failed", message: "The photo could not be uploaded. Please check your connection." });
    }
  }

  function removePhoto() {
    setPhoto({ kind: "none" });
    setConsent(false);
    if (fileRef.current) fileRef.current.value = "";
    // Delete it on the server too (best effort; an unused photo is also swept nightly).
    fetch("/api/public/reviews/photo", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { [REVIEW_TOKEN_HEADER]: token },
    }).catch(() => {});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setErrors({});
    const withPhoto = photo.kind === "ready";
    try {
      const res = await fetch("/api/public/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          token,
          stars,
          ...(shopOnly ? {} : { shopStars: shopStars || null }),
          comment,
          name,
          photo: withPhoto,
          photoConsent: withPhoto && consent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) setDone({ firstName: data.firstName ?? "" });
      else if (res.status === 410) setClosed(data.error ?? LINK_MESSAGES.used);
      else if (res.status === 400 && data.errors) setErrors(data.errors);
      else setErrors({ form: data.error ?? "Something went wrong. Please try again." });
    } catch {
      setErrors({ form: "Your review could not be sent. Please check your connection and try again." });
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-[480px] bg-brand-cream-50 text-brand-ink">
        <div className="flex flex-col items-center gap-[18px] px-7 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-olive-100 text-brand-olive-800">
            <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
          <h1 ref={thanksRef} tabIndex={-1} className="m-0 font-serif text-[32px] font-medium leading-[1.1] focus:outline-none">
            {done.firstName ? `Thank you, ${done.firstName}` : "Thank you"}
          </h1>
          <p className="m-0 text-[15px] leading-relaxed text-brand-ink-soft">Your review will appear on the site once we have checked it.</p>
          {googleReviewUrl ? (
            <div className="mt-2.5 flex w-full flex-col gap-3 rounded-[2px] bg-brand-cream-200 p-[18px]">
              <span className="text-sm leading-normal">Would you also leave us a Google review? It helps other women find VYRA.</span>
              <a
                href={googleReviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sf-focus inline-flex min-h-12 items-center justify-center rounded-[2px] border border-brand-ink! text-[13px] font-medium uppercase tracking-[0.14em] text-brand-ink hover:bg-brand-ink hover:text-brand-cream"
              >
                Review us on Google
              </a>
            </div>
          ) : null}
          <a href={homeHref} className="sf-focus mt-2 inline-flex min-h-11 items-center rounded-[2px] text-sm text-brand-olive-700 underline underline-offset-4">
            See the collection
          </a>
          <span className="mt-2 text-xs font-medium uppercase tracking-[0.26em]">Wear different.</span>
        </div>
      </div>
    );
  }

  if (closed) {
    return (
      <div className="mx-auto max-w-[480px] bg-brand-cream-50 text-brand-ink">
        <div className="flex flex-col items-center gap-4 px-7 py-16 text-center">
          <h1 className="m-0 font-serif text-[28px] font-medium leading-tight">{closed}</h1>
          <a href={homeHref} className="sf-focus inline-flex min-h-11 items-center rounded-[2px] text-sm text-brand-olive-700 underline underline-offset-4">
            See the collection
          </a>
        </div>
      </div>
    );
  }

  const commentHint =
    length < REVIEW_COMMENT_MIN ? `At least ${REVIEW_COMMENT_MIN} characters (${length} so far).` : `${length} / ${REVIEW_COMMENT_MAX}`;

  return (
    <div className="mx-auto max-w-[480px] bg-brand-cream-50 text-brand-ink">
      <form onSubmit={submit} noValidate className="flex flex-col gap-[22px] px-5 pb-8 pt-[22px]">
        <div className="flex items-center gap-3.5">
          {piece?.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- storefront photos use <img srcset>
            <img
              src={piece.image.url}
              srcSet={piece.image.srcSet}
              sizes="72px"
              alt={piece.image.alt}
              width={72}
              height={90}
              className="h-[90px] w-[72px] shrink-0 rounded-[2px] object-cover"
            />
          ) : shopOnly ? (
            <span className="flex h-[90px] w-[72px] shrink-0 items-center justify-center rounded-[2px] bg-brand-cream-200">
              <Wordmark className="h-3 w-auto text-brand-ink" title="" />
            </span>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand-olive-700">Your review</span>
            <h1 className="m-0 font-serif text-2xl font-semibold leading-[1.1]">{piece ? piece.name : "The VYRA shop"}</h1>
            <span className="text-[13px] text-brand-ink-soft">Thank you for shopping with VYRA</span>
          </div>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={errors.stars ? `${uid}-stars-error` : undefined}>
          <legend className={cn(labelClass, "pb-2")}>{shopOnly ? "How do you rate the VYRA shop?" : "How do you rate this piece?"}</legend>
          <StarRow value={stars} onPick={setStars} size="lg" idPrefix={`${uid}-star`} />
          {errors.stars ? (
            <span id={`${uid}-stars-error`} className="text-xs text-rose-700">
              {errors.stars}
            </span>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${uid}-comment`} className={labelClass}>
            Tell other shoppers about it
          </label>
          <textarea
            id={`${uid}-comment`}
            rows={5}
            value={comment}
            maxLength={REVIEW_COMMENT_MAX + 50}
            onChange={(e) => setComment(e.target.value)}
            placeholder={shopOnly ? "Service, the store, WhatsApp help…" : "Fit, fabric, where you wore it…"}
            aria-describedby={`${uid}-comment-hint`}
            aria-invalid={errors.comment ? true : undefined}
            className={cn(fieldClass, "resize-y py-3 leading-normal")}
          />
          <span id={`${uid}-comment-hint`} className={cn(hintClass, errors.comment && "text-rose-700")} aria-live="polite">
            {errors.comment ?? commentHint}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${uid}-name`} className={labelClass}>
            Your name
          </label>
          <input
            id={`${uid}-name`}
            type="text"
            autoComplete="given-name"
            value={name}
            maxLength={REVIEW_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={`${uid}-name-hint`}
            aria-invalid={errors.name ? true : undefined}
            className={cn(fieldClass, "min-h-12")}
          />
          <span id={`${uid}-name-hint`} className={cn(hintClass, errors.name && "text-rose-700")}>
            {errors.name ?? `Shown as “${shownName ?? "First name and initial"}”. Your phone number is never shown.`}
          </span>
        </div>

        {!shopOnly ? (
          <div className="flex flex-col gap-2.5">
            <span className={labelClass} id={`${uid}-photo-label`}>
              Add a photo of you wearing it (optional)
            </span>
            <div className="flex items-center gap-3">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL), never uploaded from here
                <img src={preview} alt="Your photo" width={72} height={90} className="h-[90px] w-[72px] rounded-[2px] object-cover" />
              ) : null}
              <input
                ref={fileRef}
                id={`${uid}-photo`}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-labelledby={`${uid}-photo-label`}
                onChange={(e) => choosePhoto(e.target.files?.[0])}
              />
              {photo.kind === "ready" || photo.kind === "uploading" ? (
                <button
                  type="button"
                  onClick={removePhoto}
                  disabled={photo.kind === "uploading"}
                  className="sf-focus min-h-12 cursor-pointer rounded-[2px] border border-dashed border-brand-ink/45! bg-transparent px-4 text-[13px] tracking-[0.08em] text-brand-ink disabled:opacity-60"
                >
                  {photo.kind === "uploading" ? "Uploading…" : "Remove photo"}
                </button>
              ) : (
                <label
                  htmlFor={`${uid}-photo`}
                  className="sf-focus-within inline-flex min-h-12 cursor-pointer items-center rounded-[2px] border border-dashed border-brand-ink/45! px-4 text-[13px] tracking-[0.08em] text-brand-ink"
                >
                  Choose a photo
                </label>
              )}
            </div>
            {photo.kind === "failed" ? <span className="text-xs text-rose-700" role="alert">{photo.message}</span> : null}
            {errors.photo ? <span className="text-xs text-rose-700">{errors.photo}</span> : null}
            {photo.kind === "ready" ? (
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-normal text-brand-ink-soft">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-px h-5 w-5 shrink-0 accent-brand-olive-700"
                />
                VYRA may show this photo with my review on the website.
              </label>
            ) : null}
            <span className={hintClass}>
              Location and camera details are removed from the photo. Without the tick, the photo is deleted when you send your review.
            </span>
          </div>
        ) : null}

        {!shopOnly ? (
          <fieldset className="m-0 flex flex-col gap-1.5 rounded-[2px] border border-brand-ink/12! px-3.5 pb-3 pt-3.5">
            <legend className={cn(labelClass, "px-1.5")}>And the VYRA shop? (optional)</legend>
            <StarRow value={shopStars} onPick={setShopStars} size="md" idPrefix={`${uid}-shop`} />
            <span className={hintClass}>Service, store, WhatsApp help.</span>
          </fieldset>
        ) : null}

        {errors.form ? (
          <p className="m-0 text-sm text-rose-700" role="alert">
            {errors.form}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "sf-focus min-h-[52px] cursor-pointer rounded-[2px] border-0 text-[13px] font-medium uppercase tracking-[0.16em] text-brand-cream-50 transition-colors",
            canSubmit ? "bg-brand-olive hover:bg-brand-olive-700" : "cursor-not-allowed bg-brand-ink/35",
          )}
        >
          {sending ? "Sending…" : "Send my review"}
        </button>
        <span className="text-center text-xs leading-normal text-brand-ink-soft">
          Reviews appear once VYRA has checked them. This link works once.
        </span>
      </form>
    </div>
  );
}
