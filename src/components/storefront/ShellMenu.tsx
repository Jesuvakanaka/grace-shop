"use client";

import Link from "next/link";
import type { RefObject } from "react";
import { Wordmark } from "./Brand";
import { CloseIcon, WhatsAppIcon } from "./icons";
import { SocialIcons } from "./SocialIcons";
import type { NavItem, SocialLink } from "./types";

const iconButton =
  "sf-focus inline-flex h-11 w-11 items-center justify-center rounded-[2px] text-brand-ink transition-colors duration-200 hover:bg-brand-ink/5";

type ShellMenuDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  id: string;
  nav: NavItem[];
  whatsappHref?: string | null;
  social?: SocialLink[];
  /** href of the current page, for aria-current. */
  current?: string;
  /** Runs when the dialog closes (Esc, close button or a link). */
  onClose: () => void;
};

/**
 * The storefront menu (ZP-487), moved out of Header so the full-screen
 * landing feed (ZP-500), which has no header, opens the same menu. A native
 * modal <dialog>: full-screen cream, large serif links, focus trapped, Esc
 * closes it. The opener calls dialogRef.current.showModal() and restores
 * focus in onClose. ZP-503 redesigns it.
 */
export function ShellMenuDialog({ dialogRef, id, nav, whatsappHref, social = [], current, onClose }: ShellMenuDialogProps) {
  const closeMenu = () => dialogRef.current?.close();
  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-label="Menu"
      onClose={onClose}
      className="sf-dialog bg-brand-cream text-brand-ink backdrop:bg-brand-cream"
    >
      <div className="flex min-h-full flex-col px-2 pb-10 sm:px-4">
        <div className="grid h-16 grid-cols-[44px_1fr_44px] items-center gap-2">
          <button type="button" className={iconButton} aria-label="Close menu" onClick={closeMenu}>
            <CloseIcon />
          </button>
          <Wordmark className="h-[18px] w-auto justify-self-center" title="" />
        </div>
        <nav aria-label="Main" className="mt-8 px-4">
          <ul className="flex flex-col">
            {nav.map((item) => (
              <li key={item.href} className="border-b border-brand-ink/10!">
                <Link
                  href={item.href}
                  onClick={closeMenu}
                  aria-current={item.href === current ? "page" : undefined}
                  className="sf-focus flex min-h-16 items-center rounded-[2px] font-serif text-[2.5rem] font-medium leading-[1.1] text-brand-ink aria-[current=page]:text-brand-olive-700"
                >
                  {item.label}
                </Link>
                {item.children?.length ? (
                  <ul aria-label={item.label} className="-mt-1 flex flex-wrap gap-x-5 pb-4">
                    {item.children
                      .filter((child) => child.href !== item.href)
                      .map((child) => (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            onClick={closeMenu}
                            aria-current={child.href === current ? "page" : undefined}
                            className="sf-focus sf-label-lg inline-flex min-h-11 items-center rounded-[2px] text-brand-ink-soft hover:text-brand-ink aria-[current=page]:text-brand-olive-700"
                          >
                            {child.label}
                          </Link>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto flex flex-col gap-6 px-4 pt-12">
          {whatsappHref ? (
            <a
              href={whatsappHref}
              className="sf-focus sf-label-lg inline-flex min-h-11 w-fit items-center gap-3 rounded-[2px] text-brand-ink"
            >
              <WhatsAppIcon className="h-6 w-6" />
              Chat with us on WhatsApp
            </a>
          ) : null}
          {social.length > 0 ? <SocialIcons social={social} tone="light" /> : null}
        </div>
      </div>
    </dialog>
  );
}
