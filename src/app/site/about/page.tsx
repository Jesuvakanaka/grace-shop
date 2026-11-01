import type { Metadata } from "next";
import { AboutView } from "@/components/storefront/info/AboutView";
import { buildAboutModel } from "@/components/storefront/info/info-model";
import { getShellData } from "@/lib/storefront/shell";

// ZP-491: About VYRA. Copy and picture come from the site settings (cached,
// tag storefront:settings, revalidated on save), so changes need no deploy.
export const metadata: Metadata = {
  title: "About",
  description: "The story behind VYRA. Wear different.",
};

export default async function AboutPage() {
  const shell = await getShellData();
  return <AboutView model={buildAboutModel({ settings: shell.settings, base: shell.base })} />;
}
