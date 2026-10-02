import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Edit2, Trash2, IndianRupee } from 'lucide-react'

interface IncomeStream {
  id: string
  source_name: string
  amount: number
  frequency: string
  date_received: string
}

const FREQUENCIES = ['monthly', 'weekly', 'quarterly', 'annual', 'one-time']
const FREQ_MULT: Record<string, number> = { monthly: 1, weekly: 4.33, quarterly: 0.33, annual: 0.083, 'one-time': 0 }

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

const blank = () => ({ source_name: '', amount: '', frequency: 'monthly', date_received: new Date().toISOString().slice(0, 10) })

export default function Income() {
  const [streams, setStreams] = useState<IncomeStream[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(blank())

  async function load() {
    const { data } = await supabase.from('income_streams').select('*').order('date_received', { ascending: false })
    setStreams(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function save() {
    if (!form.source_name || !form.amount) return
    if (editId) {
      await supabase.from('income_streams').update({ ...form, amount: Number(form.amount) }).eq('id', editId)
    } else {
      await supabase.from('income_streams').insert({ ...form, amount: Number(form.amount) })
    }
    setShowForm(false)
    setEditId(null)
    setForm(blank())
    load()
  }

  async function remove(id: string) {
    await supabase.from('income_streams').delete().eq('id', id)
    load()
  }

  function openEdit(s: IncomeStream) {
    setEditId(s.id)
    setForm({ source_name: s.source_name, amount: String(s.amount), frequency: s.frequency, date_received: s.date_received.slice(0, 10) })
    setShowForm(true)
  }

  const totalMonthly = streams.reduce((sum, s) => sum + s.amount * (FREQ_MULT[s.frequency] ?? 1), 0)

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Streams of Income</h1>
          <p className="text-gray-400 text-sm mt-1">All your income sources in one place.</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm(blank()) }}
          className="flex items-center gap-2 bg-[#7FA68A] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#6d9478] transition-all">
          <Plus size={15} /> Add Source
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Monthly Inflow', value: fmt(totalMonthly), bg: 'bg-[#C8DDD0]' },
          { label: 'Total Sources', value: streams.length, bg: 'bg-[#D5CEED]' },
          { label: 'Highest Amount', value: streams.length ? fmt(Math.max(...streams.map(s => s.amount))) : '—', bg: 'bg-[#F7DEC4]' },
        ].map(card => (
          <div key={card.label} className={`${card.bg} rounded-2xl p-4`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 opacity-70">{card.label}</div>
            <div className="text-2xl font-light text-gray-800 mt-1" style={{ fontFamily: 'Georgia,serif' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Stream cards */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : streams.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <IndianRupee size={40} strokeWidth={1} className="mx-auto mb-3" />
          <p>No income sources yet. Add your first one!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {streams.map(s => (
            <div key={s.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-[#C8DDD0] rounded-xl flex items-center justify-center">
                    <IndianRupee size={16} strokeWidth={1.5} className="text-[#7FA68A]" />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-800 text-sm">{s.source_name}</div>
                    <div className="text-xs text-gray-400">{new Date(s.date_received).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  </div>
                </div>
                <span className="text-xs bg-[#F5F2EC] text-gray-500 px-2 py-1 rounded-full capitalize">{s.frequency}</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>{fmt(s.amount)}</div>
                  {s.frequency !== 'one-time' && (
                    <div className="text-xs text-gray-400">≈ {fmt(s.amount * (FREQ_MULT[s.frequency] ?? 1))}/mo</div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(s)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-all"><Edit2 size={13} /></button>
                  <button onClick={() => remove(s.id)} className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-4" style={{ fontFamily: 'Georgia,serif' }}>{editId ? 'Edit Source' : 'Add Income Source'}</h2>
            <div className="flex flex-col gap-3">
              <input placeholder="Source name (e.g. Salary, Freelance)"
                className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                value={form.source_name} onChange={e => setForm(f => ({ ...f, source_name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" placeholder="Amount (₹)"
                  className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                  value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                <select className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A] bg-white"
                  value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <input type="date"
                className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                value={form.date_received} onChange={e => setForm(f => ({ ...f, date_received: e.target.value }))} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setShowForm(false); setEditId(null) }}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={save}
                className="flex-1 bg-[#7FA68A] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-[#6d9478]">
                {editId ? 'Save Changes' : 'Add Source'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}