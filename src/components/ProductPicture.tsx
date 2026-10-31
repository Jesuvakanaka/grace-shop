import Image from 'next/image';

// Product picture thumbnail (ZP-468).
// Pictures are served by the authenticated same-origin route /api/images/...
// (or are data: previews of a file being uploaded). They are already resized
// to web size when stored, and the Next image optimizer would fetch them
// without the user's cookie, so optimization is turned off.
export function ProductPicture({
  src,
  alt,
  size,
  className = '',
  testId = 'product-image',
}: {
  src: string;
  alt: string;
  size: number;
  className?: string;
  testId?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      unoptimized
      loading="lazy"
      className={`object-cover bg-slate-100 ${className}`}
      style={{ width: size, height: size, minWidth: size }}
      data-testid={testId}
    />
  );
}
