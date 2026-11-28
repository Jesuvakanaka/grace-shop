import type { Metadata } from 'next';
import MarketingManagerPrototype from '@/components/prototype/marketing-manager/App';

// An isolated, clickable prototype of the AI Marketing Manager owner experience.
// Fictional sample data only, saved in the visitor's browser: no database, no
// AI calls, no publishing, no messages and no spending. Outside the (admin) group
// on purpose (its own route group, so tests/host-routing.test.ts does not take it
// for a stray admin page): it needs no sign-in and touches no shop data. On the storefront
// host it is a 404 (host routing sends unknown paths to /site/**).
export const metadata: Metadata = {
  title: 'VYRA Marketing Manager · Prototype',
  description: 'Interactive prototype with sample data. No real messages or spending.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <MarketingManagerPrototype />;
}
