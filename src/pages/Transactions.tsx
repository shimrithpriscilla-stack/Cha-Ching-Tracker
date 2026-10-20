import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { Plus, Search, Edit2, Trash2, ArrowUpDown, CheckSquare, Square, Download, ChevronDown, X, Filter, Tag } from 'lucide-react'

interface TagItem {
  id: string
  name: string
  color: string
}

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
  transaction_tags?: { tags: TagItem }[]
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

const BLANK = '__blank__'

type ColKey = 'category' | 'spending_type' | 'account' | 'app_source' | 'mode' | 'tag'

function getColValue(colKey: ColKey, t: Transaction): string {
  if (colKey === 'category') return t.categories?.name ?? ''
  if (colKey === 'spending_type') return t.spending_type ?? ''
  if (colKey === 'account') return t.source_accounts?.label ?? ''
  if (colKey === 'app_source') {
    const m = (t.notes ?? '').match(/APP:([^\s|]+)/)
    return m?.[1] ?? ''
  }
  if (colKey === 'mode') return t.payment_modes?.name ?? ''
  if (colKey === 'tag') {
    const tags = (t.transaction_tags ?? []).map(tt => tt.tags?.name).filter(Boolean)
    return tags.join(',')
  }
  return ''
}

const COL_LABELS: Record<ColKey, string> = {
  category: 'Category',
  spending_type: 'Type',
  account: 'Account',
  app_source: 'App',
  mode: 'Mode',
  tag: 'Tag',
}

const SPENDING_TYPE_LABELS: Record<string, string> = {
  necessary: 'Necessary',
  unnecessary: 'Discretionary',
  credit: 'Credit',
}

export default function Transactions() {
  const [txns, setTxns] = useState<Transaction[]>([])
  const [allTags, setAllTags] = useState<TagItem[]>([])
  const [categories, setCategories] = useState<DropdownItem[]>([])
  const [modes, setModes] = useState<DropdownItem[]>([])
  const [platforms, setPlatforms] = useState<DropdownItem[]>([])
  const [sourceAccounts, setSourceAccounts] = useState<{ id: string; label: string; color: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('month')
  const [search, setSearch] = useState('')

  const [columnFilters, setColumnFilters] = useState<Map<ColKey, Set<string>>>(new Map())
  const [openFilterCol, setOpenFilterCol] = useState<ColKey | null>(null)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [amtMin, setAmtMin] = useState('')
  const [amtMax, setAmtMax] = useState('')
  const [showMoreFilters, setShowMoreFilters] = useState(false)

  const [form_source_account_id, setFormSourceAccountId] = useState('')
  const [form_app_source, setFormAppSource] = useState('')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '', category_id: '', mode_id: '', platform_id: '',
    spending_type: 'necessary', notes: '', merchant: ''
  })

  // Tags for the add/edit form
  const [formTagIds, setFormTagIds] = useState<Set<string>>(new Set())
  const [showTagPicker, setShowTagPicker] = useState(false)
  const tagPickerRef = useRef<HTMLDivElement>(null)

  // Inline tag editor per row
  const [inlineTagTxnId, setInlineTagTxnId] = useState<string | null>(null)
  const [inlineTagIds, setInlineTagIds] = useState<Set<string>>(new Set())
  const [inlineTagSaving, setInlineTagSaving] = useState(false)
  const inlineTagRef = useRef<HTMLDivElement>(null)

  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Bulk edit
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkEditSaving, setBulkEditSaving] = useState(false)
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkSpendingType, setBulkSpendingType] = useState('')
  const [bulkAccountId, setBulkAccountId] = useState('')
  const [bulkTagIds, setBulkTagIds] = useState<Set<string>>(new Set())
  const [bulkTagMode, setBulkTagMode] = useState<'add' | 'replace' | 'remove'>('add')

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    const [c, m, p, sa, tagsRes] = await Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('payment_modes').select('id, name').order('name'),
      supabase.from('platforms').select('id, name').order('name'),
      user ? supabase.from('source_accounts').select('id, label, color').eq('user_id', user.id).order('label') : Promise.resolve({ data: [] }),
      user ? supabase.from('tags').select('id, name, color').eq('user_id', user.id).order('name') : Promise.resolve({ data: [] }),
    ])

    let txnData: Transaction[] = []
    const withJoin = await supabase
      .from('transactions')
      .select('*, categories(name), payment_modes(name), platforms(name), source_accounts(id, label, color, account_type), transaction_tags(tags(id, name, color))')
      .gte('date', getPeriodStart(period))
      .order('date', { ascending: false })
    if (!withJoin.error) {
      txnData = withJoin.data ?? []
    } else {
      const withoutJoin = await supabase
        .from('transactions')
        .select('*, categories(name), payment_modes(name), platforms(name)')
        .gte('date', getPeriodStart(period))
        .order('date', { ascending: false })
      txnData = withoutJoin.data ?? []
    }

    setTxns(txnData)
    setAllTags((tagsRes as any).data ?? [])
    setCategories(c.data ?? [])
    setModes(m.data ?? [])
    setPlatforms(p.data ?? [])
    setSourceAccounts((sa as any).data ?? [])
    setSelectedIds(new Set())
    setLoading(false)
  }

  useEffect(() => { load() }, [period])

  // Close inline tag picker on outside click
  useEffect(() => {
    if (!inlineTagTxnId) return
    function handleClick(e: MouseEvent) {
      if (inlineTagRef.current && !inlineTagRef.current.contains(e.target as Node)) {
        setInlineTagTxnId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [inlineTagTxnId])

  // Close form tag picker on outside click
  useEffect(() => {
    if (!showTagPicker) return
    function handleClick(e: MouseEvent) {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setShowTagPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showTagPicker])

  // --- Column filter helpers ---
  function colUniqueValues(colKey: ColKey): string[] {
    if (colKey === 'tag') {
      const seen = new Set<string>()
      let hasBlank = false
      for (const t of txns) {
        const tags = (t.transaction_tags ?? []).map(tt => tt.tags?.name).filter(Boolean)
        if (tags.length === 0) hasBlank = true
        else tags.forEach(tag => seen.add(tag!))
      }
      const sorted = [...seen].sort()
      if (hasBlank) sorted.push(BLANK)
      return sorted
    }
    const seen = new Set<string>()
    let hasBlank = false
    for (const t of txns) {
      const v = getColValue(colKey, t)
      if (v === '') hasBlank = true
      else seen.add(v)
    }
    const sorted = [...seen].sort()
    if (hasBlank) sorted.push(BLANK)
    return sorted
  }

  function toggleColFilter(colKey: ColKey, value: string) {
    setColumnFilters(prev => {
      const next = new Map(prev)
      const cur = new Set(next.get(colKey) ?? [])
      if (cur.has(value)) cur.delete(value); else cur.add(value)
      if (cur.size === 0) next.delete(colKey); else next.set(colKey, cur)
      return next
    })
  }

  function setColFilter(colKey: ColKey, values: Set<string>) {
    setColumnFilters(prev => {
      const next = new Map(prev)
      if (values.size === 0) next.delete(colKey); else next.set(colKey, values)
      return next
    })
  }

  function clearAllFilters() {
    setColumnFilters(new Map())
    setDateFrom(''); setDateTo(''); setAmtMin(''); setAmtMax('')
    setSearch('')
  }

  // --- Filtered rows ---
  const filtered = txns
    .filter(t => {
      for (const [colKey, allowed] of columnFilters) {
        if (allowed.size === 0) continue
        if (colKey === 'tag') {
          const txnTags = (t.transaction_tags ?? []).map(tt => tt.tags?.name).filter(Boolean) as string[]
          const hasBlankFilter = allowed.has(BLANK)
          if (txnTags.length === 0) {
            if (!hasBlankFilter) return false
          } else {
            const hasMatch = txnTags.some(tag => allowed.has(tag))
            if (!hasMatch && !(hasBlankFilter && txnTags.length === 0)) return false
          }
        } else {
          const v = getColValue(colKey, t)
          const matches = v === '' ? allowed.has(BLANK) : allowed.has(v)
          if (!matches) return false
        }
      }
      if (dateFrom && t.date < dateFrom) return false
      if (dateTo && t.date > dateTo) return false
      const absAmt = Math.abs(t.amount)
      if (amtMin && absAmt < parseFloat(amtMin)) return false
      if (amtMax && absAmt > parseFloat(amtMax)) return false
      if (search) {
        const q = search.toLowerCase()
        const txnTagNames = (t.transaction_tags ?? []).map(tt => tt.tags?.name ?? '').join(' ')
        if (
          !(t.merchant ?? '').toLowerCase().includes(q) &&
          !(t.notes ?? '').toLowerCase().includes(q) &&
          !(t.categories?.name ?? '').toLowerCase().includes(q) &&
          !txnTagNames.toLowerCase().includes(q)
        ) return false
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
  const hasActiveFilters = columnFilters.size > 0 || dateFrom || dateTo || amtMin || amtMax

  // --- ColumnFilterBtn component ---
  function ColumnFilterBtn({ colKey, displayLabel }: { colKey: ColKey; displayLabel?: (v: string) => string }) {
    const isOpen = openFilterCol === colKey
    const activeFilter = columnFilters.get(colKey)
    const isFiltered = (activeFilter?.size ?? 0) > 0
    const dropdownRef = useRef<HTMLDivElement>(null)
    const allVals = colUniqueValues(colKey)

    useEffect(() => {
      if (!isOpen) return
      function handleClick(e: MouseEvent) {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
          setOpenFilterCol(null)
        }
      }
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }, [isOpen])

    const label = (v: string) => {
      if (v === BLANK) return '(Blanks)'
      return displayLabel ? displayLabel(v) : v
    }

    const allChecked = allVals.every(v => activeFilter?.has(v))
    const someChecked = !allChecked && allVals.some(v => activeFilter?.has(v))

    function toggleAll() {
      if (allChecked || someChecked) {
        setColFilter(colKey, new Set())
      } else {
        setColFilter(colKey, new Set(allVals))
      }
    }

    return (
      <div className="relative inline-block" ref={dropdownRef}>
        <button
          onClick={e => { e.stopPropagation(); setOpenFilterCol(isOpen ? null : colKey) }}
          className={`p-0.5 rounded transition-colors ${isFiltered ? 'text-[#7FA68A]' : 'text-gray-300 hover:text-gray-500'}`}
          title={`Filter ${COL_LABELS[colKey]}`}
        >
          <Filter size={11} fill={isFiltered ? '#7FA68A' : 'none'} />
        </button>
        {isOpen && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg min-w-44 py-1.5">
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer border-b border-gray-100 mb-1">
              <input
                type="checkbox"
                checked={allChecked}
                ref={el => { if (el) el.indeterminate = someChecked }}
                onChange={toggleAll}
                className="rounded accent-[#7FA68A]"
              />
              <span className="text-xs text-gray-500 font-medium">Select All</span>
            </label>
            <div className="max-h-48 overflow-y-auto">
              {allVals.map(v => (
                <label key={v} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeFilter?.has(v) ?? false}
                    onChange={() => toggleColFilter(colKey, v)}
                    className="rounded accent-[#7FA68A]"
                  />
                  <span className={`text-xs ${v === BLANK ? 'text-gray-400 italic' : 'text-gray-700'}`}>{label(v)}</span>
                </label>
              ))}
            </div>
            {allVals.includes(BLANK) && (
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={() => { setColFilter(colKey, new Set([BLANK])); setOpenFilterCol(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                >
                  Blanks only →
                </button>
              </div>
            )}
            {isFiltered && (
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={() => { setColFilter(colKey, new Set()); setOpenFilterCol(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-50"
                >
                  Clear filter
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  async function save() {
    if (!form.amount || !form.date) return
    const baseNotes = form.notes
      .replace(/APP:[^\s|]+\s*\|?\s*/g, '')
      .replace(/UTR:[^\s|]+\s*\|?\s*/g, '')
      .trim().replace(/^\||\|$/g, '').trim()
    const appTag = form_app_source ? `APP:${form_app_source}` : ''
    const existingTxn = txns.find(t => t.id === editId)
    const utrMatch = existingTxn ? (existingTxn.notes ?? '').match(/UTR:[^\s|]+/) : null
    const utrTag = utrMatch ? utrMatch[0] : ''
    const rebuiltNotes = [baseNotes, appTag, utrTag].filter(Boolean).join(' | ')
    const isCredit = form.spending_type === 'credit'
    const payload = {
      ...form,
      amount: isCredit ? -Math.abs(Number(form.amount)) : Math.abs(Number(form.amount)),
      category_id: form.category_id || null,
      mode_id: form.mode_id || null,
      platform_id: form.platform_id || null,
      merchant: form.merchant.trim() || null,
      notes: rebuiltNotes,
      source_account_id: form_source_account_id || null,
    }

    let savedId = editId
    if (editId) {
      await supabase.from('transactions').update(payload).eq('id', editId)
    } else {
      const { data } = await supabase.from('transactions').insert(payload).select('id').single()
      savedId = data?.id ?? null
    }

    // Save tags
    if (savedId) {
      await supabase.from('transaction_tags').delete().eq('transaction_id', savedId)
      if (formTagIds.size > 0) {
        const tagRows = [...formTagIds].map(tag_id => ({ transaction_id: savedId, tag_id }))
        await supabase.from('transaction_tags').insert(tagRows)
      }
    }

    setShowForm(false); setEditId(null)
    setFormSourceAccountId('')
    setFormAppSource('')
    setFormTagIds(new Set())
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
    const updates: Record<string, string | null> = {}
    if (bulkCategoryId) updates.category_id = bulkCategoryId
    if (bulkSpendingType) updates.spending_type = bulkSpendingType
    if (bulkAccountId !== '') updates.source_account_id = bulkAccountId || null
    if (Object.keys(updates).length > 0) {
      await supabase.from('transactions').update(updates).in('id', ids)
    }
    // Bulk tag operation
    if (bulkTagIds.size > 0) {
      if (bulkTagMode === 'replace') {
        await supabase.from('transaction_tags').delete().in('transaction_id', ids)
      } else if (bulkTagMode === 'remove') {
        await supabase.from('transaction_tags').delete().in('transaction_id', ids).in('tag_id', [...bulkTagIds])
      }
      if (bulkTagMode !== 'remove') {
        for (const txnId of ids) {
          const tagRows = [...bulkTagIds].map(tag_id => ({ transaction_id: txnId, tag_id }))
          await supabase.from('transaction_tags').upsert(tagRows, { onConflict: 'transaction_id,tag_id', ignoreDuplicates: true })
        }
      }
    }
    setBulkEditSaving(false)
    setBulkEditOpen(false)
    setBulkCategoryId('')
    setBulkSpendingType('')
    setBulkAccountId('')
    setBulkTagIds(new Set())
    load()
  }

  // Inline tag save
  async function saveInlineTags(txnId: string) {
    setInlineTagSaving(true)
    await supabase.from('transaction_tags').delete().eq('transaction_id', txnId)
    if (inlineTagIds.size > 0) {
      const tagRows = [...inlineTagIds].map(tag_id => ({ transaction_id: txnId, tag_id }))
      await supabase.from('transaction_tags').insert(tagRows)
    }
    setInlineTagSaving(false)
    setInlineTagTxnId(null)
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
    setForm({ date: t.date.slice(0, 10), amount: String(Math.abs(t.amount)), category_id: (t as any).category_id ?? '', mode_id: (t as any).mode_id ?? '', platform_id: (t as any).platform_id ?? '', spending_type: t.spending_type, notes: t.notes ?? '', merchant: t.merchant ?? '' })
    setFormSourceAccountId((t as any).source_account_id ?? (t.source_accounts?.id ?? ''))
    const appMatch = (t.notes ?? '').match(/APP:([^\s|]+)/)
    setFormAppSource(appMatch?.[1] ?? '')
    const existingTagIds = new Set((t.transaction_tags ?? []).map(tt => tt.tags?.id).filter(Boolean) as string[])
    setFormTagIds(existingTagIds)
    setShowForm(true)
  }

  function openInlineTag(t: Transaction) {
    const existingTagIds = new Set((t.transaction_tags ?? []).map(tt => tt.tags?.id).filter(Boolean) as string[])
    setInlineTagIds(existingTagIds)
    setInlineTagTxnId(t.id)
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir(field === 'amount' ? 'desc' : 'asc') }
  }

  function exportCSV() {
    const header = 'Date,Merchant,Amount,Spending Type,Category,Mode,Platform,Account,Tags,Notes'
    const rows = filtered.map(t => {
      const displayNotes = (t.notes ?? '').replace(/APP:[^\s|]+\s*\|?\s*/g, '').replace(/UTR:[^\s|]+\s*\|?\s*/g, '').trim().replace(/^\||\|$/g, '').trim()
      const tags = (t.transaction_tags ?? []).map(tt => tt.tags?.name).filter(Boolean).join('; ')
      const esc = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`
      return [
        t.date, esc(t.merchant ?? ''), t.amount,
        esc(t.spending_type), esc(t.categories?.name ?? ''),
        esc(t.payment_modes?.name ?? ''), esc(t.platforms?.name ?? ''),
        esc(t.source_accounts?.label ?? ''), esc(tags), esc(displayNotes)
      ].join(',')
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const PERIODS: { key: Period; label: string }[] = [
    { key: '7d', label: '7 Days' }, { key: '30d', label: '30 Days' },
    { key: 'month', label: 'This Month' }, { key: '3m', label: '3 Months' }, { key: 'all', label: 'All Time' }
  ]

  function filterDisplayVal(colKey: ColKey, v: string) {
    if (v === BLANK) return '(Blanks)'
    if (colKey === 'spending_type') return SPENDING_TYPE_LABELS[v] ?? v
    return v
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Transaction Ledger</h1>
          <p className="text-gray-400 text-sm mt-1">Every rupee, tracked.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} title="Export current view as CSV"
            className="flex items-center gap-1.5 border border-gray-200 text-gray-500 px-3 py-2 rounded-xl text-sm hover:bg-gray-50 transition-all">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => { setShowForm(true); setEditId(null); setFormTagIds(new Set()) }}
            className="flex items-center gap-2 bg-[#7FA68A] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#6d9478] transition-all">
            <Plus size={15} /> Add
          </button>
        </div>
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

      {/* Search + date/amount range */}
      <div className="flex flex-col gap-2 mb-3">
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex-1 min-w-48 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm outline-none focus:border-[#7FA68A]"
              placeholder="Search merchant, notes, category, tags…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button
            onClick={() => setShowMoreFilters(v => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border transition-all ${showMoreFilters ? 'border-[#7FA68A] text-[#7FA68A] bg-[#F2F8F4]' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            <ChevronDown size={13} className={`transition-transform ${showMoreFilters ? 'rotate-180' : ''}`} />
            Date / Amount
            {(dateFrom || dateTo || amtMin || amtMax) && (
              <span className="w-4 h-4 rounded-full bg-[#7FA68A] text-white text-[9px] flex items-center justify-center">
                {[!!(dateFrom || dateTo), !!(amtMin || amtMax)].filter(Boolean).length}
              </span>
            )}
          </button>
          {hasActiveFilters && (
            <button onClick={clearAllFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-all">
              <X size={11} /> Clear all
            </button>
          )}
        </div>

        {showMoreFilters && (
          <div className="flex gap-3 flex-wrap items-center bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">Date</span>
              <input type="date" className="border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none bg-white"
                value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-gray-300">→</span>
              <input type="date" className="border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none bg-white"
                value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">Amount</span>
              <input type="number" placeholder="Min" min="0"
                className="border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none bg-white w-20"
                value={amtMin} onChange={e => setAmtMin(e.target.value)} />
              <span className="text-gray-300">–</span>
              <input type="number" placeholder="Max" min="0"
                className="border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none bg-white w-20"
                value={amtMax} onChange={e => setAmtMax(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* Active column filter pills */}
      {columnFilters.size > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 items-center bg-[#F5F2EC] rounded-2xl px-4 py-2.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wide mr-1">Filters:</span>
          {[...columnFilters.entries()].map(([colKey, vals]) => (
            <div key={colKey} className="flex items-center gap-1 bg-white border border-[#C8DDD0] rounded-full px-2.5 py-0.5 text-xs text-gray-700">
              <span className="text-gray-400">{COL_LABELS[colKey]}:</span>
              <span className="text-[#7FA68A] font-medium">
                {[...vals].map(v => filterDisplayVal(colKey, v)).join(', ')}
              </span>
              <button
                onClick={() => setColFilter(colKey, new Set())}
                className="ml-1 text-gray-300 hover:text-gray-500 leading-none"
              >✕</button>
            </div>
          ))}
          <button
            onClick={() => setColumnFilters(new Map())}
            className="text-xs text-gray-400 hover:text-gray-600 ml-auto"
          >Clear column filters</button>
        </div>
      )}

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
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{filtered.length} transaction{filtered.length !== 1 ? 's' : ''}</span>
          {filtered.length > 0 && (
            <button
              onClick={() => toggleSelectAll(filteredIds)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
                allSelected
                  ? 'bg-[#F2F8F4] border-[#7FA68A] text-[#7FA68A] font-medium'
                  : 'border-gray-200 text-gray-400 hover:border-[#7FA68A] hover:text-[#7FA68A]'
              }`}
            >
              {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
              {allSelected ? 'Deselect all' : `Select all ${filtered.length}`}
            </button>
          )}
        </div>
        <span className="text-sm text-gray-400">Total: <strong className="text-gray-700">{fmt(total)}</strong></span>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <span className="text-sm text-red-500 font-medium flex-1">{selectedIds.size} selected</span>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
          <button
            onClick={() => { setBulkCategoryId(''); setBulkSpendingType(''); setBulkAccountId(''); setBulkTagIds(new Set()); setBulkTagMode('add'); setBulkEditOpen(true) }}
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
      <div className="flex flex-col gap-0 bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        {/* Column header row with filter buttons */}
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto] gap-0 px-4 py-2 border-b border-gray-100 bg-gray-50">
          <div className="w-6" />
          <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wide">Merchant</div>
          <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wide px-3">
            Category <ColumnFilterBtn colKey="category" />
          </div>
          <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wide px-3">
            Type <ColumnFilterBtn colKey="spending_type" displayLabel={v => SPENDING_TYPE_LABELS[v] ?? v} />
          </div>
          {sourceAccounts.length > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wide px-3">
              Account <ColumnFilterBtn colKey="account" />
            </div>
          )}
          <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wide px-3">
            App <ColumnFilterBtn colKey="app_source" />
          </div>
          <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wide px-3">
            Mode <ColumnFilterBtn colKey="mode" />
          </div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide text-right px-3">Amount</div>
        </div>

        {loading ? (
          <p className="text-gray-400 text-sm p-6">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">No transactions found.</div>
        ) : filtered.map((t, idx) => {
          const isSelected = selectedIds.has(t.id)
          const displayName = t.merchant?.trim() || t.categories?.name || '—'
          const appMatch = (t.notes ?? '').match(/APP:([^\s|]+)/)
          const appSource = appMatch?.[1] ?? null
          const displayNotes = (t.notes ?? '')
            .replace(/APP:[^\s|]+\s*\|?\s*/g, '')
            .replace(/UTR:[^\s|]+\s*\|?\s*/g, '')
            .trim().replace(/^\||\|$/g, '').trim()
          const txnTags = (t.transaction_tags ?? []).map(tt => tt.tags).filter(Boolean) as TagItem[]
          const isInlineTagOpen = inlineTagTxnId === t.id

          return (
            <div key={t.id}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-gray-50 last:border-0
                ${isSelected ? 'bg-[#F2F8F4]' : idx % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/50 hover:bg-gray-100/50'}`}
              onClick={() => toggleSelect(t.id)}
            >
              {/* Checkbox */}
              <div className="flex-shrink-0 w-6 flex items-center justify-center" onClick={e => { e.stopPropagation(); toggleSelect(t.id) }}>
                {isSelected
                  ? <CheckSquare size={16} className="text-[#7FA68A]" />
                  : <Square size={16} className="text-gray-300" />}
              </div>

              {/* Merchant + date + notes + tags */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLORS[t.categories?.name ?? ''] ?? '#E5E7EB' }} />
                  <span className="font-medium text-gray-800 text-sm truncate">{displayName}</span>
                  <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                    {new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                {displayNotes && <p className="text-xs text-gray-400 truncate mt-0.5 pl-4">{displayNotes}</p>}
                {/* Tags row */}
                <div className="flex items-center gap-1 mt-1 pl-4 flex-wrap" onClick={e => e.stopPropagation()}>
                  {txnTags.map(tag => (
                    <span key={tag.id} className="text-xs px-2 py-0.5 rounded-full text-gray-600 flex items-center gap-1"
                      style={{ background: tag.color ?? '#C8DDD0' }}>
                      <Tag size={9} />
                      {tag.name}
                    </span>
                  ))}
                  {/* Inline tag button */}
                  <div className="relative" ref={isInlineTagOpen ? inlineTagRef : undefined}>
                    <button
                      onClick={e => { e.stopPropagation(); openInlineTag(t) }}
                      className="text-xs text-gray-300 hover:text-[#7FA68A] flex items-center gap-0.5 transition-colors"
                      title="Add/edit tags"
                    >
                      <Tag size={10} />
                      {txnTags.length === 0 ? <span className="text-[10px]">tag</span> : null}
                    </button>
                    {isInlineTagOpen && allTags.length > 0 && (
                      <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg min-w-44 py-1.5">
                        <div className="px-3 py-1 text-[10px] text-gray-400 uppercase tracking-wide border-b border-gray-100 mb-1">
                          Tags
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {allTags.map(tag => (
                            <label key={tag.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={inlineTagIds.has(tag.id)}
                                onChange={() => {
                                  setInlineTagIds(prev => {
                                    const next = new Set(prev)
                                    if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id)
                                    return next
                                  })
                                }}
                                className="rounded accent-[#7FA68A]"
                              />
                              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: tag.color ?? '#C8DDD0' }} />
                              <span className="text-xs text-gray-700">{tag.name}</span>
                            </label>
                          ))}
                        </div>
                        <div className="border-t border-gray-100 mt-1 pt-1 px-2 flex gap-2">
                          <button
                            onClick={() => setInlineTagTxnId(null)}
                            className="flex-1 text-xs text-gray-400 py-1.5 rounded-lg hover:bg-gray-50"
                          >Cancel</button>
                          <button
                            onClick={() => saveInlineTags(t.id)}
                            disabled={inlineTagSaving}
                            className="flex-1 text-xs bg-[#7FA68A] text-white py-1.5 rounded-lg hover:bg-[#6d9478] disabled:opacity-40"
                          >{inlineTagSaving ? '…' : 'Save'}</button>
                        </div>
                      </div>
                    )}
                    {isInlineTagOpen && allTags.length === 0 && (
                      <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg min-w-44 p-3">
                        <p className="text-xs text-gray-400">No tags yet. Create them in the <strong>Tags</strong> page.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Category */}
              <div className="w-28 flex-shrink-0 px-3">
                {t.categories?.name
                  ? <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full truncate block text-center">{t.categories.name}</span>
                  : <span className="text-xs text-gray-300 italic">—</span>
                }
              </div>

              {/* Spending type */}
              <div className="w-24 flex-shrink-0 px-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium block text-center ${
                  t.spending_type === 'necessary' ? 'bg-[#C8DDD0] text-[#7FA68A]'
                  : t.spending_type === 'credit' ? 'bg-[#C4E8D5] text-green-600'
                  : 'bg-[#F0CECE] text-red-400'
                }`}>
                  {SPENDING_TYPE_LABELS[t.spending_type] ?? t.spending_type}
                </span>
              </div>

              {/* Account */}
              {sourceAccounts.length > 0 && (
                <div className="w-24 flex-shrink-0 px-3">
                  {t.source_accounts
                    ? <span className="text-xs px-2 py-0.5 rounded-full font-medium text-gray-600 block text-center truncate"
                        style={{ background: t.source_accounts.color ?? '#E5E7EB' }}>
                        {t.source_accounts.label}
                      </span>
                    : <span className="text-xs text-gray-300 italic text-center block">—</span>
                  }
                </div>
              )}

              {/* App source */}
              <div className="w-16 flex-shrink-0 px-3">
                {appSource
                  ? <span className="text-xs px-2 py-0.5 rounded-full text-gray-500 block text-center"
                      style={{ background: appSource === 'GPay' ? '#E8F0FE' : appSource === 'PhonePe' ? '#EDE7F6' : '#E3F2FD' }}>
                      {appSource}
                    </span>
                  : <span className="text-xs text-gray-300 italic text-center block">—</span>
                }
              </div>

              {/* Mode */}
              <div className="w-16 flex-shrink-0 px-3">
                {t.payment_modes?.name
                  ? <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full block text-center truncate">{t.payment_modes.name}</span>
                  : <span className="text-xs text-gray-300 italic text-center block">—</span>
                }
              </div>

              {/* Amount + actions */}
              <div className="flex items-center gap-2 flex-shrink-0 pl-3" onClick={e => e.stopPropagation()}>
                <span className={`font-light text-base w-20 text-right ${t.spending_type === 'credit' ? 'text-green-600' : 'text-gray-800'}`} style={{ fontFamily: 'Georgia,serif' }}>
                  {t.spending_type === 'credit' ? '+' : ''}{fmt(Math.abs(t.amount))}
                </span>
                <button onClick={() => openEdit(t)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><Edit2 size={13} /></button>
                <button onClick={() => remove(t.id)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bulk edit modal */}
      {bulkEditOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
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
                  <option value="unnecessary">Discretionary</option>
                  <option value="credit">Credit / Reimbursement</option>
                </select>
              </div>
              {sourceAccounts.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Account</label>
                  <select className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white focus:border-[#7FA68A]"
                    value={bulkAccountId} onChange={e => setBulkAccountId(e.target.value)}>
                    <option value="">— keep existing —</option>
                    <option value="__clear__">— clear account —</option>
                    {sourceAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </div>
              )}
              {allTags.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Tags</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {allTags.map(tag => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => setBulkTagIds(prev => {
                          const next = new Set(prev)
                          if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id)
                          return next
                        })}
                        className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 border transition-all ${bulkTagIds.has(tag.id) ? 'border-[#7FA68A] text-gray-700' : 'border-transparent text-gray-500'}`}
                        style={{ background: tag.color ?? '#C8DDD0' }}
                      >
                        {bulkTagIds.has(tag.id) && <span>✓</span>}
                        {tag.name}
                      </button>
                    ))}
                  </div>
                  {bulkTagIds.size > 0 && (
                    <div className="flex gap-2">
                      {(['add', 'replace', 'remove'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setBulkTagMode(mode)}
                          className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${bulkTagMode === mode ? 'bg-[#7FA68A] text-white border-[#7FA68A]' : 'border-gray-200 text-gray-500'}`}
                        >
                          {mode === 'add' ? '+ Add' : mode === 'replace' ? '↺ Replace all' : '− Remove'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setBulkEditOpen(false)} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={bulkEdit} disabled={bulkEditSaving || (!bulkCategoryId && !bulkSpendingType && bulkAccountId === '' && bulkTagIds.size === 0)}
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
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
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
                  <option value="unnecessary">Discretionary</option>
                  <option value="credit">Credit / Reimbursement</option>
                </select>
              </div>
              <input placeholder="Notes" className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                {sourceAccounts.length > 0 && (
                  <select className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white"
                    value={form_source_account_id} onChange={e => setFormSourceAccountId(e.target.value)}>
                    <option value="">Account (optional)</option>
                    {sourceAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                )}
                <select className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white"
                  value={form_app_source} onChange={e => setFormAppSource(e.target.value)}>
                  <option value="">App Source</option>
                  <option value="GPay">GPay</option>
                  <option value="PhonePe">PhonePe</option>
                  <option value="Paytm">Paytm</option>
                </select>
              </div>

              {/* Tags picker in form */}
              {allTags.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">Tags <span className="text-gray-300">(optional)</span></label>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map(tag => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => setFormTagIds(prev => {
                          const next = new Set(prev)
                          if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id)
                          return next
                        })}
                        className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 border transition-all ${formTagIds.has(tag.id) ? 'border-[#7FA68A] text-gray-700' : 'border-transparent text-gray-500 opacity-70'}`}
                        style={{ background: tag.color ?? '#C8DDD0' }}
                      >
                        {formTagIds.has(tag.id) && <span>✓</span>}
                        <Tag size={9} />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setShowForm(false); setEditId(null); setFormSourceAccountId(''); setFormAppSource(''); setFormTagIds(new Set()) }} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={save} className="flex-1 bg-[#7FA68A] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-[#6d9478]">{editId ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
