"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "./Brand";
import { cn } from "./cn";
import { CloseIcon, MenuIcon, WhatsAppIcon } from "./icons";
import type { NavLink } from "./types";

export const DEFAULT_NAV: NavLink[] = [
  { label: "Shop", href: "/shop" },
  { label: "Collections", href: "/collections" },
  { label: "New Arrivals", href: "/new" },
  { label: "About", href: "/about" },
  { label: "Visit Us", href: "/visit" },
];

type HeaderProps = {
  nav?: NavLink[];
  homeHref?: string;
  /** WhatsApp chat link (wa.me). The real link logic lands in ZP-490. */
  whatsappHref: string;
  /** href of the current page, to mark the active nav item. */
  currentHref?: string;
};

const iconButton =
  "sf-focus inline-flex h-11 w-11 items-center justify-center rounded-[2px] text-brand-ink transition-colors duration-200 hover:bg-brand-ink/5";

/**
 * Sticky cream header. Hairline border appears once the page scrolls.
 * Phones: hamburger, centred wordmark, WhatsApp. Desktop: wordmark left, nav, WhatsApp.
 * The phone menu is a native modal <dialog>: focus is trapped, Esc closes it,
 * and the page behind is inert.
 */
export function Header({ nav = DEFAULT_NAV, homeHref = "/", whatsappHref, currentHref }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    const frame = requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const openMenu = () => {
    dialogRef.current?.showModal();
    document.documentElement.style.overflow = "hidden";
  };
  const closeMenu = () => dialogRef.current?.close();
  const onDialogClose = () => {
    document.documentElement.style.overflow = "";
    menuButtonRef.current?.focus();
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b bg-brand-cream/95 backdrop-blur-sm transition-colors duration-200",
        scrolled ? "border-brand-ink/10!" : "border-transparent!",
      )}
    >
      <div className="mx-auto grid h-16 max-w-[1200px] grid-cols-[44px_1fr_44px] items-center gap-2 px-2 sm:px-4 lg:flex lg:h-20 lg:justify-between lg:gap-8 lg:px-8">
        <button
          ref={menuButtonRef}
          type="button"
          className={cn(iconButton, "lg:hidden")}
          aria-label="Open menu"
          aria-haspopup="dialog"
          onClick={openMenu}
        >
          <MenuIcon />
        </button>

        <Link href={homeHref} className="sf-focus inline-flex min-h-11 items-center justify-self-center rounded-[2px] px-2 lg:-ml-2">
          <Wordmark className="h-[18px] w-auto text-brand-ink lg:h-5" title="VYRA home" />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => {
              const active = item.href === currentHref;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "sf-focus sf-label relative inline-flex min-h-11 items-center rounded-[2px] px-3.5 text-brand-ink transition-colors duration-200 hover:text-brand-olive-700",
                      "after:absolute after:inset-x-3.5 after:bottom-2 after:h-px after:origin-left after:bg-brand-lime after:transition-transform after:duration-200",
                      active ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <a href={whatsappHref} className={cn(iconButton, "justify-self-end")} aria-label="Chat with us on WhatsApp">
          <WhatsAppIcon className="h-6 w-6" />
        </a>
      </div>

      <dialog
        ref={dialogRef}
        aria-label="Menu"
        onClose={onDialogClose}
        className="sf-dialog bg-brand-cream text-brand-ink backdrop:bg-brand-cream"
      >
        <div className="flex min-h-full flex-col px-2 pb-10 sm:px-4">
          <div className="grid h-16 grid-cols-[44px_1fr_44px] items-center gap-2">
            <button type="button" className={iconButton} aria-label="Close menu" onClick={closeMenu}>
              <CloseIcon />
            </button>
            <Wordmark className="h-[18px] w-auto justify-self-center" title="" />
          </div>
          <nav aria-label="Menu" className="mt-10 px-4">
            <ul className="flex flex-col gap-1">
              {nav.map((item) => (
                <li key={item.href} className="border-b border-brand-ink/10!">
                  <Link
                    href={item.href}
                    onClick={closeMenu}
                    aria-current={item.href === currentHref ? "page" : undefined}
                    className="sf-focus flex min-h-16 items-center rounded-[2px] font-serif text-[2.5rem] font-medium leading-[1.1] text-brand-ink aria-[current=page]:text-brand-olive-700"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-auto px-4 pt-12">
            <a
              href={whatsappHref}
              className="sf-focus sf-label-lg inline-flex min-h-11 items-center gap-3 rounded-[2px] text-brand-ink"
            >
              <WhatsAppIcon className="h-6 w-6" />
              Chat with us on WhatsApp
            </a>
          </div>
        </div>
      </dialog>
    </header>
  );
}
