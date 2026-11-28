'use client';
// AI Marketing Manager prototype: the app shell, navigation and screen router.
// Opened at /prototype/marketing-manager. Sample data only; see docs/marketing/ai-manager-prototype.md.
import React, { useState, useSyncExternalStore } from 'react';
import { Mark } from '@/components/storefront/Brand';
import { adNeedsApproval, campaignProgress, liveCampaigns, waitingCustomers } from './engine';
import { DemoProvider, useDemo } from './store';
import { DemoClock } from './screens/shared';
import { Dialog, Icon } from './ui';
import { HomeScreen } from './screens/Home';
import { OnboardingScreen } from './screens/Onboarding';
import { PlanScreen } from './screens/Plan';
import { ApprovalsScreen } from './screens/Approvals';
import { CampaignsScreen } from './screens/Campaigns';
import { CustomersScreen } from './screens/Customers';
import { ResultsScreen } from './screens/Results';
import { SettingsScreen } from './screens/Settings';
import { ChannelsScreen } from './screens/Channels';

export const PROTOTYPE_LABEL = 'Interactive prototype · Sample data · No real messages or spending.';

const NAV = [
  { key: 'home', href: '#/', label: 'My marketing', short: 'Home', icon: 'home' },
  { key: 'plan', href: '#/plan', label: 'My plan', short: 'Plan', icon: 'plan' },
  { key: 'approvals', href: '#/approvals', label: 'Approvals', short: 'Approvals', icon: 'approve' },
  { key: 'campaigns', href: '#/campaigns', label: 'Campaigns', short: 'Campaigns', icon: 'megaphone' },
  { key: 'customers', href: '#/customers', label: 'Customers', short: 'Customers', icon: 'users' },
  { key: 'results', href: '#/results', label: 'Results', short: 'Results', icon: 'chart' },
] as const;

const SECONDARY = [
  { key: 'settings', href: '#/settings', label: 'Business settings', icon: 'settings' },
  { key: 'channels', href: '#/channels', label: 'Channels', icon: 'plug' },
] as const;

const noop = () => () => {};

export default function MarketingManagerPrototype() {
  // localStorage exists only in the browser, so the demo renders after mount.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-cream text-slate-600" role="status">
        Loading the prototype…
      </div>
    );
  }
  return (
    <DemoProvider>
      <style>{'@keyframes mmfade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}'}</style>
      <Shell />
    </DemoProvider>
  );
}

function Shell() {
  const { state, route, go, dispatch, toast, storageOk } = useDemo();
  const [confirmReset, setConfirmReset] = useState(false);
  const [menu, setMenu] = useState(false);
  const section = route[0] ?? 'home';
  const onboarding = state.onboarding === 'pending' || section === 'welcome';

  const approvals = liveCampaigns(state).reduce((n, c) => n + campaignProgress(state, c).awaiting + (adNeedsApproval(state, c) ? 1 : 0), 0);
  const waiting = waitingCustomers(state).length;
  const badge = (key: string) => (key === 'approvals' ? approvals : key === 'customers' ? waiting : 0);

  const reset = () => {
    dispatch({ type: 'reset' });
    setConfirmReset(false);
    setMenu(false);
    go('#/');
    toast('The demo was reset to its starting point.', 'info');
  };

  const screen = (() => {
    if (onboarding) return <OnboardingScreen />;
    switch (section) {
      case 'plan': return <PlanScreen />;
      case 'approvals': return <ApprovalsScreen />;
      case 'campaigns': return <CampaignsScreen />;
      case 'customers': return <CustomersScreen />;
      case 'results': return <ResultsScreen />;
      case 'settings': return <SettingsScreen />;
      case 'channels': return <ChannelsScreen />;
      default: return <HomeScreen />;
    }
  })();

  const active = (key: string) => (key === 'home' ? section === 'home' : section === key);

  return (
    <div className="min-h-screen bg-brand-cream text-slate-900">
      {/* The persistent prototype label. */}
      <div className="sticky top-0 z-50 flex min-h-9 items-center justify-between gap-3 border-b border-brand-olive-800 bg-brand-olive-900 px-4 py-1.5 text-[12.5px] text-brand-olive-50">
        <p className="min-w-0"><span className="sr-only">Notice: </span>{PROTOTYPE_LABEL}</p>
        <button type="button" onClick={() => setConfirmReset(true)} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded px-2 font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-lime">
          <Icon name="reset" className="h-4 w-4" /> Reset demo
        </button>
      </div>

      <div className="lg:flex">
        {/* Desktop sidebar */}
        {!onboarding ? (
          <aside className="hidden lg:sticky lg:top-9 lg:flex lg:h-[calc(100vh-2.25rem)] lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white" aria-label="Main">
            <a href="#/" className="flex items-center gap-3 px-5 py-5">
              <Mark className="h-9 w-9" title="" />
              <span className="leading-tight"><span className="block font-serif text-xl font-semibold">{state.business.name || 'Your shop'}</span><span className="block text-xs text-slate-500">Marketing manager</span></span>
            </a>
            <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
              {NAV.map((n) => (
                <a key={n.key} href={n.href} aria-current={active(n.key) ? 'page' : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] ${active(n.key) ? 'bg-brand-olive-50 font-medium text-brand-olive-800 ring-1 ring-brand-olive-200' : 'text-slate-700 hover:bg-slate-50'}`}>
                  <Icon name={n.icon} />
                  <span className="flex-1">{n.label}</span>
                  {badge(n.key) ? <span className="rounded-full bg-brand-lime px-2 text-xs font-semibold text-brand-ink">{badge(n.key)}</span> : null}
                </a>
              ))}
              <div className="my-3 border-t border-slate-200" />
              {SECONDARY.map((n) => (
                <a key={n.key} href={n.href} aria-current={active(n.key) ? 'page' : undefined}
                  className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm ${active(n.key) ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <Icon name={n.icon} className="h-4.5 w-4.5" />{n.label}
                </a>
              ))}
            </nav>
            <DemoClock className="m-3" />
          </aside>
        ) : null}

        <div className="min-w-0 flex-1">
          {/* Mobile header */}
          {!onboarding ? (
            <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
              <a href="#/" className="flex items-center gap-2"><Mark className="h-7 w-7" title="" /><span className="font-serif text-lg font-semibold">{state.business.name || 'Your shop'}</span></a>
              <button type="button" className="btn btn-ghost !min-h-11 !px-3" onClick={() => setMenu(true)} aria-label="More: settings, channels and demo controls">
                <Icon name="menu" /> <span className="text-xs">More</span>
              </button>
            </header>
          ) : null}

          <main className={`mx-auto w-full max-w-5xl px-4 pb-32 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10 ${onboarding ? '' : ''}`}>
            {!storageOk ? <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This browser blocks saving, so changes will be lost when you close the page.</p> : null}
            {screen}
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      {!onboarding ? (
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-slate-200 bg-white pb-[var(--safe-bottom)] lg:hidden" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.key} href={n.href} aria-current={active(n.key) ? 'page' : undefined}
              className={`relative flex min-h-[60px] flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[10.5px] leading-tight ${active(n.key) ? 'font-semibold text-brand-olive-800' : 'text-slate-600'}`}>
              {active(n.key) ? <span className="absolute inset-x-3 top-0 h-0.5 rounded bg-brand-lime" aria-hidden /> : null}
              <Icon name={n.icon} className="h-5 w-5" />
              <span>{n.key === 'home' ? 'My marketing' : n.label}</span>
              {badge(n.key) ? <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-brand-lime px-1 text-[10px] font-semibold text-brand-ink">{badge(n.key)}</span> : null}
            </a>
          ))}
        </nav>
      ) : null}

      <Dialog open={menu} onClose={() => setMenu(false)} title="More">
        <div className="space-y-2">
          {SECONDARY.map((n) => (
            <a key={n.key} href={n.href} onClick={() => setMenu(false)} className="flex min-h-12 items-center gap-3 rounded-lg border border-slate-200 px-4 text-slate-800 hover:bg-slate-50">
              <Icon name={n.icon} />{n.label}
            </a>
          ))}
          <DemoClock className="mt-4" />
          <button type="button" className="btn btn-secondary mt-2 w-full" onClick={() => { setMenu(false); setConfirmReset(true); }}>
            <Icon name="reset" className="h-4 w-4" /> Reset demo
          </button>
        </div>
      </Dialog>

      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset the demo?"
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setConfirmReset(false)}>Keep my changes</button><button type="button" className="btn btn-primary" onClick={reset}>Reset demo</button></>}>
        <p className="text-slate-700">Everything you changed in this prototype goes back to the starting sample data: plans, approvals, replies and recorded sales. It only affects this browser.</p>
      </Dialog>
    </div>
  );
}
