'use client';
export default function ReportsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Reports</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">Product List</div>
        <div className="card p-4">Daily Sales Log</div>
        <div className="card p-4">Daily Expenses</div>
      </div>
    </div>
  );
}
