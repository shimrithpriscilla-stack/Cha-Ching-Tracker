import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Search, Edit2, Trash2, ArrowUpDown, CheckSquare, Square } from 'lucide-react'

interface Transaction {
  id: string
  date: string
  amount: number
  spending_type: string
  notes: string
  merchant: string
  categories?: { name: string }
  payment_modes?: { name: string }
  platforms?: { name: string }
  source_accounts?: { id: string; label: string; color: string | null; account_type: string } | null
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
  const [sourceAccounts, setSourceAccounts] = useState<{ id: string; label: string; color: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('month')
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterAccount, setFilterAccount] = useState('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '', category_id: '', mode_id: '', platform_id: '',
    spending_type: 'necessary', notes: '', merchant: ''
  })
  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  // Bulk edit
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkEditSaving, setBulkEditSaving] = useState(false)
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkSpendingType, setBulkSpendingType] = useState('')

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    const [c, m, p, sa] = await Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('payment_modes').select('id, name').order('name'),
      supabase.from('platforms').select('id, name').order('name'),
      user ? supabase.from('source_accounts').select('id, label, color').eq('user_id', user.id).order('label') : Promise.resolve({ data: [] }),
    ])

    // Try with source_accounts join; fall back gracefully if column doesn't exist yet
    let txnData: Transaction[] = []
    const withJoin = await supabase
      .from('transactions')
      .select('*, categories(name), payment_modes(name), platforms(name), source_accounts(id, label, color, account_type)')
      .gte('date', getPeriodStart(period))
      .order('date', { ascending: false })
    if (!withJoin.error) {
      txnData = withJoin.data ?? []
    } else {
      // Column likely not added yet — fetch without the join so existing data stays visible
      const withoutJoin = await supabase
        .from('transactions')
        .select('*, categories(name), payment_modes(name), platforms(name)')
        .gte('date', getPeriodStart(period))
        .order('date', { ascending: false })
      txnData = withoutJoin.data ?? []
    }

    setTxns(txnData)
    setCategories(c.data ?? [])
    setModes(m.data ?? [])
    setPlatforms(p.data ?? [])
    setSourceAccounts((sa as any).data ?? [])
    setSelectedIds(new Set())
    setLoading(false)
  }

  useEffect(() => { load() }, [period])

  async function save() {
    if (!form.amount || !form.date) return
    const payload = {
      ...form,
      amount: Number(form.amount),
      category_id: form.category_id || null,
      mode_id: form.mode_id || null,
      platform_id: form.platform_id || null,
      merchant: form.merchant.trim() || null,
    }
    if (editId) await supabase.from('transactions').update(payload).eq('id', editId)
    else await supabase.from('transactions').insert(payload)
    setShowForm(false); setEditId(null)
    setForm({ date: new Date().toISOString().slice(0, 10), amount: '', category_id: '', mode_id: '', platform_id: '', spending_type: 'necessary', notes: '', merchant: '' })
    load()
  }

  async function remove(id: string) {
    await supabase.from('transactions').delete().eq('id', id)
    load()
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    const ids = [...selectedIds]
    await supabase.from('transactions').delete().in('id', ids)
    setBulkDeleting(false)
    setBulkDeleteConfirm(false)
    load()
  }

  async function bulkEdit() {
    if (selectedIds.size === 0) return
    setBulkEditSaving(true)
    const ids = [...selectedIds]
    const updates: Record<string, string> = {}
    if (bulkCategoryId) updates.category_id = bulkCategoryId
    if (bulkSpendingType) updates.spending_type = bulkSpendingType
    if (Object.keys(updates).length > 0) {
      await supabase.from('transactions').update(updates).in('id', ids)
    }
    setBulkEditSaving(false)
    setBulkEditOpen(false)
    setBulkCategoryId('')
    setBulkSpendingType('')
    load()
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll(ids: string[]) {
    if (ids.every(id => selectedIds.has(id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(ids))
    }
  }

  function openEdit(t: Transaction) {
    setEditId(t.id)
    setForm({ date: t.date.slice(0, 10), amount: String(t.amount), category_id: '', mode_id: '', platform_id: '', spending_type: t.spending_type, notes: t.notes ?? '', merchant: t.merchant ?? '' })
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
      if (filterAccount !== 'all' && t.source_accounts?.id !== filterAccount) return false
      if (search) {
        const q = search.toLowerCase()
        const inMerchant = (t.merchant ?? '').toLowerCase().includes(q)
        const inNotes = (t.notes ?? '').toLowerCase().includes(q)
        const inCategory = (t.categories?.name ?? '').toLowerCase().includes(q)
        if (!inMerchant && !inNotes && !inCategory) return false
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
  const filteredIds = filtered.map(t => t.id)
  const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id))

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
            placeholder="Search merchant, notes, category…" value={search} onChange={e => setSearch(e.target.value)} />
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
          <option value="credit">Credit</option>
        </select>
        {sourceAccounts.length > 0 && (
          <select className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none bg-white text-gray-600"
            value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
            <option value="all">All Accounts</option>
            {sourceAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        )}
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-4 mb-3">
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

      {/* Count + total + select-all bar */}
      <div className="flex justify-between items-center mb-3 text-sm text-gray-400">
        <div className="flex items-center gap-3">
          <span>{filtered.length} transactions</span>
          {filtered.length > 0 && (
            <button
              onClick={() => toggleSelectAll(filteredIds)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#7FA68A] transition-all"
            >
              {allSelected
                ? <CheckSquare size={13} className="text-[#7FA68A]" />
                : <Square size={13} />}
              {allSelected ? `Deselect all ${filtered.length}` : `Select all ${filtered.length}`}
            </button>
          )}
        </div>
        <span>Total: <strong className="text-gray-700">{fmt(total)}</strong></span>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <span className="text-sm text-red-500 font-medium flex-1">{selectedIds.size} selected</span>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
          <button
            onClick={() => { setBulkCategoryId(''); setBulkSpendingType(''); setBulkEditOpen(true) }}
            className="flex items-center gap-1.5 bg-[#7FA68A] text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-[#6d9478] transition-all"
          >
            <Edit2 size={12} /> Edit {selectedIds.size}
          </button>
          <button
            onClick={() => setBulkDeleteConfirm(true)}
            className="flex items-center gap-1.5 bg-red-400 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-500 transition-all"
          >
            <Trash2 size={12} /> Delete {selectedIds.size}
          </button>
        </div>
      )}

      {/* Transaction list */}
      <div className="flex flex-col gap-2">
        {loading ? <p className="text-gray-400 text-sm">Loading...</p> : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">No transactions found.</div>
        ) : filtered.map(t => {
          const isSelected = selectedIds.has(t.id)
          const displayName = t.merchant?.trim() || t.categories?.name || '—'
          const subLine = t.merchant?.trim() && t.categories?.name
            ? t.categories.name
            : null
          // Strip UTR from displayed notes so user only sees their own note
          const displayNotes = (t.notes ?? '').replace(/UTR:[^\s|]+\s*\|?\s*/g, '').trim().replace(/^\||\|$/g, '').trim()

          return (
            <div key={t.id}
              className={`bg-white border rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm hover:shadow-md transition-all cursor-pointer
                ${isSelected ? 'border-[#7FA68A] bg-[#F2F8F4]' : 'border-gray-100'}`}
              onClick={() => toggleSelect(t.id)}
            >
              {/* Checkbox */}
              <div className="flex-shrink-0" onClick={e => { e.stopPropagation(); toggleSelect(t.id) }}>
                {isSelected
                  ? <CheckSquare size={16} className="text-[#7FA68A]" />
                  : <Square size={16} className="text-gray-300" />}
              </div>

              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLORS[t.categories?.name ?? ''] ?? '#E5E7EB' }} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-800 text-sm truncate">{displayName}</span>
                  <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                    {new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {subLine && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{subLine}</span>
                  )}
                  {displayNotes && <p className="text-xs text-gray-400 truncate">{displayNotes}</p>}
                </div>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    t.spending_type === 'necessary' ? 'bg-[#C8DDD0] text-[#7FA68A]'
                    : t.spending_type === 'credit' ? 'bg-[#C4E8D5] text-green-600'
                    : 'bg-[#F0CECE] text-red-400'
                  }`}>
                    {t.spending_type === 'necessary' ? 'Necessary' : t.spending_type === 'credit' ? 'Credit' : 'Discretionary'}
                  </span>
                  {t.source_accounts && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium text-gray-600"
                      style={{ background: t.source_accounts.color ?? '#E5E7EB' }}>
                      {t.source_accounts.label}
                    </span>
                  )}
                  {t.payment_modes?.name && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t.payment_modes.name}</span>}
                  {t.platforms?.name && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t.platforms.name}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <span className={`font-light text-base ${t.spending_type === 'credit' ? 'text-green-600' : 'text-gray-800'}`} style={{ fontFamily: 'Georgia,serif' }}>
                  {t.spending_type === 'credit' ? '+' : ''}{fmt(Math.abs(t.amount))}
                </span>
                <button onClick={() => openEdit(t)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg"><Edit2 size={13} /></button>
                <button onClick={() => remove(t.id)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bulk edit modal */}
      {bulkEditOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-1" style={{ fontFamily: 'Georgia,serif' }}>Edit {selectedIds.size} transactions</h2>
            <p className="text-xs text-gray-400 mb-5">Only filled fields will be updated. Leave blank to keep existing values.</p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Category</label>
                <select className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white focus:border-[#7FA68A]"
                  value={bulkCategoryId} onChange={e => setBulkCategoryId(e.target.value)}>
                  <option value="">— keep existing —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Spending Type</label>
                <select className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white focus:border-[#7FA68A]"
                  value={bulkSpendingType} onChange={e => setBulkSpendingType(e.target.value)}>
                  <option value="">— keep existing —</option>
                  <option value="necessary">Necessary</option>
                  <option value="unnecessary">Unnecessary</option>
                  <option value="credit">Credit / Reimbursement</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setBulkEditOpen(false)} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={bulkEdit} disabled={bulkEditSaving || (!bulkCategoryId && !bulkSpendingType)}
                className="flex-1 bg-[#7FA68A] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-[#6d9478] disabled:opacity-40 transition-all">
                {bulkEditSaving ? 'Saving…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirmation modal */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-2" style={{ fontFamily: 'Georgia,serif' }}>Delete {selectedIds.size} transactions?</h2>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setBulkDeleteConfirm(false)} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500">Cancel</button>
              <button onClick={bulkDelete} disabled={bulkDeleting}
                className="flex-1 bg-red-400 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                {bulkDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
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
              <input placeholder="Merchant / Paid to" className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                value={form.merchant} onChange={e => setForm(f => ({ ...f, merchant: e.target.value }))} />
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
                  <option value="credit">Credit / Reimbursement</option>
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
