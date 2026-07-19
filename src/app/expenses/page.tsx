'use client';
import { useState } from 'react';

export default function ExpensesPage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Daily Expenses Log</h1>
        <button className="btn btn-primary">New Expense</button>
      </div>
      <div className="mb-4"><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
      <div className="card p-8 text-center text-gray-400">No expenses recorded today</div>
    </div>
  );
}
