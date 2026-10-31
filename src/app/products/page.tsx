'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { ProductPicture } from '@/components/ProductPicture';
import { QuantityPill } from '@/components/ui/QuantityPill';
import { getMissingProductDetails } from '@/lib/product-completeness';

interface Product {
  id: number;
  itemNumber: string;
  productName: string;
  imageUrl: string | null;
  unitCostRmb: number;
  unitCostUsd: number;
  sellingPriceRmb: number;
  sellingPriceUsd: number;
  wholesalePriceUsd: number | null;
  wholesaleMinQuantity: number | null;
  openingQuantity: number;
  currentQuantity: number;
  notes: string | null;
  sourceFilename: string | null;
}

export default function ProductsPage() {
  const { isOwner } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [needsDetailsOnly, setNeedsDetailsOnly] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [formData, setFormData] = useState({
    itemNumber: '',
    productName: '',
    unitCostRmb: '',
    unitCostUsd: '',
    wholesalePriceUsd: '',
    wholesaleMinQuantity: '',
    openingQuantity: '0',
    sellingPriceUsd: '',
    currentQuantity: '',
    notes: '',
    imageUrl: '' as string | null
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchProducts = () => {
    fetch('/api/products')
      .then(r => r.json())
      .then(d => { setProducts(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const resetForm = () => {
    setFormData({
      itemNumber: '',
      productName: '',
      unitCostRmb: '',
      unitCostUsd: '',
      wholesalePriceUsd: '',
      wholesaleMinQuantity: '',
      openingQuantity: '0',
      sellingPriceUsd: '',
      currentQuantity: '',
      notes: '',
      imageUrl: null
    });
    setImagePreview(null);
    setError('');
  };

  const openAddModal = () => {
    resetForm();
    setEditingProduct(null);
    setShowModal(true);
  };

  const openEditModal = (product: Product) => {
    setFormData({
      itemNumber: product.itemNumber,
      productName: product.productName,
      unitCostRmb: String(product.unitCostRmb),
      unitCostUsd: String(product.unitCostUsd),
      wholesalePriceUsd: product.wholesalePriceUsd == null ? '' : String(product.wholesalePriceUsd),
      wholesaleMinQuantity: product.wholesaleMinQuantity == null ? '' : String(product.wholesaleMinQuantity),
      openingQuantity: String(product.openingQuantity),
      sellingPriceUsd: String(product.sellingPriceUsd),
      currentQuantity: String(product.currentQuantity),
      notes: product.notes || '',
      imageUrl: product.imageUrl
    });
    setImagePreview(product.imageUrl);
    setEditingProduct(product);
    setError('');
    setShowModal(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload to server
    setUploading(true);
    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formDataUpload
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      
      setFormData(prev => ({ ...prev, imageUrl: data.url }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setImagePreview(null);
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setFormData(prev => ({ ...prev, imageUrl: null }));
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    
    try {
      const payload: Record<string, unknown> = {
        itemNumber: formData.itemNumber,
        productName: formData.productName,
        unitCostRmb: Number(formData.unitCostRmb || 0),
        unitCostUsd: Number(formData.unitCostUsd || 0),
        openingQuantity: Number(formData.openingQuantity || 0),
        // Sent as typed; the server validates it and stores empty as null (not set).
        wholesalePriceUsd: formData.wholesalePriceUsd.trim() || null,
        wholesaleMinQuantity: formData.wholesaleMinQuantity.trim() || null,
        notes: formData.notes || null,
        imageUrl: formData.imageUrl
      };

      // Edit only: retail price, and stock on hand (recorded as a stock adjustment).
      let newStock: number | null = null;
      if (editingProduct) {
        const retail = formData.sellingPriceUsd.trim() === '' ? 0 : Number(formData.sellingPriceUsd);
        if (!Number.isFinite(retail) || retail < 0) throw new Error('Retail price must be a number of 0 or more.');
        payload.sellingPriceUsd = retail;
        const stockText = formData.currentQuantity.trim();
        if (!/^\d+$/.test(stockText)) throw new Error('Stock on hand must be a whole number of 0 or more.');
        if (Number(stockText) !== editingProduct.currentQuantity) newStock = Number(stockText);
      }

      let res;
      if (editingProduct) {
        res = await fetch(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok && newStock !== null) {
          const adjust = await fetch('/api/stock-movements/adjust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId: editingProduct.id,
              newQuantity: newStock,
              notes: `Stock set to ${newStock} from the Products screen`
            })
          });
          if (!adjust.ok) {
            const data = await adjust.json().catch(() => ({}));
            fetchProducts();
            throw new Error(`Details saved, but the stock could not be set: ${data.error || adjust.status}`);
          }
          // Re-read so the list shows the new stock.
          res = await fetch(`/api/products/${editingProduct.id}`);
        }
      } else {
        res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save product');
      
      if (editingProduct) {
        setProducts(products.map(p => p.id === editingProduct.id ? data : p));
      } else {
        setProducts([...products, data]);
      }
      
      setShowModal(false);
      resetForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Save failed';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    
    try {
      const res = await fetch(`/api/products/${deleteConfirm.id}`, {
        method: 'DELETE'
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      
      setProducts(products.filter(p => p.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      alert(message);
    }
  };

  // "Needs details" is shown to owners only: they are the ones who can fix it.
  const missingFor = (p: Product) => (isOwner ? getMissingProductDetails(p) : []);
  const needsDetailsCount = isOwner ? products.filter(p => missingFor(p).length > 0).length : 0;

  const filtered = products.filter(p =>
    (p.productName?.toLowerCase().includes(search.toLowerCase()) ||
    p.itemNumber?.includes(search)) &&
    (!needsDetailsOnly || missingFor(p).length > 0)
  ).sort((a, b) => a.itemNumber.localeCompare(b.itemNumber, 'en', { numeric: true })); // AUG-2 before AUG-10

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  // Wholesale price is optional: show a dash when it has not been set.
  const formatWholesale = (val: number | null) => (val == null ? '—' : formatCurrency(val));

  const needsDetailsBadge = (p: Product) => {
    const missing = missingFor(p);
    if (!missing.length) return null;
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span
          className="badge badge-warning"
          title={`Missing: ${missing.join(', ')}`}
          data-testid="product-needs-details"
        >
          Needs details
        </span>
        <span className="text-xs text-amber-700" data-testid="product-missing-details">
          {missing.join(', ')}
        </span>
      </span>
    );
  };

  const desktopColumnCount = isOwner ? 12 : 11;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Product / Stock Master</h1>
        {isOwner && (
          <button className="btn btn-primary" onClick={openAddModal} data-testid="add-product">
            Add Product
          </button>
        )}
      </div>
      
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search products..."
          className="input w-full max-w-md"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {isOwner && (
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={needsDetailsOnly}
              onChange={e => setNeedsDetailsOnly(e.target.checked)}
              data-testid="filter-needs-details"
            />
            Needs details only ({needsDetailsCount})
          </label>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500">Loading...</div>
      ) : (
        <>
          <div className="card table-container" data-testid="product-table">
          {/* Mobile card list */}
          <div className="md:hidden space-y-2 p-2">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="list-row"
                data-item-number={p.itemNumber}
                onClick={() => isOwner && openEditModal(p)}
                onKeyDown={(e) => e.key === 'Enter' && isOwner && openEditModal(p)}
                role={isOwner ? 'button' : undefined}
                tabIndex={isOwner ? 0 : undefined}
              >
                {p.imageUrl ? (
                  <ProductPicture src={p.imageUrl} alt={p.productName} size={56} className="rounded-lg shrink-0" />
                ) : (
                  <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 shrink-0">📦</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{p.productName}</p>
                  <p className="text-sm text-slate-500">#{p.itemNumber} · {formatCurrency(p.sellingPriceUsd)}</p>
                  <p className="text-xs text-slate-500" data-testid="product-wholesale">
                    Wholesale {formatWholesale(p.wholesalePriceUsd)}
                    {p.wholesaleMinQuantity != null && ` · min ${p.wholesaleMinQuantity}`}
                  </p>
                  {needsDetailsBadge(p)}
                  <span className="sr-only" data-testid="product-selling-price-rmb">{p.sellingPriceRmb}</span>
                  <span className="sr-only" data-testid="product-selling-price-usd">{formatCurrency(p.sellingPriceUsd)}</span>
                  <span className="sr-only" data-testid="product-opening-quantity">{p.openingQuantity}</span>
                </div>
                <span data-testid="product-current-stock" data-stock={p.currentQuantity}>
                  <QuantityPill quantity={p.currentQuantity} />
                </span>
              </div>
            ))}
            {!filtered.length && <div className="text-center text-slate-500 py-8">No products found</div>}
          </div>

          {/* Desktop table. Visibility lives on a wrapper: the `table` class is also
              Tailwind's display:table utility, which overrode `hidden` on the table itself. */}
          <div className="hidden md:block">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="text-left p-2 w-16">Image</th>
                <th className="text-left p-2">Item #</th>
                <th className="text-left p-2">Product Name</th>
                <th className="text-right p-2">Unit Cost (RMB)</th>
                <th className="text-right p-2">Unit Cost (USD)</th>
                <th className="text-right p-2">Selling (RMB)</th>
                <th className="text-right p-2">Selling (USD)</th>
                <th className="text-right p-2">Wholesale (USD)</th>
                <th className="text-right p-2">Wholesale Min Qty</th>
                <th className="text-right p-2">Opening Qty</th>
                <th className="text-right p-2">Current Stock</th>
                {isOwner && <th className="text-center p-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-t border-slate-200" data-testid="product-row" data-item-number={p.itemNumber}>
                  <td className="p-2">
                    {p.imageUrl ? (
                      <ProductPicture src={p.imageUrl} alt={p.productName} size={48} className="rounded" />
                    ) : (
                      <div className="w-10 h-10 bg-brand-cream-100 rounded flex items-center justify-center text-slate-500 text-xs">
                        No img
                      </div>
                    )}
                  </td>
                  <td className="p-2">{p.itemNumber}</td>
                  <td className="p-2">
                    {p.productName}
                    {needsDetailsBadge(p) && <div className="mt-1">{needsDetailsBadge(p)}</div>}
                  </td>
                  <td className="text-right p-2">{p.unitCostRmb}</td>
                  <td className="text-right p-2">{formatCurrency(p.unitCostUsd)}</td>
                  <td className="text-right p-2" data-testid="product-selling-price-rmb">{p.sellingPriceRmb}</td>
                  <td className="text-right p-2" data-testid="product-selling-price-usd">{formatCurrency(p.sellingPriceUsd)}</td>
                  <td className="text-right p-2" data-testid="product-wholesale-price-usd">{formatWholesale(p.wholesalePriceUsd)}</td>
                  <td className="text-right p-2" data-testid="product-wholesale-min-qty">{p.wholesaleMinQuantity ?? '—'}</td>
                  <td className="text-right p-2" data-testid="product-opening-quantity">{p.openingQuantity}</td>
                  <td className="text-right p-2 font-bold" data-testid="product-current-stock" data-stock={p.currentQuantity}>
                    {p.currentQuantity}
                  </td>
                  {isOwner && (
                    <td className="text-center p-2 space-x-1">
                      <button 
                        className="btn btn-sm btn-secondary"
                        onClick={() => openEditModal(p)}
                      >
                        Edit
                      </button>
                      <button 
                        className="btn btn-sm btn-danger"
                        onClick={() => setDeleteConfirm(p)}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={desktopColumnCount} className="p-4 text-center text-slate-500">
                    No products found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          </div>
        </>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-brand-ink/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </h2>
            
            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm mb-4">
                {error}
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Image Upload */}
              <div>
                <label className="label">Product Image</label>
                <div className="flex items-start gap-4">
                  <div className="w-32 h-32 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                    {imagePreview ? (
                      <ProductPicture
                        src={imagePreview}
                        alt="Preview"
                        size={128}
                        className="w-full h-full"
                        testId="product-form-image-preview"
                      />
                    ) : (
                      <span className="text-slate-500 text-xs text-center">No image</span>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary w-full"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? 'Uploading...' : imagePreview ? 'Replace Image' : 'Upload Image'}
                    </button>
                    {imagePreview && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost w-full text-rose-700"
                        onClick={removeImage}
                      >
                        Remove Image
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="label">Item Number</label>
                <input 
                  type="text"
                  className="input w-full" 
                  value={formData.itemNumber} 
                  onChange={e => setFormData(prev => ({ ...prev, itemNumber: e.target.value }))} 
                  required 
                  disabled={!!editingProduct}
                  data-testid="product-form-item-number"
                />
              </div>
              
              <div>
                <label className="label">Product Name</label>
                <input 
                  type="text"
                  className="input w-full" 
                  value={formData.productName} 
                  onChange={e => setFormData(prev => ({ ...prev, productName: e.target.value }))} 
                  required 
                  data-testid="product-form-name"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Unit Cost (RMB)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    className="input w-full" 
                    value={formData.unitCostRmb} 
                    onChange={e => setFormData(prev => ({ ...prev, unitCostRmb: e.target.value }))} 
                    required 
                    data-testid="product-form-cost-rmb"
                  />
                </div>
                <div>
                  <label className="label">Unit Cost (USD)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    className="input w-full" 
                    value={formData.unitCostUsd} 
                    onChange={e => setFormData(prev => ({ ...prev, unitCostUsd: e.target.value }))} 
                    data-testid="product-form-cost-usd"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="product-form-wholesale-price">Wholesale Price (USD)</label>
                  <input
                    id="product-form-wholesale-price"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="Not set"
                    className="input w-full"
                    value={formData.wholesalePriceUsd}
                    onChange={e => setFormData(prev => ({ ...prev, wholesalePriceUsd: e.target.value }))}
                    data-testid="product-form-wholesale-price"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="product-form-wholesale-min-qty">Wholesale Min Qty</label>
                  <input
                    id="product-form-wholesale-min-qty"
                    type="number"
                    step="1"
                    min="1"
                    inputMode="numeric"
                    placeholder="Not set"
                    className="input w-full"
                    value={formData.wholesaleMinQuantity}
                    onChange={e => setFormData(prev => ({ ...prev, wholesaleMinQuantity: e.target.value }))}
                    data-testid="product-form-wholesale-min-qty"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500 -mt-2">
                Leave empty if not set yet. The wholesale price applies from the minimum quantity up.
              </p>

              {editingProduct && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label" htmlFor="product-form-retail-price">Retail Price (USD)</label>
                    <input
                      id="product-form-retail-price"
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      className="input w-full"
                      value={formData.sellingPriceUsd}
                      onChange={e => setFormData(prev => ({ ...prev, sellingPriceUsd: e.target.value }))}
                      data-testid="product-form-retail-price"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="product-form-stock">Stock on hand</label>
                    <input
                      id="product-form-stock"
                      type="number"
                      step="1"
                      min="0"
                      inputMode="numeric"
                      className="input w-full"
                      value={formData.currentQuantity}
                      onChange={e => setFormData(prev => ({ ...prev, currentQuantity: e.target.value }))}
                      data-testid="product-form-stock"
                    />
                  </div>
                </div>
              )}
              {editingProduct && (
                <p className="text-xs text-slate-500 -mt-2">
                  Changing stock on hand records a stock adjustment in the stock ledger.
                </p>
              )}

              {!editingProduct && (
                <div>
                  <label className="label">Opening Quantity</label>
                  <input 
                    type="number" 
                    className="input w-full" 
                    value={formData.openingQuantity} 
                    onChange={e => setFormData(prev => ({ ...prev, openingQuantity: e.target.value }))} 
                    required 
                    data-testid="product-form-opening-qty"
                  />
                </div>
              )}
              
              <div>
                <label className="label">Notes</label>
                <textarea 
                  className="input w-full" 
                  value={formData.notes} 
                  onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} 
                  data-testid="product-form-notes"
                />
              </div>
              
              <div className="flex justify-end space-x-2 mt-6">
                <button 
                  type="button" 
                  className="btn btn-ghost" 
                  onClick={() => { setShowModal(false); resetForm(); }}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={saving || uploading}
                  data-testid="product-form-submit"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-brand-ink/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="card p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-2xl mb-4 text-rose-700">Delete Product?</h2>
            <p className="text-slate-700 mb-4">
              Are you sure you want to delete <strong>{deleteConfirm.productName}</strong> (Item #{deleteConfirm.itemNumber})?
            </p>
            <p className="text-sm text-slate-500 mb-6">
              This action cannot be undone. Stock movements and sales referencing this product may be affected.
            </p>
            <div className="flex justify-end space-x-2">
              <button 
                className="btn btn-ghost" 
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-danger" 
                onClick={handleDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
