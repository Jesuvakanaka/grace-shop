'use client';
// ZP-505: the nine Insights reports. Each takes its slice of the API answer
// (src/lib/insights/types.ts) and a CSV link builder. No personal data is
// shown anywhere: only totals per day / source / piece / photo.
import React, { useMemo, useState } from 'react';
import { ProductPicture } from '@/components/ProductPicture';
import type { InsightsReport, LookRow } from '@/lib/insights/types';
import { Bar, Empty, fmt, ScrollTable, Section, StaleNote, Stat, td, tdNum, th, thNum, TooFew } from './parts';

type Csv = (name: string) => string;

const SOURCE_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  google: 'Google',
  direct: 'Direct / no referrer',
  other: 'Other sites',
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;
const DEVICE_LABEL: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', desktop: 'Computer' };

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  if (!src) return <div className="w-10 h-10 rounded-md bg-slate-100 shrink-0" aria-hidden="true" />;
  return <ProductPicture src={src} alt={alt} size={40} className="rounded-md shrink-0" testId="insights-thumb" />;
}

// ------------------------------------------------------------------ 1. overview

export function OverviewReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  const o = r.overview;
  const maxSource = Math.max(1, ...o.topSources.map((s) => s.visits));
  return (
    <Section id="overview" title="Overview" csv={[csv('overview')]}>
      <StaleNote days={r.range.notRecalculated} what="WhatsApp taps and sources" />
      {!o.enough && o.visits > 0 && (
        <p className="mb-3 text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
          Only {fmt.num(o.visits)} visits in this range – the averages are not reliable yet.
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 md:gap-3">
        <Stat
          label="Visits"
          value={fmt.num(o.visits)}
          sub={`${fmt.num(o.newVisits)} new · ${fmt.num(o.returningVisits)} returning`}
          testId="stat-visits"
        />
        <Stat label="Looks seen per visit" value={fmt.dec(o.looksPerVisit)} sub="mean" />
        <Stat label="Time on site" value={fmt.secs(o.avgSeconds)} sub="mean per visit (visible time)" />
        <Stat label="WhatsApp taps" value={fmt.num(o.whatsappTaps)} sub={`${fmt.num(o.enquiringVisits)} visits tapped`} testId="stat-whatsapp" />
        <Stat label="Restock requests" value={fmt.num(o.restockRequests)} />
        <Stat label="Bounce rate" value={fmt.pct(o.bounceRate)} sub="left within 5 s, ≤ 1 look" />
      </div>
      <h3 className="mt-4 mb-2 text-sm font-semibold text-slate-700">Top sources</h3>
      {o.topSources.length === 0 ? (
        <Empty>No visits in this range.</Empty>
      ) : (
        <ul className="space-y-2">
          {o.topSources.slice(0, 5).map((s) => (
            <Bar key={s.source} label={sourceLabel(s.source)} value={`${fmt.num(s.visits)} · ${fmt.pct(s.share)}`} share={s.visits / maxSource} />
          ))}
        </ul>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 2. top looks

type SortKey = 'views' | 'meanDwell' | 'photoSwipeRate' | 'detailsRate' | 'openRate' | 'whatsapp' | 'shares' | 'hearts' | 'name';

const LOOK_COLUMNS: { key: SortKey; label: string; title: string; render: (r: LookRow) => string }[] = [
  { key: 'views', label: 'Views', title: 'Times the look was the current slide', render: (r) => fmt.num(r.views) },
  { key: 'meanDwell', label: 'Dwell', title: 'Mean seconds on screen per view', render: (r) => fmt.secs(r.meanDwell) },
  { key: 'photoSwipeRate', label: 'Swiped', title: 'Share of viewers who swiped to a 2nd photo', render: (r) => fmt.pct(r.photoSwipeRate) },
  { key: 'detailsRate', label: 'Details', title: 'Show details taps per view', render: (r) => fmt.pct(r.detailsRate) },
  { key: 'openRate', label: 'Opened', title: 'Piece opens per view', render: (r) => fmt.pct(r.openRate) },
  { key: 'whatsapp', label: 'WhatsApp', title: 'WhatsApp taps on this piece', render: (r) => fmt.num(r.whatsapp) },
  { key: 'shares', label: 'Shares', title: 'Shares of this piece', render: (r) => fmt.num(r.shares) },
];

export function LooksReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'views', dir: -1 });
  const [all, setAll] = useState(false);
  const columns = useMemo(
    () =>
      r.looks.hasHearts
        ? [...LOOK_COLUMNS, { key: 'hearts' as SortKey, label: 'Hearts', title: 'Hearts added minus removed', render: (x: LookRow) => fmt.num(x.hearts) }]
        : LOOK_COLUMNS,
    [r.looks.hasHearts],
  );
  const rows = useMemo(() => {
    const value = (x: LookRow) => (sort.key === 'name' ? x.name : (x[sort.key] ?? -1));
    // Pieces with too few views always sit below the ranked ones.
    return [...r.looks.rows].sort((a, b) => {
      if (a.enough !== b.enough) return a.enough ? -1 : 1;
      const va = value(a);
      const vb = value(b);
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return c * sort.dir || b.views - a.views;
    });
  }, [r.looks.rows, sort]);
  const shown = all ? rows : rows.slice(0, 15);
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }));
  const aria = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');

  return (
    <Section
      id="looks"
      title="Top looks"
      description={`Ranked from ${r.thresholds.lookViews} views. Rates are per view; dwell is a mean.`}
      csv={[csv('looks')]}
    >
      <StaleNote days={r.range.notRecalculated} what="photo-swipe rates" />
      {rows.length === 0 ? (
        <Empty>No looks were seen in this range.</Empty>
      ) : (
        <>
          <ScrollTable caption="Top looks, sortable by each column">
            <thead>
              <tr>
                <th className={`${th} sticky left-0 bg-white`} aria-sort={aria('name')}>
                  <button type="button" onClick={() => sortBy('name')} className="uppercase">
                    Piece
                  </button>
                </th>
                {columns.map((c) => (
                  <th key={c.key} className={thNum} aria-sort={aria(c.key)} title={c.title}>
                    <button type="button" onClick={() => sortBy(c.key)} className="uppercase" data-testid={`sort-${c.key}`}>
                      {c.label}
                      {sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
                <th className={thNum} title="Popularity score – filled in by the ranking (ZP-506)">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.productId} className={x.enough ? '' : 'text-slate-500'} data-testid="look-row">
                  <td className={`${td} sticky left-0 bg-white`}>
                    <div className="flex items-center gap-2 min-w-[150px] max-w-[220px]">
                      <Thumb src={x.thumbnail} alt="" />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{x.name}</div>
                        {!x.enough && <TooFew count={x.views} unit="views" />}
                      </div>
                    </div>
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className={tdNum}>
                      {c.render(x)}
                    </td>
                  ))}
                  <td className={tdNum} title="Coming with the popularity ranking (ZP-506)">
                    {x.popularity === null ? '–' : fmt.dec(x.popularity, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          {rows.length > 15 && (
            <button type="button" className="mt-3 text-sm font-medium text-brand-olive" onClick={() => setAll((v) => !v)}>
              {all ? 'Show top 15' : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 3. photos

export function PhotosReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  const [all, setAll] = useState(false);
  const pieces = all ? r.photos : r.photos.slice(0, 6);
  return (
    <Section
      id="photos"
      title="Top photos per piece"
      description={`Mean seconds a photo stays on screen, and the share of the piece's viewers who saw it. A cover is suggested from ${r.thresholds.photoDwells} dwells per photo.`}
      csv={[csv('photos')]}
    >
      {pieces.length === 0 ? (
        <Empty>No photo views in this range.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {pieces.map((p) => {
            const maxMean = Math.max(0.01, ...p.photos.map((x) => x.meanSeconds ?? 0));
            const cover = p.photos.find((x) => x.isCover);
            return (
              <div key={p.productId} className="rounded-xl border border-slate-200 p-3 min-w-0" data-testid="photo-piece">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium text-slate-900 truncate">{p.name}</h3>
                  <span className="text-xs text-slate-500 whitespace-nowrap">{fmt.num(p.viewers)} viewers</span>
                </div>
                {p.bestCover ? (
                  <p className="mt-2 text-sm rounded-lg bg-brand-olive-50 border border-brand-olive-200 text-brand-olive-800 px-2.5 py-1.5" data-testid="best-cover">
                    Best cover photo: photo {p.bestCover.index} holds people {fmt.secs(p.bestCover.meanSeconds)} on average
                    {cover?.meanSeconds != null ? ` (the cover now: ${fmt.secs(cover.meanSeconds)})` : ''}.
                  </p>
                ) : null}
                <ul className="mt-2 space-y-2">
                  {p.photos.map((x) => (
                    <li key={`${x.index}-${x.image}`} className="flex items-center gap-2 min-w-0">
                      <Thumb src={x.url} alt="" />
                      <ul className="flex-1 min-w-0">
                        <Bar
                          label={
                            <>
                              Photo {x.index}
                              {x.isCover && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-brand-olive font-semibold">cover</span>}
                            </>
                          }
                          value={`${fmt.secs(x.meanSeconds)} · ${fmt.pct(x.reach)} reach`}
                          share={(x.meanSeconds ?? 0) / maxMean}
                          muted={!x.enough}
                          note={!x.enough ? <TooFew count={x.dwellCount} unit={x.dwellCount === 1 ? 'dwell' : 'dwells'} /> : undefined}
                        />
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {r.photos.length > 6 && (
        <button type="button" className="mt-3 text-sm font-medium text-brand-olive" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer pieces' : `Show all ${r.photos.length} pieces`}
        </button>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 4. videos

export function VideosReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  return (
    <Section id="videos" title="Top videos" description={`Share of starts that reached each point. Ranked from ${r.thresholds.videoStarts} starts.`} csv={[csv('videos')]}>
      {r.videos.length === 0 ? (
        <Empty>No videos were played in this range.</Empty>
      ) : (
        <ScrollTable caption="Video starts, completion and watch time per piece">
          <thead>
            <tr>
              <th className={`${th} sticky left-0 bg-white`}>Piece</th>
              <th className={thNum}>Starts</th>
              <th className={thNum}>25%</th>
              <th className={thNum}>50%</th>
              <th className={thNum}>75%</th>
              <th className={thNum}>100%</th>
              <th className={thNum} title="Mean seconds watched per start">Watched</th>
              <th className={thNum}>Replays</th>
            </tr>
          </thead>
          <tbody>
            {r.videos.map((v) => (
              <tr key={v.productId} className={v.enough ? '' : 'text-slate-500'}>
                <td className={`${td} sticky left-0 bg-white`}>
                  <div className="flex items-center gap-2 min-w-[150px] max-w-[220px]">
                    <Thumb src={v.thumbnail} alt="" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{v.name}</div>
                      {!v.enough && <TooFew count={v.starts} unit="starts" />}
                    </div>
                  </div>
                </td>
                <td className={tdNum}>{fmt.num(v.starts)}</td>
                {v.completion.map((c, i) => (
                  <td key={i} className={tdNum}>
                    {fmt.pct(c)}
                  </td>
                ))}
                <td className={tdNum}>{fmt.secs(v.avgSeconds)}</td>
                <td className={tdNum}>{fmt.num(v.replays)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 5. funnel

function SegmentTable({ title, segments, steps, label, min }: { title: string; segments: InsightsReport['funnel']['byDevice']; steps: readonly string[]; label: (k: string) => string; min: number }) {
  if (segments.length === 0) return null;
  return (
    <>
      <h3 className="mt-4 mb-1 text-sm font-semibold text-slate-700">{title}</h3>
      <ScrollTable caption={`Funnel ${title.toLowerCase()}: visits reaching each step, and the share lost from the step before`}>
        <thead>
          <tr>
            <th className={`${th} sticky left-0 bg-white`}>Segment</th>
            {steps.map((s) => (
              <th key={s} className={thNum}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {segments.map((seg) => (
            <tr key={seg.key} className={seg.enough ? '' : 'text-slate-500'}>
              <td className={`${td} sticky left-0 bg-white whitespace-nowrap`}>
                <div className="font-medium text-slate-900">{label(seg.key)}</div>
                {!seg.enough && <TooFew count={seg.counts[0]} unit="visits" />}
              </td>
              {seg.counts.map((c, i) => (
                <td key={i} className={tdNum}>
                  {fmt.num(c)}
                  {i > 0 && seg.lost[i] !== null && <div className="text-xs text-slate-500">−{fmt.pct(seg.lost[i])}</div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </ScrollTable>
      <p className="sr-only">Segments under {min} visits are not ranked.</p>
    </>
  );
}

export function FunnelReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  const f = r.funnel;
  const landed = f.all.counts[0];
  return (
    <Section
      id="funnel"
      title="Funnel and drop-off"
      description="Someone who tapped Show details on the first look also counts for “Saw a 2nd look”, so that step can be higher than look 2 under Feed depth."
      csv={[csv('funnel')]}
    >
      <p className="mb-2 text-sm text-slate-700" data-testid="funnel-note">Counts every step up to the furthest a visit reached.</p>
      <StaleNote days={r.range.notRecalculated} what="the funnel" />
      {landed === 0 ? (
        <Empty>No visits in this range.</Empty>
      ) : (
        <>
          {!f.all.enough && <p className="mb-2"><TooFew count={landed} unit="visits" /></p>}
          <ol className="space-y-2" aria-label="Visits reaching each step">
            {f.steps.map((step, i) => (
              <Bar
                key={step}
                label={`${i + 1}. ${step}`}
                value={`${fmt.num(f.all.counts[i])} · ${fmt.pct(f.all.counts[i] / landed)}`}
                share={f.all.counts[i] / landed}
                note={i > 0 && f.all.lost[i] !== null ? `${fmt.pct(f.all.lost[i])} lost from the step before` : undefined}
              />
            ))}
          </ol>
          <SegmentTable title="By device" segments={f.byDevice} steps={f.steps} label={(k) => DEVICE_LABEL[k] ?? k} min={r.thresholds.visits} />
          <SegmentTable title="By source" segments={f.bySource} steps={f.steps} label={sourceLabel} min={r.thresholds.visits} />
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 6. feed depth

const DEPTH_ROWS = 20;

export function DepthReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  const d = r.depth;
  const rows = d.reach.length > DEPTH_ROWS ? [...d.reach.slice(0, DEPTH_ROWS - 1), d.reach[d.reach.length - 1]] : d.reach;
  return (
    <Section id="depth" title="Feed depth" description="Share of visits that reached look 1, 2, 3 … of the feed." csv={[csv('depth')]}>
      <StaleNote days={r.range.notRecalculated} what="feed depth" />
      {d.visits === 0 ? (
        <Empty>No visits in this range.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:gap-3 mb-3">
            <Stat label="Reached the end of the feed" value={fmt.pct(d.endOfFeedRate)} sub={`${fmt.num(d.endOfFeedVisits)} visits`} />
            <Stat label="Deepest look reached" value={`${fmt.num(d.reach.length)}${d.capped ? '+' : ''}`} />
          </div>
          {d.visits < r.thresholds.visits && <p className="mb-2"><TooFew count={d.visits} unit="visits" /></p>}
          <ol className="space-y-1.5" aria-label="Visits reaching each look">
            {rows.map((x, i) => (
              <React.Fragment key={x.look}>
                {i === DEPTH_ROWS - 1 && rows.length === DEPTH_ROWS && d.reach.length > DEPTH_ROWS && (
                  <li className="text-xs text-slate-400" aria-hidden="true">…</li>
                )}
                <Bar label={`Look ${x.look}${d.capped && i === rows.length - 1 ? '+' : ''}`} value={`${fmt.pct(x.share)} · ${fmt.num(x.visits)}`} share={x.share} />
              </React.Fragment>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 7. demand

export function DemandReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  const d = r.demand;
  return (
    <Section id="demand" title="Demand" description="What people want that you could stock or price." csv={[csv('demand')]}>
      <StaleNote days={r.range.notRecalculated} what="sizes and colours" />
      <h3 className="mb-1 text-sm font-semibold text-slate-700">Restock requests</h3>
      {d.soldOut.length === 0 ? (
        <Empty>No restock requests in this range.</Empty>
      ) : (
        <ScrollTable caption="Restock requests per piece, with the sizes asked for">
          <thead>
            <tr>
              <th className={th}>Piece</th>
              <th className={thNum}>Requests</th>
              <th className={th}>Sizes asked</th>
            </tr>
          </thead>
          <tbody>
            {d.soldOut.map((p) => (
              <tr key={p.productId}>
                <td className={td}>
                  <div className="flex items-center gap-2 min-w-[150px]">
                    <Thumb src={p.thumbnail} alt="" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{p.name}</div>
                      <div className={`text-xs ${p.soldOutNow ? 'text-rose-700' : 'text-brand-olive'}`}>{p.soldOutNow ? 'Sold out now' : 'Back in stock'}</div>
                    </div>
                  </div>
                </td>
                <td className={tdNum}>{fmt.num(p.restockRequests)}</td>
                <td className={td}>{p.sizes.length ? p.sizes.map((s) => `${s.value} ×${s.count}`).join(', ') : '–'}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}

      <h3 className="mt-4 mb-1 text-sm font-semibold text-slate-700">Most-picked sizes and colours</h3>
      {d.options.length === 0 ? (
        <Empty>No sizes or colours were picked in this range.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {d.options.slice(0, 15).map((p) => (
            <li key={p.productId} className="py-2 min-w-0">
              <div className="font-medium text-slate-900">{p.name}</div>
              {[
                { label: 'Sizes', list: p.sizes },
                { label: 'Colours', list: p.colours },
              ]
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <div key={g.label} className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-slate-500 w-14">{g.label}</span>
                    {g.list.map((o) => (
                      <span key={o.value} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">
                        <strong>{o.value}</strong> · {fmt.num(o.selects)} picks{o.enquiries ? ` · ${fmt.num(o.enquiries)} enquiries` : ''}
                      </span>
                    ))}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-4 mb-1 text-sm font-semibold text-slate-700">Enquiries on “Ask for price” pieces</h3>
      {d.askForPrice.length === 0 ? (
        <Empty>No “Ask for price” pieces were seen in this range.</Empty>
      ) : (
        <ScrollTable caption="WhatsApp enquiries on pieces without a public price">
          <thead>
            <tr>
              <th className={th}>Piece</th>
              <th className={thNum}>Views</th>
              <th className={thNum}>Enquiries</th>
              <th className={thNum}>Per view</th>
            </tr>
          </thead>
          <tbody>
            {d.askForPrice.slice(0, 20).map((p) => (
              <tr key={p.productId}>
                <td className={`${td} font-medium text-slate-900`}>{p.name}</td>
                <td className={tdNum}>{fmt.num(p.views)}</td>
                <td className={tdNum}>{fmt.num(p.enquiries)}</td>
                <td className={tdNum}>{p.views < r.thresholds.lookViews ? <TooFew count={p.views} unit="views" /> : fmt.pct(p.rate)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 8. sources & timing

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Sequential: one hue (brand olive), light -> dark. Five steps; 0 is the empty cell.
const HEAT = ['bg-slate-50', 'bg-brand-olive-100', 'bg-brand-olive-200', 'bg-brand-olive-300', 'bg-brand-olive-500', 'bg-brand-olive-700'];

function Heatmap({ cells }: { cells: InsightsReport['sources']['heatmap'] }) {
  const [showTable, setShowTable] = useState(false);
  const max = Math.max(0, ...cells.map((c) => c.visits));
  const at = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c]));
  const step = (v: number) => (v <= 0 || max === 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
  const busiest = [...cells].sort((a, b) => b.visits - a.visits).slice(0, 3);
  const summary = busiest.length
    ? `Busiest: ${busiest.map((c) => `${WEEKDAYS[c.weekday - 1]} ${String(c.hour).padStart(2, '0')}:00 (${c.visits} visits)`).join(', ')}.`
    : 'No visits.';
  return (
    <figure className="min-w-0">
      <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
        <div role="img" aria-label={`Visits by weekday and hour (Harare). ${summary}`} className="inline-grid gap-[2px] min-w-[560px] w-full" style={{ gridTemplateColumns: '2.5rem repeat(24, minmax(0, 1fr))' }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-[10px] text-slate-500 text-center" aria-hidden="true">
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </div>
          ))}
          {WEEKDAYS.map((name, i) => (
            <React.Fragment key={name}>
              <div className="text-[11px] text-slate-600 pr-1 self-center" aria-hidden="true">
                {name}
              </div>
              {Array.from({ length: 24 }, (_, h) => {
                const c = at.get(`${i + 1}-${h}`);
                const v = c?.visits ?? 0;
                return (
                  <div
                    key={h}
                    className={`h-5 rounded-[3px] ${HEAT[step(v)]}`}
                    title={`${name} ${String(h).padStart(2, '0')}:00 – ${v} visits, ${c?.whatsappTaps ?? 0} WhatsApp taps`}
                    aria-hidden="true"
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>{summary}</span>
        <span className="inline-flex items-center gap-1" aria-hidden="true">
          fewer
          {HEAT.slice(1).map((c) => (
            <span key={c} className={`inline-block w-3 h-3 rounded-[2px] ${c}`} />
          ))}
          more
        </span>
      </figcaption>
      {/* Review F5: the table is always in the page for screen readers; the button only shows it on screen. */}
      <button
        type="button"
        className="mt-2 text-sm text-brand-olive font-medium"
        aria-expanded={showTable}
        aria-controls="heatmap-table"
        onClick={() => setShowTable((v) => !v)}
        data-testid="heatmap-toggle"
      >
        {showTable ? 'Hide the table' : 'Show as a table'}
      </button>
      <div id="heatmap-table" className={showTable ? 'mt-2 text-sm' : 'sr-only'} data-testid="heatmap-table">
        {cells.length === 0 ? (
          <Empty>No visits.</Empty>
        ) : (
          <ScrollTable caption="Visits and WhatsApp taps by weekday and hour (Harare). Hours not listed had no visits.">
            <thead>
              <tr>
                <th className={th}>Day</th>
                <th className={th}>Hour</th>
                <th className={thNum}>Visits</th>
                <th className={thNum}>WhatsApp taps</th>
              </tr>
            </thead>
            <tbody>
              {cells.map((c) => (
                <tr key={`${c.weekday}-${c.hour}`}>
                  <td className={td}>{WEEKDAYS[c.weekday - 1]}</td>
                  <td className={td}>{String(c.hour).padStart(2, '0')}:00</td>
                  <td className={tdNum}>{fmt.num(c.visits)}</td>
                  <td className={tdNum}>{fmt.num(c.whatsappTaps)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        )}
      </div>
    </figure>
  );
}

export function SourcesReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  const s = r.sources;
  const max = Math.max(1, ...s.bySource.map((x) => x.visits));
  return (
    <Section
      id="sources"
      title="Sources and timing"
      description="Where visits come from (tag your links with ?src=…), and when they start (Harare time)."
      csv={[csv('sources'), csv('heatmap')]}
    >
      <StaleNote days={r.range.notRecalculated} what="sources, campaigns and times" />
      {s.bySource.length === 0 ? (
        <Empty>No visits in this range.</Empty>
      ) : (
        <ul className="space-y-2">
          {s.bySource.map((x) => (
            <Bar
              key={x.source}
              label={sourceLabel(x.source)}
              value={`${fmt.num(x.visits)} visits · ${fmt.num(x.whatsappTaps)} WhatsApp`}
              share={x.visits / max}
              note={x.enough ? `${fmt.pct(x.visits ? x.enquiringVisits / x.visits : null)} of visits tapped WhatsApp` : <TooFew count={x.visits} unit="visits" />}
            />
          ))}
        </ul>
      )}
      <h3 className="mt-4 mb-1 text-sm font-semibold text-slate-700">Campaigns</h3>
      {s.byCampaign.length === 0 ? (
        <Empty>No tagged links (?src=…) were used in this range.</Empty>
      ) : (
        <ScrollTable caption="Visits and WhatsApp taps by campaign tag">
          <thead>
            <tr>
              <th className={th}>Campaign</th>
              <th className={th}>Source</th>
              <th className={thNum}>Visits</th>
              <th className={thNum}>WhatsApp taps</th>
            </tr>
          </thead>
          <tbody>
            {s.byCampaign.slice(0, 30).map((c) => (
              <tr key={`${c.source}-${c.campaign}`}>
                <td className={`${td} font-mono`}>{c.campaign}</td>
                <td className={td}>{sourceLabel(c.source)}</td>
                <td className={tdNum}>{fmt.num(c.visits)}</td>
                <td className={tdNum}>{fmt.num(c.whatsappTaps)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      <h3 className="mt-4 mb-2 text-sm font-semibold text-slate-700">When visits start</h3>
      <Heatmap cells={s.heatmap} />
    </Section>
  );
}

// ------------------------------------------------------------------ 9. health

const HEALTH_LABEL: Record<string, string> = { slow_load: 'Slow page loads', load_error: 'Failed to load', action_failed: 'Failed actions' };

export function HealthReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  const h = r.health;
  const any = h.byDetail.length > 0;
  return (
    <Section id="health" title="Health" description="Slow loads (over 4 s), things that failed to load, and feed actions that failed." csv={[csv('health')]}>
      <StaleNote days={r.range.notRecalculated} what="health" />
      {!any ? (
        <Empty>No problems recorded in this range.</Empty>
      ) : (
        <>
          <ul className="mb-3 flex flex-wrap gap-2 text-xs">
            {h.byDetail.map((x) => (
              <li key={`${x.kind}-${x.detail}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
                {HEALTH_LABEL[x.kind] ?? x.kind}
                {x.detail ? ` (${x.detail})` : ''}: <strong>{fmt.num(x.events)}</strong> in {fmt.num(x.visits)} visit-days
              </li>
            ))}
          </ul>
          <ScrollTable caption="Problems per day">
            <thead>
              <tr>
                <th className={th}>Day</th>
                <th className={thNum}>Slow loads</th>
                <th className={thNum}>Load errors</th>
                <th className={thNum}>Failed actions</th>
              </tr>
            </thead>
            <tbody>
              {h.days.map((d) => (
                <tr key={d.day}>
                  <td className={`${td} whitespace-nowrap`}>{fmt.day(d.day)}</td>
                  <td className={tdNum}>{fmt.num(d.slowLoads)}</td>
                  <td className={tdNum}>{fmt.num(d.loadErrors)}</td>
                  <td className={tdNum}>{fmt.num(d.failedActions)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ 10. reviews (ZP-508)

export function ReviewsReport({ r, csv }: { r: InsightsReport; csv: Csv }) {
  const v = r.reviews;
  const max = Math.max(1, ...v.perWeek.map((w) => w.received));
  return (
    <Section id="reviews" title="Reviews" description="Reviews from verified buyers, by week (Monday, Harare time). Counts only." csv={[csv('reviews')]}>
      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-3">
        <Stat label="Received" value={fmt.num(v.received)} sub={`${fmt.num(v.approved)} approved`} testId="stat-reviews" />
        <Stat label="Average stars" value={v.averageStars === null ? '–' : `${fmt.dec(v.averageStars)} ★`} sub="approved reviews" />
        <Stat label="Waiting for you" value={fmt.num(v.pendingNow)} sub="pending now" />
      </div>
      {v.perWeek.length === 0 ? (
        <Empty>No reviews were submitted in this range.</Empty>
      ) : (
        <ul className="space-y-2" aria-label="Reviews received per week">
          {v.perWeek.map((w) => (
            <Bar key={w.week} label={`Week of ${fmt.day(w.week)}`} value={`${fmt.num(w.received)} · ${fmt.num(w.approved)} approved`} share={w.received / max} />
          ))}
        </ul>
      )}
    </Section>
  );
}
