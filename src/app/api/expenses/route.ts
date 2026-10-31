import { NextResponse } from 'next/server';
import { createExpense, getExpenses } from '@/lib/expenses';
import { authorize } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const dateStr = url.searchParams.get('date');
    const date = dateStr ? new Date(dateStr) : undefined;
    const expenses = await getExpenses(date);
    return NextResponse.json(expenses);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  try {
    const body = await request.json();
    const { expenseDate, category, description, amount, paymentMethod, paidTo, notes } = body;

    if (!description || typeof amount !== 'number' || amount <= 0 || !category) {
      return NextResponse.json({ error: 'Invalid fields: description, category and amount > 0 are required' }, { status: 400 });
    }

    // Allow-listed fields only; createdBy always comes from the session.
    const newExpense = await createExpense({
      expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
      category,
      description,
      amount,
      paymentMethod,
      paidTo,
      notes,
      createdBy: session.username,
    });
    return NextResponse.json(newExpense, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
