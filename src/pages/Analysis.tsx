import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts'

type Period = 'today' | '7d' | 'month' | '3m' | 'custom'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function getStart(period: Period, customFrom: string): string {
  const d = new Date()
  if (period === 'today') return new Date().toISOString().slice(0, 10)
  if (period === '7d') { d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) }
  if (period === 'month') { d.setDate(1); return d.toISOString().slice(0, 10) }
  if (period === '3m') { d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10) }
  if (period === 'custom') return customFrom
  return '1900-01-01'
}

const COLORS = ['#7FA68A', '#A89BCC', '#E8A5A5', '#F2C897', '#8AB3CC', '#B5CCA5', '#C8B8E8']

export default function Analysis() {
  const [txns, setTxns] = useState<any[]>([])
  const [income, setIncome] = useState<any[]>([])
  const [period, setPeriod] = useState<Period>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    const start = getStart(period, customFrom)
    const end = period === 'custom' ? customTo : new Date().toISOString().slice(0, 10)
    const [t, inc] = await Promise.all([
      supabase.from('transactions').select('*, categories(name)').gte('date', start).lte('date', end),
      supabase.from('income_streams').select('amount, frequency')
    ])
    setTxns(t.data ?? [])
    setIncome(inc.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [period])

  const FREQ: Record<string, number> = { monthly: 1, weekly: 4.33, quarterly: 0.33, annual: 0.083, 'one-time': 0 }
  const totalIncome = income.reduce((s, i) => s + i.amount * (FREQ[i.frequency] ?? 1), 0)
  // Credits are negative or marked 'credit' — treat as reimbursements, separate from spend
  const spendTxns = txns.filter(t => t.spending_type !== 'credit' && t.amount > 0)
  const creditTxns = txns.filter(t => t.spending_type === 'credit' || t.amount < 0)
  const totalExpenses = spendTxns.reduce((s, t) => s + t.amount, 0)
  const totalCredits = creditTxns.reduce((s, t) => s + Math.abs(t.amount), 0)
  const netExpenses = totalExpenses - totalCredits
  const netBalance = totalIncome - netExpenses
  const unnecessary = spendTxns.filter(t => t.spending_type === 'unnecessary').reduce((s, t) => s + t.amount, 0)
  const discRatio = totalExpenses > 0 ? (unnecessary / totalExpenses * 100).toFixed(1) : '0.0'

  // Category map uses net (spend - credits per category)
  const catMap: Record<string, number> = {}
  txns.forEach(t => {
    const k = t.categories?.name ?? 'Other'
    const amt = (t.spending_type === 'credit' || t.amount < 0) ? -Math.abs(t.amount) : t.amount
    catMap[k] = (catMap[k] ?? 0) + amt
  })
  const catData = Object.entries(catMap).map(([name, value]) => ({ name, value: Math.max(0, value) })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)

  const necessary = totalExpenses - unnecessary
  const necData = [{ name: 'Necessary', value: necessary }, { name: 'Discretionary', value: unnecessary }]

  const dayMap: Record<string, number> = {}
  txns.forEach(t => { dayMap[t.date.slice(0, 10)] = (dayMap[t.date.slice(0, 10)] ?? 0) + t.amount })
  const trendData = Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({
    date: new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), amount
  }))

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'today', label: 'Today' }, { key: '7d', label: '7 Days' },
    { key: 'month', label: 'This Month' }, { key: '3m', label: '3 Months' }, { key: 'custom', label: 'Custom' }
  ]

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Spending Analysis</h1>
        <p className="text-gray-400 text-sm mt-1">Where your money goes.</p>
      </div>

      {/* Period pills */}
      <div className="flex gap-2 flex-wrap mb-4">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-all
              ${period === p.key ? 'bg-[#7FA68A] text-white border-[#7FA68A]' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {period === 'custom' && (
        <div className="flex gap-3 mb-4 items-center">
          <input type="date" className="border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-[#7FA68A]"
            value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          <span className="text-gray-400">to</span>
          <input type="date" className="border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-[#7FA68A]"
            value={customTo} onChange={e => setCustomTo(e.target.value)} />
          <button onClick={load} className="bg-[#7FA68A] text-white px-4 py-2 rounded-xl text-sm">Apply</button>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Inflow', value: fmt(totalIncome), bg: 'bg-[#C8DDD0]' },
          { label: 'Gross Spend', value: fmt(totalExpenses), bg: 'bg-[#F0CECE]' },
          { label: 'Reimbursed', value: fmt(totalCredits), bg: 'bg-[#C4E8D5]' },
          { label: 'Net Spend', value: fmt(netExpenses), bg: netExpenses <= totalIncome ? 'bg-[#C4DCF0]' : 'bg-[#F0CECE]' },
        ].map(card => (
          <div key={card.label} className={`${card.bg} rounded-2xl p-4`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 opacity-70">{card.label}</div>
            <div className="text-xl font-light text-gray-800 mt-1" style={{ fontFamily: 'Georgia,serif' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading...</p> : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Category donut */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <div className="text-sm font-semibold text-gray-700 mb-3">Category Breakdown</div>
              {catData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={catData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                      {catData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: unknown) => fmt(Number(v))} />
                    <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11 }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data for this period</div>}
            </div>

            {/* Necessary vs Discretionary */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <div className="text-sm font-semibold text-gray-700 mb-3">Necessary vs Discretionary</div>
              {totalExpenses > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={necData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={4}>
                        <Cell fill="#7FA68A" />
                        <Cell fill="#E8A5A5" />
                      </Pie>
                      <Tooltip formatter={(v: unknown) => fmt(Number(v))} />
                      <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11 }}>{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-1.5 mt-2">
                    {necData.map((d, i) => (
                      <div key={d.name} className="flex justify-between text-xs text-gray-500">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full inline-block" style={{ background: i === 0 ? '#7FA68A' : '#E8A5A5' }} />
                          {d.name}
                        </span>
                        <strong className="text-gray-700">{fmt(d.value)}</strong>
                      </div>
                    ))}
                  </div>
                </>
              ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data for this period</div>}
            </div>
          </div>

          {/* Trendline */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className="text-sm font-semibold text-gray-700 mb-3">Daily Expense Velocity</div>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={52}
                    tickFormatter={v => v >= 1000 ? `₹${(v/1000).toFixed(0)}K` : `₹${v}`} />
                  <Tooltip formatter={(v: unknown) => fmt(Number(v))} />
                  <Line type="monotone" dataKey="amount" stroke="#7FA68A" strokeWidth={2} dot={{ r: 4, fill: '#7FA68A', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data for this period</div>}
          </div>
        </>
      )}
    </div>
  )
}