'use client';
import { useState } from 'react';

export default function CashPage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Cash Position Tracker</h1>
      <div className="mb-4"><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
      <div className="card p-6 space-y-4">
         <p>Opening Cash: ...</p>
         <p>+ Cash Sales: ...</p>
         <p>- Expenses: ...</p>
      </div>
    </div>
  );
}
