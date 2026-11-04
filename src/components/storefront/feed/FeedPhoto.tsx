"use client";

import { useEffect, useRef, useState } from "react";
import { photoFit, type PhotoFit } from "@/lib/storefront/photo-fit";
import { StorefrontImg } from "../StorefrontImage";
import type { StorefrontImageData } from "../types";

type FeedPhotoProps = {
  image: StorefrontImageData;
  eager?: boolean;
  highPriority?: boolean;
  sizes?: string;
};

// ZP-515: a feed photo fills the frame (cover) unless that would cut too
// much of it (src/lib/storefront/photo-fit.ts); then it is shown whole
// (contain) over a blurred copy of itself. Cover until the photo has loaded
// and its size is known; re-checked when the frame resizes.
export function FeedPhoto({ image, eager, highPriority, sizes }: FeedPhotoProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<PhotoFit>("cover");

  useEffect(() => {
    const box = frame.current;
    const img = box?.querySelector<HTMLImageElement>("img.sf-img");
    if (!box || !img) return;
    const update = () =>
      setFit(
        photoFit(
          { width: img.naturalWidth, height: img.naturalHeight },
          { width: box.clientWidth, height: box.clientHeight },
        ),
      );
    if (img.complete) update();
    img.addEventListener("load", update);
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => {
      img.removeEventListener("load", update);
      observer.disconnect();
    };
  }, [image.src]);

  return (
    <div ref={frame} className="absolute inset-0">
      {fit === "contain" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.src}
          srcSet={image.srcSet}
          sizes={sizes}
          alt=""
          aria-hidden="true"
          decoding="async"
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-75"
        />
      ) : null}
      <StorefrontImg
        image={image}
        eager={eager}
        highPriority={highPriority}
        sizes={sizes}
        fit={fit}
        className={fit === "cover" ? "object-[50%_20%]" : undefined}
      />
    </div>
  );
}
