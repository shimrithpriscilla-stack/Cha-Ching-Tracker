import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Search, Edit2, Trash2, ArrowUpDown } from 'lucide-react'

interface Transaction {
  id: string
  date: string
  amount: number
  spending_type: string
  notes: string
  categories?: { name: string }
  payment_modes?: { name: string }
  platforms?: { name: string }
}

interface DropdownItem { id: string; name: string }

type Period = '7d' | '30d' | 'month' | '3m' | 'all'
type SortField = 'date' | 'amount'
type SortDir = 'asc' | 'desc'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function getPeriodStart(period: Period): string {
  const d = new Date()
  if (period === '7d') { d.setDate(d.getDate() - 7) }
  else if (period === '30d') { d.setDate(d.getDate() - 30) }
  else if (period === 'month') { d.setDate(1) }
  else if (period === '3m') { d.setMonth(d.getMonth() - 3) }
  else return '1900-01-01'
  return d.toISOString().slice(0, 10)
}

const CATEGORY_COLORS: Record<string, string> = {
  Groceries: '#C8DDD0', Dining: '#F7DEC4', Utility: '#C4DCF0',
  Shopping: '#D5CEED', Subscriptions: '#C4E8D5', Health: '#F0EBE0',
  Gifting: '#F0CECE', Transport: '#FFF3C4', Commute: '#E8D5F0',
}

export default function Transactions() {
  const [txns, setTxns] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<DropdownItem[]>([])
  const [modes, setModes] = useState<DropdownItem[]>([])
  const [platforms, setPlatforms] = useState<DropdownItem[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('month')
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '', category_id: '', mode_id: '', platform_id: '',
    spending_type: 'necessary', notes: ''
  })

  async function load() {
    const [t, c, m, p] = await Promise.all([
      supabase.from('transactions').select('*, categories(name), payment_modes(name), platforms(name)').gte('date', getPeriodStart(period)).order('date', { ascending: false }),
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('payment_modes').select('id, name').order('name'),
      supabase.from('platforms').select('id, name').order('name'),
    ])
    setTxns(t.data ?? [])
    setCategories(c.data ?? [])
    setModes(m.data ?? [])
    setPlatforms(p.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [period])

  async function save() {
    if (!form.amount || !form.date) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const payload = { ...form, amount: Number(form.amount), category_id: form.category_id || null, mode_id: form.mode_id || null, platform_id: form.platform_id || null }
    if (editId) await supabase.from('transactions').update(payload).eq('id', editId)
    else await supabase.from('transactions').insert({ ...payload, user_id: user.id })
    setShowForm(false); setEditId(null)
    setForm({ date: new Date().toISOString().slice(0, 10), amount: '', category_id: '', mode_id: '', platform_id: '', spending_type: 'necessary', notes: '' })
    load()
  }

  async function remove(id: string) {
    await supabase.from('transactions').delete().eq('id', id)
    load()
  }

  function openEdit(t: Transaction) {
    setEditId(t.id)
    setForm({ date: t.date.slice(0, 10), amount: String(t.amount), category_id: '', mode_id: '', platform_id: '', spending_type: t.spending_type, notes: t.notes })
    setShowForm(true)
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir(field === 'amount' ? 'desc' : 'asc') }
  }

  const filtered = txns
    .filter(t => {
      if (filterCat !== 'all' && t.categories?.name !== filterCat) return false
      if (filterType !== 'all' && t.spending_type !== filterType) return false
      if (search) {
        const q = search.toLowerCase()
        if (!t.notes?.toLowerCase().includes(q) && !t.categories?.name?.toLowerCase().includes(q)) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sortField === 'date') {
        const diff = a.date.localeCompare(b.date)
        return sortDir === 'asc' ? diff : -diff
      }
      const diff = a.amount - b.amount
      return sortDir === 'asc' ? diff : -diff
    })

  const total = filtered.reduce((s, t) => s + t.amount, 0)

  const PERIODS: { key: Period; label: string }[] = [
    { key: '7d', label: '7 Days' }, { key: '30d', label: '30 Days' },
    { key: 'month', label: 'This Month' }, { key: '3m', label: '3 Months' }, { key: 'all', label: 'All Time' }
  ]

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Transaction Ledger</h1>
          <p className="text-gray-400 text-sm mt-1">Every rupee, tracked.</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditId(null) }}
          className="flex items-center gap-2 bg-[#7FA68A] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#6d9478] transition-all">
          <Plus size={15} /> Add
        </button>
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

      {/* Filters */}
      <div className="flex gap-3 mb-3 flex-wrap">
        <div className="flex-1 min-w-48 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm outline-none focus:border-[#7FA68A]"
            placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none bg-white text-gray-600"
          value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="all">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <select className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none bg-white text-gray-600"
          value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">All Types</option>
          <option value="necessary">Necessary</option>
          <option value="unnecessary">Unnecessary</option>
        </select>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-4 mb-4">
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">Sort:</span>
        {(['date', 'amount'] as SortField[]).map(field => (
          <button key={field} onClick={() => toggleSort(field)}
            className={`flex items-center gap-1 text-xs transition-all ${sortField === field ? 'text-[#7FA68A] font-semibold' : 'text-gray-400 hover:text-[#7FA68A]'}`}>
            <ArrowUpDown size={10} className={sortField === field ? 'opacity-100' : 'opacity-40'} />
            {field.charAt(0).toUpperCase() + field.slice(1)}
            {sortField === field && <span className="opacity-60">{sortDir === 'asc' ? '↑' : '↓'}</span>}
          </button>
        ))}
      </div>

      <div className="flex justify-between items-center mb-3 text-sm text-gray-400">
        <span>{filtered.length} transactions</span>
        <span>Total: <strong className="text-gray-700">{fmt(total)}</strong></span>
      </div>

      {/* Transaction list */}
      <div className="flex flex-col gap-2">
        {loading ? <p className="text-gray-400 text-sm">Loading...</p> : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">No transactions found.</div>
        ) : filtered.map(t => (
          <div key={t.id} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm hover:shadow-md transition-all">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLORS[t.categories?.name ?? ''] ?? '#E5E7EB' }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-800 text-sm">{t.categories?.name ?? '—'}</span>
                <span className="text-xs text-gray-400 ml-auto">{(([y,m,d]) => `${d}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m,10)-1]}-${y}`)(t.date.slice(0,10).split('-'))}</span>
              </div>
              {t.notes && <p className="text-xs text-gray-400 truncate">{t.notes}</p>}
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {t.payment_modes?.name && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t.payment_modes.name}</span>}
                {t.platforms?.name && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t.platforms.name}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.spending_type === 'necessary' ? 'bg-[#C8DDD0] text-[#7FA68A]' : 'bg-[#F0CECE] text-red-400'}`}>
                  {t.spending_type === 'necessary' ? 'Necessary' : 'Discretionary'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="font-light text-gray-800 text-base" style={{ fontFamily: 'Georgia,serif' }}>{fmt(t.amount)}</span>
              <button onClick={() => openEdit(t)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg"><Edit2 size={13} /></button>
              <button onClick={() => remove(t.id)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-4" style={{ fontFamily: 'Georgia,serif' }}>{editId ? 'Edit Transaction' : 'Add Transaction'}</h2>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <input type="date" className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                  value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                <input type="number" placeholder="Amount (₹)" className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                  value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white"
                  value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                  <option value="">Category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white"
                  value={form.mode_id} onChange={e => setForm(f => ({ ...f, mode_id: e.target.value }))}>
                  <option value="">Mode</option>
                  {modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white"
                  value={form.platform_id} onChange={e => setForm(f => ({ ...f, platform_id: e.target.value }))}>
                  <option value="">Platform</option>
                  {platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white"
                  value={form.spending_type} onChange={e => setForm(f => ({ ...f, spending_type: e.target.value }))}>
                  <option value="necessary">Necessary</option>
                  <option value="unnecessary">Unnecessary</option>
                </select>
              </div>
              <input placeholder="Notes" className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setShowForm(false); setEditId(null) }} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={save} className="flex-1 bg-[#7FA68A] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-[#6d9478]">{editId ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
