'use client';
import { useState } from 'react';
export default function ClosingPage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">End-of-Day Closing</h1>
      <div className="mb-4"><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
      <div className="card p-6">Closing Summary</div>
    </div>
  );
}
