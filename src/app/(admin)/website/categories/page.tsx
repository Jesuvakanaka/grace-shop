'use client';
// ZP-483: website categories (OWNER only). Create, rename, slug, reorder,
// publish, hero image, delete when empty.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/Toast';
import { ProductPicture } from '@/components/ProductPicture';
import { slugify } from '@/lib/storefront-model';
import { PHOTO_GUIDANCE } from '@/lib/website/labels';

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  heroImageUrl: string | null;
  sortOrder: number;
  published: boolean;
  productCount: number;
}

type FieldErrors = { error: string; field?: string } | null;

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function uploadPicture(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url as string;
}

export default function WebsiteCategoriesPage() {
  const { isOwner, loading: authLoading } = useAuth();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newSlugTouched, setNewSlugTouched] = useState(false);
  const [createError, setCreateError] = useState<FieldErrors>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await send('/api/website/categories', 'GET');
    if (r.ok) setCategories(r.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    if (isOwner) load();
  }, [isOwner, load]);

  if (authLoading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (!isOwner) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-2">Website</h1>
        <p className="text-slate-600">Only the owner can manage the website.</p>
      </div>
    );
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setBusy(true);
    const body: Record<string, unknown> = { name: newName };
    if (newSlugTouched && newSlug.trim()) body.slug = newSlug;
    const r = await send('/api/website/categories', 'POST', body);
    setBusy(false);
    if (!r.ok) return setCreateError(r.data);
    toast.success(`Category "${r.data.name}" created`);
    setNewName('');
    setNewSlug('');
    setNewSlugTouched(false);
    load();
  };

  const move = async (index: number, delta: number) => {
    const order = categories.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    const r = await send('/api/website/categories', 'PUT', { order });
    if (r.ok) setCategories(r.data);
    else {
      toast.error(r.data.error || 'Could not reorder');
      load();
    }
  };

  const togglePublished = async (c: Category) => {
    const r = await send(`/api/website/categories/${c.id}`, 'PATCH', { published: !c.published });
    if (!r.ok) return toast.error(r.data.error || 'Could not save');
    toast.success(r.data.published ? `"${c.name}" is on the website` : `"${c.name}" is hidden from the website`);
    load();
  };

  const remove = async (c: Category) => {
    if (!window.confirm(`Delete the category "${c.name}"?`)) return;
    const r = await send(`/api/website/categories/${c.id}`, 'DELETE');
    if (!r.ok) {
      toast.error(r.data.error || 'Could not delete');
      return load();
    }
    toast.success(`Category "${c.name}" deleted`);
    load();
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-1 text-sm text-slate-500">Website</div>
      <h1 className="text-2xl font-bold mb-2">Categories</h1>
      <nav className="flex gap-4 text-sm mb-6 border-b border-slate-200" aria-label="Website tools">
        <span className="pb-2 border-b-2 border-brand-olive text-brand-olive-700 font-medium" aria-current="page">
          Categories
        </span>
        <Link href="/website/reviews" className="pb-2 text-slate-600 hover:text-slate-900" data-testid="website-nav-reviews">
          Reviews
        </Link>
        <Link href="/website/settings" className="pb-2 text-slate-600 hover:text-slate-900" data-testid="website-nav-settings">
          Site settings
        </Link>
        <Link href="/products" className="pb-2 text-slate-600 hover:text-slate-900 ml-auto">
          Products →
        </Link>
      </nav>

      <form onSubmit={create} className="card p-4 mb-6 space-y-3" data-testid="category-create">
        <h2 className="text-lg font-semibold">New category</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="new-category-name">Name</label>
            <input
              id="new-category-name"
              className="input w-full"
              value={newName}
              maxLength={80}
              onChange={(e) => {
                setNewName(e.target.value);
                if (!newSlugTouched) setNewSlug(slugify(e.target.value));
              }}
              placeholder="e.g. Dresses"
              required
              data-testid="category-new-name"
            />
            {createError?.field === 'name' && <p className="text-sm text-rose-700 mt-1">{createError.error}</p>}
          </div>
          <div>
            <label className="label" htmlFor="new-category-slug">Web address (slug)</label>
            <div className="flex items-center gap-1">
              
              <input
                id="new-category-slug"
                className={`input w-full ${createError?.field === 'slug' ? 'input-error' : ''}`}
                value={newSlug}
                onChange={(e) => {
                  setNewSlug(e.target.value);
                  setNewSlugTouched(true);
                }}
                placeholder="made from the name"
                data-testid="category-new-slug"
              />
            </div>
            {createError?.field === 'slug' && (
              <p className="text-sm text-rose-700 mt-1" data-testid="category-new-slug-error">{createError.error}</p>
            )}
          </div>
        </div>
        {createError && !createError.field && <p className="text-sm text-rose-700">{createError.error}</p>}
        <button className="btn btn-primary" disabled={busy || !newName.trim()} data-testid="category-create-submit">
          {busy ? 'Creating...' : 'Create category'}
        </button>
      </form>

      {loading ? (
        <div className="p-8 text-center text-slate-500">Loading...</div>
      ) : categories.length === 0 ? (
        <div className="card p-6 text-center text-slate-500">No categories yet. Create the first one above.</div>
      ) : (
        <ul className="space-y-3" data-testid="category-list">
          {categories.map((c, index) => (
            <li key={c.id} className="card p-4" data-testid="category-row" data-slug={c.slug}>
              {editingId === c.id ? (
                <CategoryEditor
                  category={c}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    load();
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost px-2"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${c.name} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost px-2"
                      onClick={() => move(index, 1)}
                      disabled={index === categories.length - 1}
                      aria-label={`Move ${c.name} down`}
                    >
                      ↓
                    </button>
                  </div>
                  {c.heroImageUrl ? (
                    <ProductPicture src={c.heroImageUrl} alt="" size={56} className="rounded-lg shrink-0" testId="category-hero" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-brand-cream-100 shrink-0" aria-hidden />
                  )}
                  <div className="flex-1 min-w-[10rem]">
                    <p className="font-medium text-slate-900">{c.name}</p>
                    <p className="text-sm text-slate-500">
                      {c.slug} · {c.productCount} {c.productCount === 1 ? 'product' : 'products'}
                    </p>
                  </div>
                  <span className={`badge ${c.published ? 'badge-success' : 'badge-neutral'}`} data-testid="category-status">
                    {c.published ? 'Published' : 'Hidden'}
                  </span>
                  <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => togglePublished(c)} data-testid="category-toggle-published">
                      {c.published ? 'Unpublish' : 'Publish'}
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditingId(c.id)} data-testid="category-edit">
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => remove(c)}
                      data-testid="category-delete"
                      title={c.productCount > 0 ? `Move ${c.productCount} products first` : undefined}
                    >
                      Delete
                    </button>
                  </div>
                  {c.productCount > 0 && (
                    <p className="w-full text-xs text-slate-500">
                      To delete it, move its {c.productCount} {c.productCount === 1 ? 'product' : 'products'} to another category first.
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryEditor({ category, onCancel, onSaved }: { category: Category; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(category.name);
  const [slug, setSlug] = useState(category.slug);
  const [description, setDescription] = useState(category.description ?? '');
  const [hero, setHero] = useState<string | null>(category.heroImageUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FieldErrors>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      setHero(await uploadPicture(file));
    } catch (err) {
      setError({ error: err instanceof Error ? err.message : 'Upload failed', field: 'heroImageUrl' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = { name, description: description || null, heroImageUrl: hero };
    if (slug !== category.slug) body.slug = slug;
    const r = await send(`/api/website/categories/${category.id}`, 'PATCH', body);
    setSaving(false);
    if (!r.ok) return setError(r.data);
    toast.success('Category saved');
    onSaved();
  };

  return (
    <form onSubmit={save} className="space-y-3" data-testid="category-editor">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor={`cat-name-${category.id}`}>Name</label>
          <input id={`cat-name-${category.id}`} className="input w-full" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
          {error?.field === 'name' && <p className="text-sm text-rose-700 mt-1">{error.error}</p>}
        </div>
        <div>
          <label className="label" htmlFor={`cat-slug-${category.id}`}>Web address</label>
          <div className="flex items-center gap-1">
            
            <input
              id={`cat-slug-${category.id}`}
              className={`input w-full ${error?.field === 'slug' ? 'input-error' : ''}`}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              data-testid="category-edit-slug"
            />
          </div>
          <button type="button" className="text-xs text-brand-olive-700 underline mt-1" onClick={() => setSlug(slugify(name))}>
            Use the name
          </button>
          {error?.field === 'slug' && <p className="text-sm text-rose-700 mt-1" data-testid="category-edit-slug-error">{error.error}</p>}
          {slug !== category.slug && category.published && (
            <p className="text-xs text-amber-700 mt-1">Links that use the old address ({category.slug}) will stop working.</p>
          )}
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`cat-desc-${category.id}`}>Description (optional)</label>
        <textarea id={`cat-desc-${category.id}`} className="input w-full" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <span className="label">Hero image (optional)</span>
        <div className="flex items-center gap-3">
          {hero ? <ProductPicture src={hero} alt="" size={72} className="rounded-lg" testId="category-edit-hero" /> : <div className="w-[72px] h-[72px] rounded-lg bg-brand-cream-100" aria-hidden />}
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading...' : hero ? 'Replace image' : 'Upload image'}
            </button>
            {hero && (
              <button type="button" className="btn btn-sm btn-ghost text-rose-700" onClick={() => setHero(null)}>
                Remove image
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">{PHOTO_GUIDANCE}</p>
        {error?.field === 'heroImageUrl' && <p className="text-sm text-rose-700 mt-1">{error.error}</p>}
      </div>
      {error && !error.field && <p className="text-sm text-rose-700">{error.error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" disabled={saving || uploading} data-testid="category-save">{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </form>
  );
}
