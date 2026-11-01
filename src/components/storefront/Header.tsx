"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Wordmark } from "./Brand";
import { cn } from "./cn";
import { ChevronDownIcon, CloseIcon, MenuIcon, WhatsAppIcon } from "./icons";
import { SocialIcons } from "./SocialIcons";
import type { NavItem, NavLink, SocialLink } from "./types";

/** Clean paths; real pages pass the prefixed nav from getShellData(). */
export const DEFAULT_NAV: NavItem[] = [
  { label: "Shop", href: "/shop" },
  { label: "Collections", href: "/collections" },
  { label: "New Arrivals", href: "/new" },
  { label: "About", href: "/about" },
  { label: "Visit Us", href: "/visit" },
];

type HeaderProps = {
  nav?: NavItem[];
  homeHref?: string;
  /** wa.me link with the general enquiry message. null/undefined hides the WhatsApp button. */
  whatsappHref?: string | null;
  /** Social profiles shown in the phone menu. */
  social?: SocialLink[];
  /** href of the current page, to mark the active nav item. Default: the current pathname. */
  currentHref?: string;
};

const iconButton =
  "sf-focus inline-flex h-11 w-11 items-center justify-center rounded-[2px] text-brand-ink transition-colors duration-200 hover:bg-brand-ink/5";

const desktopLink =
  "sf-focus sf-label relative inline-flex min-h-11 items-center gap-1.5 rounded-[2px] px-3.5 text-brand-ink transition-colors duration-200 hover:text-brand-olive-700 " +
  "after:absolute after:inset-x-3.5 after:bottom-2 after:h-0.5 after:origin-left after:bg-brand-olive-700 after:transition-transform after:duration-200";

/** The page `href` is on, or a page below it ("/site/collections/x" is under Collections). Home only matches itself. */
function isActive(href: string, current: string | undefined, homeHref: string): boolean {
  if (!current) return false;
  if (href === current) return true;
  return href !== homeHref && current.startsWith(`${href}/`);
}

/** Desktop "Collections" disclosure: a button that shows the category links. */
function NavDisclosure({ item, active, current }: { item: NavItem & { children: NavLink[] }; active: boolean; current?: string }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };
  const onBlur = (event: FocusEvent) => {
    if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  return (
    <li ref={wrapperRef} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(desktopLink, active || open ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100")}
      >
        {item.label}
        <ChevronDownIcon className={cn("sf-motion h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 border border-brand-ink/10! bg-brand-cream py-3"
      >
        <ul>
          {item.children.map((child) => (
            <li key={child.href}>
              <Link
                href={child.href}
                onClick={() => setOpen(false)}
                aria-current={child.href === current ? "page" : undefined}
                className="sf-focus flex min-h-11 items-center px-5 font-serif text-xl font-medium text-brand-ink transition-colors duration-200 hover:bg-brand-cream-100 hover:text-brand-olive-700 aria-[current=page]:text-brand-olive-700"
              >
                {child.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

/**
 * Sticky cream header. Hairline border appears once the page scrolls.
 * Phones: hamburger, centred wordmark, WhatsApp. Desktop: the wordmark lockup
 * with WEAR DIFFERENT, nav (Collections opens the category list), WhatsApp.
 * The phone menu is a native modal <dialog>: full-screen cream, large serif
 * links, focus trapped, Esc closes it and focus returns to the hamburger.
 */
export function Header({ nav = DEFAULT_NAV, homeHref = "/", whatsappHref, social = [], currentHref }: HeaderProps) {
  const pathname = usePathname();
  const current = currentHref ?? pathname ?? undefined;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

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
    setMenuOpen(true);
  };
  const closeMenu = () => dialogRef.current?.close();
  const onDialogClose = () => {
    document.documentElement.style.overflow = "";
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };

  const whatsappButton = whatsappHref ? (
    <a href={whatsappHref} className={cn(iconButton, "justify-self-end")} aria-label="Chat with us on WhatsApp">
      <WhatsAppIcon className="h-6 w-6" />
    </a>
  ) : (
    // Keeps the phone wordmark centred when no WhatsApp number is set.
    <span aria-hidden="true" className="h-11 w-11 lg:hidden" />
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b bg-brand-cream/95 backdrop-blur-sm transition-colors duration-200",
        scrolled ? "border-brand-ink/10!" : "border-transparent!",
      )}
    >
      <div className="mx-auto grid h-16 max-w-[1200px] grid-cols-[44px_1fr_44px] items-center gap-2 px-2 sm:px-4 lg:flex lg:h-24 lg:justify-between lg:gap-8 lg:px-8">
        <button
          ref={menuButtonRef}
          type="button"
          className={cn(iconButton, "lg:hidden")}
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-controls={dialogId}
          onClick={openMenu}
        >
          <MenuIcon />
        </button>

        <Link
          href={homeHref}
          aria-label="VYRA – Wear Different, home"
          className="sf-focus inline-flex min-h-11 items-center justify-self-center rounded-[2px] px-2 lg:-ml-2"
        >
          <Wordmark className="h-[18px] w-auto text-brand-ink lg:hidden" title="" />
          {/* The tagline only reads at 200px wide and up (brand kit), so only on desktop. */}
          <Wordmark tagline className="hidden h-auto w-[200px] text-brand-ink lg:block" title="" />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => {
              const active = isActive(item.href, current, homeHref);
              if (item.children?.length) {
                return (
                  <NavDisclosure
                    key={item.href}
                    item={item as NavItem & { children: NavLink[] }}
                    active={active}
                    current={current}
                  />
                );
              }
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={item.href === current ? "page" : undefined}
                    className={cn(desktopLink, active ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100")}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {whatsappButton}
      </div>

      <dialog
        ref={dialogRef}
        id={dialogId}
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
    </header>
  );
}
