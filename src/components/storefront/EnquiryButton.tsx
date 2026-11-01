import { cn } from "./cn";
import { WhatsAppIcon } from "./icons";

type EnquiryButtonProps = {
  /** wa.me link. Building it from the product (ZP-490) is not this component's job. */
  href: string;
  label?: string;
  /**
   * "sticky": on phones the button pins to the bottom of the screen while its
   * parent is in view (render it as a direct child of the product <article>, last);
   * hidden from lg up, where an "inline" one sits in the details column.
   */
  placement?: "inline" | "sticky";
  className?: string;
};

const button =
  "sf-focus sf-label-lg flex min-h-[52px] w-full items-center justify-center gap-3 rounded-[2px] bg-brand-olive px-6 py-4 text-white transition-colors duration-200 hover:bg-brand-olive-700";

/** Full-width olive "ENQUIRE ON WHATSAPP" button with the chat glyph. */
export function EnquiryButton({ href, label = "Enquire on WhatsApp", placement = "inline", className }: EnquiryButtonProps) {
  const link = (
    // data-track: ZP-493, counted as whatsapp_enquire / restock_request on the product page (ProductTracking).
    <a href={href} className={button} data-track="enquire">
      <WhatsAppIcon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </a>
  );
  if (placement === "sticky") {
    return (
      <div
        className={cn(
          "sticky bottom-0 z-30 border-t border-brand-ink/10! bg-brand-cream/95 px-4 pt-3 backdrop-blur-sm sm:px-6 lg:hidden",
          "pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]",
          className,
        )}
      >
        {link}
      </div>
    );
  }
  return <div className={className}>{link}</div>;
}
