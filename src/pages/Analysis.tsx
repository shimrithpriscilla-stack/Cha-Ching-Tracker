import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
  AreaChart, Area,
} from 'recharts'

type Period = 'today' | '7d' | 'month' | '3m' | '6m' | '1y' | 'custom'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function fmtK(n: number) {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`
  return `₹${n.toFixed(0)}`
}

function getStart(period: Period, customFrom: string): string {
  const d = new Date()
  if (period === 'today') return new Date().toISOString().slice(0, 10)
  if (period === '7d') { d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) }
  if (period === 'month') { d.setDate(1); return d.toISOString().slice(0, 10) }
  if (period === '3m') { d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10) }
  if (period === '6m') { d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10) }
  if (period === '1y') { d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10) }
  if (period === 'custom') return customFrom
  return '1900-01-01'
}

const PALETTE = [
  '#7FA68A', '#A89BCC', '#E8A5A5', '#F2C897',
  '#8AB3CC', '#B5CCA5', '#C8B8E8', '#F0C5B0',
  '#A5C8D0', '#D4B8A5', '#B8D4A5', '#C8A5D0',
]

// Custom tooltip for line/area/bar charts
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="text-gray-500 mb-1 font-medium">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-gray-600">{p.name}:</span>
          <strong className="text-gray-800">{fmt(p.value)}</strong>
        </div>
      ))}
    </div>
  )
}

// Tab type for chart switcher
type ChartTab = 'trend' | 'monthly' | 'categories' | 'donut'

export default function Analysis() {
  const [txns, setTxns] = useState<any[]>([])
  const [income, setIncome] = useState<any[]>([])
  const [period, setPeriod] = useState<Period>('3m')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeChart, setActiveChart] = useState<ChartTab>('monthly')

  async function load() {
    setLoading(true)
    const start = getStart(period, customFrom)
    const end = period === 'custom' ? customTo : new Date().toISOString().slice(0, 10)
    const [t, inc] = await Promise.all([
      supabase
        .from('transactions')
        .select('*, categories(name)')
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true }),
      supabase.from('income_streams').select('amount, frequency')
    ])
    setTxns(t.data ?? [])
    setIncome(inc.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [period])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived metrics ──────────────────────────────────────────────────────────

  const FREQ: Record<string, number> = { monthly: 1, weekly: 4.33, quarterly: 0.33, annual: 0.083, 'one-time': 0 }
  const totalIncome = income.reduce((s, i) => s + i.amount * (FREQ[i.frequency] ?? 1), 0)

  const spendTxns = txns.filter(t => t.spending_type !== 'credit' && t.amount > 0)
  const creditTxns = txns.filter(t => t.spending_type === 'credit' || t.amount < 0)
  const totalExpenses = spendTxns.reduce((s, t) => s + t.amount, 0)
  const totalCredits = creditTxns.reduce((s, t) => s + Math.abs(t.amount), 0)
  const netExpenses = totalExpenses - totalCredits
  const unnecessary = spendTxns.filter(t => t.spending_type === 'unnecessary').reduce((s, t) => s + t.amount, 0)
  const necessary = totalExpenses - unnecessary
  const discRatio = totalExpenses > 0 ? (unnecessary / totalExpenses * 100).toFixed(1) : '0.0'
  const netBalance = totalIncome - netExpenses

  // ── Category data (for donut + stacked bar) ──────────────────────────────────

  const catMap: Record<string, number> = {}
  spendTxns.forEach(t => {
    const k = t.categories?.name ?? 'Other'
    catMap[k] = (catMap[k] ?? 0) + t.amount
  })
  const catData = Object.entries(catMap)
    .map(([name, value]) => ({ name, value }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)

  // Top N categories for stacked bar (collapse rest into "Other")
  const TOP_N = 6
  const topCats = catData.slice(0, TOP_N).map(d => d.name)
  const otherCats = catData.slice(TOP_N).map(d => d.name)

  // ── Month-over-month data ────────────────────────────────────────────────────

  const monthMap: Record<string, { spend: number; credit: number; net: number; catBreakdown: Record<string, number> }> = {}
  txns.forEach(t => {
    const mo = t.date.slice(0, 7)  // "YYYY-MM"
    if (!monthMap[mo]) monthMap[mo] = { spend: 0, credit: 0, net: 0, catBreakdown: {} }
    const isCredit = t.spending_type === 'credit' || t.amount < 0
    if (isCredit) {
      monthMap[mo].credit += Math.abs(t.amount)
    } else {
      monthMap[mo].spend += t.amount
      const catName = t.categories?.name ?? 'Other'
      monthMap[mo].catBreakdown[catName] = (monthMap[mo].catBreakdown[catName] ?? 0) + t.amount
    }
  })
  const monthlyData = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mo, v]) => {
      const [y, m] = mo.split('-')
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
      const topBreakdown: Record<string, number> = {}
      let otherTotal = 0
      for (const [cat, amt] of Object.entries(v.catBreakdown)) {
        if (topCats.includes(cat)) topBreakdown[cat] = amt
        else otherTotal += amt
      }
      if (otherTotal > 0) topBreakdown['Other'] = otherTotal
      return { label, spend: v.spend, credit: v.credit, net: v.spend - v.credit, ...topBreakdown }
    })

  // ── Daily trend data ─────────────────────────────────────────────────────────

  const dayMap: Record<string, number> = {}
  spendTxns.forEach(t => {
    const d = t.date.slice(0, 10)
    dayMap[d] = (dayMap[d] ?? 0) + t.amount
  })
  // Running cumulative for area chart
  let cumulative = 0
  const trendData = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => {
      cumulative += amount
      return {
        date: new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        amount,
        cumulative,
      }
    })

  // ── Stacked bar category keys ────────────────────────────────────────────────

  const stackedKeys = [...topCats, ...(otherCats.length > 0 ? ['Other'] : [])]

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: '7D' },
    { key: 'month', label: 'This Month' },
    { key: '3m', label: '3 Months' },
    { key: '6m', label: '6 Months' },
    { key: '1y', label: '1 Year' },
    { key: 'custom', label: 'Custom' },
  ]

  const CHART_TABS: { key: ChartTab; label: string }[] = [
    { key: 'monthly', label: 'Month vs Month' },
    { key: 'categories', label: 'By Category' },
    { key: 'donut', label: 'Breakdown' },
    { key: 'trend', label: 'Daily Trend' },
  ]

  return (
    <div className="p-6 max-w-5xl">
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
        <div className="flex gap-3 mb-4 items-center flex-wrap">
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
          { label: 'Monthly Inflow', value: fmt(totalIncome), sub: 'from income streams', bg: 'bg-[#C8DDD0]' },
          { label: 'Gross Spend', value: fmt(totalExpenses), sub: `${discRatio}% discretionary`, bg: 'bg-[#F0CECE]' },
          { label: 'Reimbursed', value: fmt(totalCredits), sub: 'credits & refunds', bg: 'bg-[#C4E8D5]' },
          {
            label: 'Net Spend',
            value: fmt(netExpenses),
            sub: netBalance >= 0 ? `${fmt(netBalance)} remaining` : `${fmt(Math.abs(netBalance))} over budget`,
            bg: netExpenses <= totalIncome ? 'bg-[#C4DCF0]' : 'bg-[#F0CECE]',
          },
        ].map(card => (
          <div key={card.label} className={`${card.bg} rounded-2xl p-4`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600 opacity-70">{card.label}</div>
            <div className="text-xl font-light text-gray-800 mt-1" style={{ fontFamily: 'Georgia,serif' }}>{card.value}</div>
            {card.sub && <div className="text-[10px] text-gray-500 mt-0.5 opacity-80">{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* Spend split row */}
      {totalExpenses > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-700">Necessary vs Discretionary</span>
            <span className="text-xs text-gray-400">{discRatio}% discretionary</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden bg-gray-100 flex">
            <div className="h-full bg-[#7FA68A] transition-all" style={{ width: `${100 - Number(discRatio)}%` }} />
            <div className="h-full bg-[#E8A5A5] flex-1" />
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#7FA68A] inline-block" /> Necessary: <strong className="text-gray-700 ml-1">{fmt(necessary)}</strong>
            </span>
            <span className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#E8A5A5] inline-block" /> Discretionary: <strong className="text-gray-700 ml-1">{fmt(unnecessary)}</strong>
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-6 h-6 border-2 border-[#C8DDD0] border-t-[#7FA68A] rounded-full animate-spin" />
          <span className="text-sm">Loading transactions…</span>
        </div>
      ) : txns.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">No transactions found for this period.</div>
      ) : (
        <>
          {/* Chart tabs */}
          <div className="flex gap-1 mb-4 bg-[#F5F2EC] rounded-2xl p-1 w-fit">
            {CHART_TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveChart(tab.key)}
                className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all ${
                  activeChart === tab.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Month vs Month */}
          {activeChart === 'monthly' && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm mb-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-semibold text-gray-700">Month-over-Month Spend</div>
                  <div className="text-xs text-gray-400 mt-0.5">Gross spend vs credits per month</div>
                </div>
                {monthlyData.length > 1 && (() => {
                  const last = monthlyData[monthlyData.length - 1]
                  const prev = monthlyData[monthlyData.length - 2]
                  if (!prev) return null
                  const delta = last.spend - prev.spend
                  const pct = prev.spend > 0 ? (delta / prev.spend * 100).toFixed(1) : null
                  return (
                    <div className={`text-xs px-3 py-1.5 rounded-xl ${delta > 0 ? 'bg-red-50 text-red-500' : 'bg-[#C8DDD0] text-[#7FA68A]'}`}>
                      {delta > 0 ? '↑' : '↓'} {pct ? `${Math.abs(Number(pct))}%` : fmt(Math.abs(delta))} vs prev month
                    </div>
                  )
                })()}
              </div>
              {monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={56}
                      tickFormatter={fmtK} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11, color: '#6B7280' }}>{v}</span>} />
                    <Bar dataKey="spend" name="Gross spend" fill="#E8A5A5" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="credit" name="Credits" fill="#7FA68A" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No monthly data</div>}

              {/* Month over month line for net */}
              {monthlyData.length > 1 && (
                <div className="mt-5 border-t border-gray-50 pt-4">
                  <div className="text-xs font-semibold text-gray-600 mb-3">Net Spend Trend</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={56}
                        tickFormatter={fmtK} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="net" name="Net spend" stroke="#A89BCC" strokeWidth={2.5}
                        dot={{ r: 4, fill: '#A89BCC', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Stacked bar by category per month */}
          {activeChart === 'categories' && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm mb-4">
              <div className="mb-4">
                <div className="text-sm font-semibold text-gray-700">Spend by Category</div>
                <div className="text-xs text-gray-400 mt-0.5">How each category compares across months</div>
              </div>
              {monthlyData.length > 0 && stackedKeys.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={56}
                      tickFormatter={fmtK} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11, color: '#6B7280' }}>{v}</span>} />
                    {stackedKeys.map((cat, i) => (
                      <Bar key={cat} dataKey={cat} stackId="cats" fill={PALETTE[i % PALETTE.length]}
                        radius={i === stackedKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No category data for this period</div>
              )}

              {/* Category breakdown list */}
              {catData.length > 0 && (
                <div className="mt-5 border-t border-gray-50 pt-4">
                  <div className="text-xs font-semibold text-gray-600 mb-3">Category Totals</div>
                  <div className="flex flex-col gap-2">
                    {catData.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="text-xs text-gray-600 flex-1 truncate">{d.name}</span>
                        <div className="flex-1 mx-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(d.value / catData[0].value * 100).toFixed(1)}%`, background: PALETTE[i % PALETTE.length] }} />
                        </div>
                        <span className="text-xs font-medium text-gray-700 w-20 text-right">{fmt(d.value)}</span>
                        <span className="text-[10px] text-gray-400 w-8 text-right">{totalExpenses > 0 ? `${(d.value / totalExpenses * 100).toFixed(0)}%` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Donut breakdown */}
          {activeChart === 'donut' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Category donut */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                <div className="text-sm font-semibold text-gray-700 mb-3">By Category</div>
                {catData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={catData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        innerRadius={55} outerRadius={85} paddingAngle={2}>
                        {catData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: unknown) => fmt(Number(v))} />
                      <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11 }}>{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>}
              </div>

              {/* Necessary vs Discretionary donut */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                <div className="text-sm font-semibold text-gray-700 mb-3">Spend Type Split</div>
                {totalExpenses > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie
                          data={[{ name: 'Necessary', value: necessary }, { name: 'Discretionary', value: unnecessary }]}
                          dataKey="value" nameKey="name" cx="50%" cy="50%"
                          innerRadius={45} outerRadius={70} paddingAngle={4}
                        >
                          <Cell fill="#7FA68A" />
                          <Cell fill="#E8A5A5" />
                        </Pie>
                        <Tooltip formatter={(v: unknown) => fmt(Number(v))} />
                        <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11 }}>{v}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      {[
                        { label: 'Necessary', value: necessary, color: '#7FA68A' },
                        { label: 'Discretionary', value: unnecessary, color: '#E8A5A5' },
                      ].map(d => (
                        <div key={d.label} className="rounded-xl p-3" style={{ background: d.color + '22' }}>
                          <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">{d.label}</div>
                          <div className="text-base font-medium text-gray-800 mt-0.5">{fmt(d.value)}</div>
                          <div className="text-[10px] text-gray-400">{totalExpenses > 0 ? `${(d.value / totalExpenses * 100).toFixed(1)}%` : '—'}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>}
              </div>
            </div>
          )}

          {/* Daily trend */}
          {activeChart === 'trend' && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm mb-4">
              <div className="mb-4">
                <div className="text-sm font-semibold text-gray-700">Daily Expense Velocity</div>
                <div className="text-xs text-gray-400 mt-0.5">Spend per day + running cumulative</div>
              </div>
              {trendData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#A89BCC" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#A89BCC" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false}
                        interval={Math.max(0, Math.floor(trendData.length / 8))} />
                      <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={56}
                        tickFormatter={fmtK} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="cumulative" name="Cumulative" stroke="#A89BCC" strokeWidth={2}
                        fill="url(#cumGrad)" dot={false} activeDot={{ r: 4 }} />
                    </AreaChart>
                  </ResponsiveContainer>

                  <div className="mt-5 border-t border-gray-50 pt-4">
                    <div className="text-xs font-semibold text-gray-600 mb-3">Daily Spend</div>
                    <ResponsiveContainer width="100%" height={140}>
                      <LineChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false}
                          interval={Math.max(0, Math.floor(trendData.length / 8))} />
                        <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={56}
                          tickFormatter={fmtK} />
                        <Tooltip content={<ChartTooltip />} />
                        <Line type="monotone" dataKey="amount" name="Daily spend" stroke="#7FA68A" strokeWidth={2}
                          dot={{ r: 3, fill: '#7FA68A', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data for this period</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
