import { redirect } from 'next/navigation';

// ZP-483: "Website" in the admin nav opens the first website tool.
// The categories page links to Site settings (/website/settings, ZP-486).
export default function WebsitePage() {
  redirect('/website/categories');
}
