import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FREQ: Record<string, number> = { monthly: 1, weekly: 4.33, quarterly: 0.33, annual: 0.083, 'one-time': 0 }

export default function IncomeVsSpend() {
  const [txns, setTxns] = useState<any[]>([])
  const [income, setIncome] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
      const [t, inc] = await Promise.all([
        supabase.from('transactions').select('date, amount').gte('date', sixMonthsAgo.toISOString().slice(0, 10)),
        supabase.from('income_streams').select('amount, frequency')
      ])
      setTxns(t.data ?? [])
      setIncome(inc.data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const monthlyIncome = income.reduce((s, i) => s + i.amount * (FREQ[i.frequency] ?? 1), 0)

  const spendMap: Record<string, number> = {}
  txns.forEach(t => {
    const d = new Date(t.date)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const amt = (t.spending_type === 'credit' || t.amount < 0) ? -Math.abs(t.amount) : t.amount
    spendMap[key] = (spendMap[key] ?? 0) + amt
  })

  const chartData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i))
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const expenses = spendMap[key] ?? 0
    return { month: MONTHS[d.getMonth()], income: monthlyIncome, expenses, savings: monthlyIncome - expenses }
  })

  const totalIncome = chartData.reduce((s, m) => s + m.income, 0)
  const totalExpenses = chartData.reduce((s, m) => s + m.expenses, 0)
  const totalSavings = totalIncome - totalExpenses
  const avgRate = totalIncome > 0 ? (totalSavings / totalIncome * 100).toFixed(1) : '0.0'

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Income vs Spending</h1>
        <p className="text-gray-400 text-sm mt-1">Month-over-month financial health.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Income (6M)', value: fmt(totalIncome), bg: 'bg-[#C8DDD0]' },
          { label: 'Total Expenses (6M)', value: fmt(totalExpenses), bg: 'bg-[#F0CECE]' },
          { label: 'Net Savings (6M)', value: fmt(totalSavings), bg: 'bg-[#C4E8D5]' },
          { label: 'Avg Savings Rate', value: `${avgRate}%`, bg: 'bg-[#D5CEED]' },
        ].map(card => (
          <div key={card.label} className={`${card.bg} rounded-2xl p-4`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 opacity-70">{card.label}</div>
            <div className="text-xl font-light text-gray-800 mt-1" style={{ fontFamily: 'Georgia,serif' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading...</p> : (
        <>
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm mb-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">Monthly Income vs Expenses</div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barGap={4} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={52}
                  tickFormatter={v => v >= 1000 ? `₹${(v/1000).toFixed(0)}K` : `₹${v}`} />
                <Tooltip formatter={(v: unknown, name: unknown) => [fmt(Number(v)), name === 'income' ? 'Income' : 'Expenses']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #F3F4F6' }} />
                <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 11 }}>{v === 'income' ? 'Income' : 'Expenses'}</span>} />
                <Bar dataKey="income" fill="#7FA68A" radius={[6, 6, 0, 0]} name="income" />
                <Bar dataKey="expenses" fill="#E8A5A5" radius={[6, 6, 0, 0]} name="expenses" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm overflow-x-auto">
            <div className="text-sm font-semibold text-gray-700 mb-3">Monthly Savings Breakdown</div>
            <table className="w-full text-sm min-w-96">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide">
                  <td className="py-2">Month</td><td className="py-2">Income</td>
                  <td className="py-2">Expenses</td><td className="py-2">Savings</td><td className="py-2">Rate</td>
                </tr>
              </thead>
              <tbody>
                {chartData.map(row => {
                  const rate = row.income > 0 ? (row.savings / row.income * 100).toFixed(1) : '0.0'
                  return (
                    <tr key={row.month} className="border-t border-gray-50 hover:bg-gray-50 transition-all">
                      <td className="py-2.5 font-medium text-gray-700">{row.month}</td>
                      <td className="py-2.5 text-[#7FA68A]">{fmt(row.income)}</td>
                      <td className="py-2.5 text-red-400">{fmt(row.expenses)}</td>
                      <td className="py-2.5 font-medium" style={{ color: row.savings >= 0 ? '#7FA68A' : '#F87171' }}>{fmt(row.savings)}</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: Number(rate) >= 50 ? '#C8DDD0' : Number(rate) >= 20 ? '#F7DEC4' : '#F0CECE', color: '#374151' }}>
                          {rate}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}