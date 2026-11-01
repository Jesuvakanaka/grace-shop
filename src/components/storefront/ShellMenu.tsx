"use client";

import Link from "next/link";
import { createContext, useContext, useId, useState, type ReactNode, type RefObject } from "react";
import type { MenuModel } from "@/lib/storefront/menu-model";
import { Wordmark } from "./Brand";
import { cn } from "./cn";
import { ChevronDownIcon, CloseIcon, WhatsAppIcon } from "./icons";
import { SocialIcons } from "./SocialIcons";
import type { NavItem, SocialLink } from "./types";
import { VisitDetails } from "./VisitDetails";

const iconButton =
  "sf-focus inline-flex h-11 w-11 items-center justify-center rounded-[2px] text-brand-ink transition-colors duration-200 hover:bg-brand-ink/5";

const rowClass =
  "sf-focus flex min-h-[52px] w-full items-center justify-between gap-4 rounded-[2px] border-b border-brand-ink/10! text-left text-[13px] font-medium uppercase tracking-[0.18em] text-brand-ink";

// ---------------------------------------------------------------- context

const MenuContext = createContext<MenuModel | null>(null);

/**
 * ZP-503: the menu's data for every storefront page. The site layout wraps
 * the pages in it (getMenuData(), cached reads only), so the header's menu
 * and the landing feed's menu (ZP-500, which has no header) show the same
 * content without the feed passing it down.
 */
export function ShellMenuProvider({ menu, children }: { menu: MenuModel; children: ReactNode }) {
  return <MenuContext.Provider value={menu}>{children}</MenuContext.Provider>;
}

// ----------------------------------------------------------------- dialog

type ShellMenuDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  id: string;
  /** Used only without a ShellMenuProvider (plain link list). */
  nav: NavItem[];
  /** Used only without a ShellMenuProvider; the provider's general-enquiry link wins. */
  whatsappHref?: string | null;
  social?: SocialLink[];
  /** href of the current page, for aria-current. */
  current?: string;
  /** Runs when the dialog closes (Esc, close button or a link). */
  onClose: () => void;
};

/**
 * The storefront menu (ZP-487, redesigned in ZP-503 to match the flip-feed
 * design). A native modal <dialog>: full-screen cream, the rest of the page
 * inert, Esc closes it. The opener calls dialogRef.current.showModal() and
 * returns focus to its button in onClose. Content: close + wordmark,
 * "Collections" (New in and each category with its number of looks, all
 * opening the landing feed at that collection), About VYRA and Visit us
 * (expanding rows), How to use VYRA (replays the guide), Chat on WhatsApp,
 * WEAR DIFFERENT. and the social icons.
 */
export function ShellMenuDialog({ dialogRef, id, nav, whatsappHref, social = [], current, onClose }: ShellMenuDialogProps) {
  const menu = useContext(MenuContext);
  const closeMenu = () => dialogRef.current?.close();
  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-label="Menu"
      onClose={onClose}
      className="sf-dialog bg-brand-cream text-brand-ink backdrop:bg-brand-cream"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col">
        <div className="grid h-[58px] shrink-0 grid-cols-[44px_1fr_44px] items-center gap-2 px-2">
          <button type="button" className={iconButton} aria-label="Close menu" onClick={closeMenu}>
            <CloseIcon />
          </button>
          <Wordmark className="h-[18px] w-auto justify-self-center" title="" />
        </div>
        {menu ? (
          <MenuContent menu={menu} onNavigate={closeMenu} />
        ) : (
          <FallbackNav nav={nav} whatsappHref={whatsappHref} social={social} current={current} onNavigate={closeMenu} />
        )}
      </div>
    </dialog>
  );
}

function MenuContent({ menu, onNavigate }: { menu: MenuModel; onNavigate: () => void }) {
  return (
    <>
      <nav aria-labelledby="sf-menu-collections" className="px-6 pt-[18px]">
        <h2 id="sf-menu-collections" className="pb-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-brand-olive-700">
          Collections
        </h2>
        <ul className="flex flex-col">
          {menu.collections.map((c) => (
            <li key={c.id}>
              <Link
                href={c.href}
                onClick={onNavigate}
                className="sf-focus flex min-h-[52px] items-center justify-between gap-4 rounded-[2px] border-b border-brand-ink/10! font-serif text-[30px] font-medium leading-[1.1] text-brand-ink hover:text-brand-olive-700"
              >
                {c.label}
                {c.count ? (
                  <span className="font-sans text-xs font-normal tracking-[0.1em] text-brand-ink-soft">{c.count}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col px-6 pt-[26px]">
        {menu.about ? (
          <Disclosure label="About VYRA">
            <p className="text-sm leading-relaxed text-brand-ink-soft">{menu.about}</p>
            <MoreLink href={menu.aboutHref} onClick={onNavigate}>
              Our story
            </MoreLink>
          </Disclosure>
        ) : (
          <Link href={menu.aboutHref} onClick={onNavigate} className={rowClass}>
            About VYRA
          </Link>
        )}

        {menu.visit ? (
          <Disclosure label="Visit us">
            <VisitDetails visit={menu.visit} />
            <MoreLink href={menu.visitHref} onClick={onNavigate}>
              Visit us page
            </MoreLink>
          </Disclosure>
        ) : (
          <Link href={menu.visitHref} onClick={onNavigate} className={rowClass}>
            Visit us
          </Link>
        )}

        <Link href={menu.guideHref} onClick={onNavigate} className={rowClass}>
          How to use VYRA
          <HandIcon />
        </Link>

        {menu.whatsappHref ? (
          <a
            href={menu.whatsappHref}
            className="sf-focus mt-[22px] flex min-h-[52px] items-center justify-center gap-2.5 rounded-[2px] bg-brand-olive px-6 text-[13px] font-medium uppercase tracking-[0.14em] text-white transition-colors duration-200 hover:bg-brand-olive-700"
          >
            <WhatsAppIcon className="h-5 w-5 shrink-0" />
            Chat on WhatsApp
          </a>
        ) : null}
      </div>

      {/* ZP-508 slot: the shop rating line ("Rated 4.8 out of 5 by N verified
          customers") goes here, between WhatsApp and the tagline. Nothing is
          shown until reviews exist. */}

      <div className="mt-auto flex flex-col items-center gap-3 px-6 pb-7 pt-8">
        <p className="text-xs font-medium uppercase tracking-[0.26em]">{menu.tagline}</p>
        {menu.social.length > 0 ? <SocialIcons social={menu.social} tone="light" className="justify-center" /> : null}
      </div>
    </>
  );
}

/** An expanding row: the button says whether it is open; the panel follows it. */
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)} className={rowClass}>
        {label}
        <ChevronDownIcon className={cn("sf-motion h-[18px] w-[18px] transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div id={panelId} hidden={!open} className="flex flex-col gap-2 py-3.5">
        {open ? children : null}
      </div>
    </div>
  );
}

function MoreLink({ href, onClick, children }: { href: string; onClick: () => void; children: ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="sf-focus sf-label inline-flex min-h-11 w-fit items-center rounded-[2px] text-brand-ink underline decoration-brand-ink/30 underline-offset-4 hover:decoration-brand-ink"
    >
      {children}
    </Link>
  );
}

function HandIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 9.5V4a2 2 0 0 0-4 0v10" />
      <path d="M14 10V9a2 2 0 0 0-4 0v1" />
      <path d="M18 11v-1a2 2 0 0 0-4 0" />
      <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

/** Without a provider (should not happen on storefront pages): the plain nav links. */
function FallbackNav({
  nav,
  whatsappHref,
  social,
  current,
  onNavigate,
}: {
  nav: NavItem[];
  whatsappHref?: string | null;
  social: SocialLink[];
  current?: string;
  onNavigate: () => void;
}) {
  return (
    <>
      <nav aria-label="Main" className="px-6 pt-[18px]">
        <ul className="flex flex-col">
          {nav.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={item.href === current ? "page" : undefined}
                className="sf-focus flex min-h-[52px] items-center rounded-[2px] border-b border-brand-ink/10! font-serif text-[30px] font-medium text-brand-ink"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto flex flex-col items-center gap-4 px-6 pb-7 pt-8">
        {whatsappHref ? (
          <a href={whatsappHref} className="sf-focus sf-label-lg inline-flex min-h-11 items-center gap-3 rounded-[2px] text-brand-ink">
            <WhatsAppIcon className="h-6 w-6" />
            Chat on WhatsApp
          </a>
        ) : null}
        {social.length > 0 ? <SocialIcons social={social} tone="light" className="justify-center" /> : null}
      </div>
    </>
  );
}
