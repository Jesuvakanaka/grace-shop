'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import Image from 'next/image';
import { QuantityPill } from '@/components/ui/QuantityPill';

interface Product {
  id: number;
  itemNumber: string;
  productName: string;
  imageUrl: string | null;
  unitCostRmb: number;
  unitCostUsd: number;
  sellingPriceRmb: number;
  sellingPriceUsd: number;
  openingQuantity: number;
  currentQuantity: number;
  notes: string | null;
}

export default function ProductsPage() {
  const { isOwner } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
    openingQuantity: '0',
    notes: '',
    imageUrl: '' as string | null
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = () => {
    fetch('/api/products')
      .then(r => r.json())
      .then(d => { setProducts(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const resetForm = () => {
    setFormData({
      itemNumber: '',
      productName: '',
      unitCostRmb: '',
      unitCostUsd: '',
      openingQuantity: '0',
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
      openingQuantity: String(product.openingQuantity),
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
      const payload = {
        itemNumber: formData.itemNumber,
        productName: formData.productName,
        unitCostRmb: Number(formData.unitCostRmb || 0),
        unitCostUsd: Number(formData.unitCostUsd || 0),
        openingQuantity: Number(formData.openingQuantity || 0),
        notes: formData.notes || null,
        imageUrl: formData.imageUrl
      };

      let res;
      if (editingProduct) {
        res = await fetch(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
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

  const filtered = products.filter(p => 
    p.productName?.toLowerCase().includes(search.toLowerCase()) || 
    p.itemNumber?.includes(search)
  );

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

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
      
      <div className="mb-4">
        <input 
          type="text" 
          placeholder="Search products..." 
          className="input w-full max-w-md" 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
        />
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
                  <Image src={p.imageUrl} alt={p.productName} width={48} height={48} className="rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 shrink-0">📦</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{p.productName}</p>
                  <p className="text-sm text-slate-500">#{p.itemNumber} · {formatCurrency(p.sellingPriceUsd)}</p>
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

          {/* Desktop table */}
          <table className="table w-full hidden md:table">
            <thead>
              <tr>
                <th className="text-left p-2 w-16">Image</th>
                <th className="text-left p-2">Item #</th>
                <th className="text-left p-2">Product Name</th>
                <th className="text-right p-2">Unit Cost (RMB)</th>
                <th className="text-right p-2">Unit Cost (USD)</th>
                <th className="text-right p-2">Selling (RMB)</th>
                <th className="text-right p-2">Selling (USD)</th>
                <th className="text-right p-2">Opening Qty</th>
                <th className="text-right p-2">Current Stock</th>
                {isOwner && <th className="text-center p-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-t border-gray-700" data-testid="product-row" data-item-number={p.itemNumber}>
                  <td className="p-2">
                    {p.imageUrl ? (
                      <Image
                        src={p.imageUrl}
                        alt={p.productName}
                        width={40}
                        height={40}
                        className="rounded object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-slate-700 rounded flex items-center justify-center text-slate-500 text-xs">
                        No img
                      </div>
                    )}
                  </td>
                  <td className="p-2">{p.itemNumber}</td>
                  <td className="p-2">{p.productName}</td>
                  <td className="text-right p-2">{p.unitCostRmb}</td>
                  <td className="text-right p-2">{formatCurrency(p.unitCostUsd)}</td>
                  <td className="text-right p-2" data-testid="product-selling-price-rmb">{p.sellingPriceRmb}</td>
                  <td className="text-right p-2" data-testid="product-selling-price-usd">{formatCurrency(p.sellingPriceUsd)}</td>
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
                  <td colSpan={isOwner ? 10 : 9} className="p-4 text-center text-gray-400">
                    No products found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </h2>
            
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-sm mb-4">
                {error}
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Image Upload */}
              <div>
                <label className="label">Product Image</label>
                <div className="flex items-start gap-4">
                  <div className="w-24 h-24 bg-slate-700 rounded-lg overflow-hidden flex items-center justify-center">
                    {imagePreview ? (
                      <Image
                        src={imagePreview}
                        alt="Preview"
                        width={96}
                        height={96}
                        className="object-cover w-full h-full"
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
                      {uploading ? 'Uploading...' : 'Upload Image'}
                    </button>
                    {imagePreview && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost w-full text-red-400"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="card p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4 text-red-400">Delete Product?</h2>
            <p className="text-slate-300 mb-4">
              Are you sure you want to delete <strong>{deleteConfirm.productName}</strong> (Item #{deleteConfirm.itemNumber})?
            </p>
            <p className="text-sm text-slate-400 mb-6">
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
