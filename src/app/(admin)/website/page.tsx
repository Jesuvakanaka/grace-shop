import { redirect } from 'next/navigation';

// ZP-483: "Website" in the admin nav opens the first website tool.
// Site settings (ZP-486) will be added next to Categories.
export default function WebsitePage() {
  redirect('/website/categories');
}
