'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';

export default function ProductsPage() {
  const { isOwner } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetch('/api/products')
      .then(r => r.json())
      .then(d => { setProducts(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = products.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()) || p.itemNumber?.includes(search));

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Product / Stock Master</h1>
        {isOwner && <button className="btn btn-primary" onClick={() => setShowModal(true)}>Add Product</button>}
      </div>
      
      <div className="mb-4">
        <input type="text" placeholder="Search products..." className="input w-full max-w-md" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? <div className="p-8 text-center">Loading...</div> : (
        <div className="card table-container">
          <table className="table w-full">
            <thead>
              <tr>
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
                <tr key={p.id} className="border-t border-gray-700">
                  <td className="p-2">{p.itemNumber}</td>
                  <td className="p-2">{p.name}</td>
                  <td className="text-right p-2">{p.unitCostRMB}</td>
                  <td className="text-right p-2">{formatCurrency(p.unitCostUSD)}</td>
                  <td className="text-right p-2">{p.sellingPriceRMB}</td>
                  <td className="text-right p-2">{formatCurrency(p.sellingPriceUSD)}</td>
                  <td className="text-right p-2">{p.openingQty}</td>
                  <td className={`text-right p-2 font-bold ${p.currentStock <= 5 ? 'text-red-500' : p.currentStock <= 10 ? 'text-amber-500' : 'text-green-500'}`}>{p.currentStock}</td>
                  {isOwner && (
                    <td className="text-center p-2">
                      <button className="btn btn-sm btn-secondary mx-1">Edit</button>
                      <button className="btn btn-sm btn-danger mx-1">Delete</button>
                    </td>
                  )}
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={isOwner ? 9 : 8} className="p-4 text-center text-gray-400">No products found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="card p-6 w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">Add Product</h2>
            <form className="space-y-4">
              <div><label className="label">Item Number</label><input className="input w-full" required /></div>
              <div><label className="label">Product Name</label><input className="input w-full" required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Unit Cost (RMB)</label><input type="number" className="input w-full" required /></div>
                <div><label className="label">Unit Cost (USD)</label><input type="number" className="input w-full" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Opening Quantity</label><input type="number" className="input w-full" required /></div>
              </div>
              <div><label className="label">Notes</label><textarea className="input w-full" /></div>
              <div className="flex justify-end space-x-2 mt-6">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
