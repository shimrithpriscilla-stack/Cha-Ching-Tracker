import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Edit2, AlertTriangle, CheckCircle, XCircle, Plus, Trash2, ChevronLeft, ChevronRight, CreditCard, Building2, Wallet, X, Check, Tag } from 'lucide-react'

interface Category {
  id: string
  name: string
  monthly_budget: number
  color_tag: string
  spent?: number
  grossSpent?: number
  credited?: number
}

interface SourceAccount {
  id: string
  label: string
  bank_name: string
  last4: string | null
  account_type: 'savings' | 'credit' | 'wallet'
  color: string | null
  monthly_budget?: number | null
  credit_limit?: number | null
  spent?: number
}

interface TagBudgetItem {
  id: string
  name: string
  color: string
  budget: number | null
  spent: number
  txn_count: number
  date_range: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function currentYM(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function ymLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  savings: <Building2 size={14} />,
  credit: <CreditCard size={14} />,
  wallet: <Wallet size={14} />,
}

export default function Budgets() {
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<SourceAccount[]>([])
  const [tagBudgets, setTagBudgets] = useState<TagBudgetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(currentYM())

  // Category edit/add state
  const [editCat, setEditCat] = useState<Category | null>(null)
  const [nameVal, setNameVal] = useState('')
  const [budgetVal, setBudgetVal] = useState('')
  const [colorVal, setColorVal] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBudget, setNewBudget] = useState('')
  const [newColor, setNewColor] = useState('#C8DDD0')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Account budget/credit edit state
  const [editAcct, setEditAcct] = useState<SourceAccount | null>(null)
  const [acctBudgetVal, setAcctBudgetVal] = useState('')
  const [acctCreditLimitVal, setAcctCreditLimitVal] = useState('')
  const [acctSaving, setAcctSaving] = useState(false)

  async function load() {
    const [y, m] = selectedMonth.split('-').map(Number)
    const monthStart = new Date(y, m - 1, 1).toISOString().slice(0, 10)
    const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10)

    const { data: { user } } = await supabase.auth.getUser()

    const [{ data: cats }, { data: txns }, saRes, tagsRes] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('transactions')
        .select('id, category_id, source_account_id, amount, spending_type, date')
        .gte('date', monthStart)
        .lte('date', monthEnd),
      user
        ? supabase.from('source_accounts').select('*').eq('user_id', user.id).order('label')
        : Promise.resolve({ data: [] as any[] }),
      user
        ? supabase.from('tags').select('id, name, color, budget').eq('user_id', user.id).order('name')
        : Promise.resolve({ data: [] as any[] }),
    ])

    // Category spend mapping
    const grossMap: Record<string, number> = {}
    const creditMap: Record<string, number> = {}
    const acctSpendMap: Record<string, number> = {}
    const txnIdSet = new Set((txns ?? []).map((t: any) => t.id))

    txns?.forEach((t: any) => {
      // Category spend
      if (t.category_id) {
        if (t.spending_type === 'credit' || t.amount < 0) {
          creditMap[t.category_id] = (creditMap[t.category_id] ?? 0) + Math.abs(t.amount)
        } else {
          grossMap[t.category_id] = (grossMap[t.category_id] ?? 0) + t.amount
        }
      }
      // Account spend (debit only — not credits/refunds)
      if (t.source_account_id && t.spending_type !== 'credit' && t.amount > 0) {
        acctSpendMap[t.source_account_id] = (acctSpendMap[t.source_account_id] ?? 0) + t.amount
      }
    })

    setCategories((cats ?? []).map(c => {
      const grossSpent = grossMap[c.id] ?? 0
      const credited = creditMap[c.id] ?? 0
      const spent = Math.max(0, grossSpent - credited)
      return { ...c, grossSpent, credited, spent }
    }))

    setAccounts((saRes.data ?? []).map((a: any) => ({
      ...a,
      spent: acctSpendMap[a.id] ?? 0,
    })))

    // Tags: fetch transaction_tags for transactions within this month
    if ((tagsRes.data ?? []).length > 0 && txnIdSet.size > 0) {
      const { data: ttData } = await supabase
        .from('transaction_tags')
        .select('tag_id, transactions(id, amount, spending_type, date)')

      const tagSpendMap: Record<string, { spent: number; count: number; minDate: string; maxDate: string }> = {}
      ttData?.forEach((row: any) => {
        const t = row.transactions
        if (!t || !txnIdSet.has(t.id)) return
        const id = row.tag_id
        if (!tagSpendMap[id]) tagSpendMap[id] = { spent: 0, count: 0, minDate: t.date, maxDate: t.date }
        tagSpendMap[id].count++
        if (t.spending_type !== 'credit' && t.amount > 0) tagSpendMap[id].spent += t.amount
        if (t.date < tagSpendMap[id].minDate) tagSpendMap[id].minDate = t.date
        if (t.date > tagSpendMap[id].maxDate) tagSpendMap[id].maxDate = t.date
      })

      const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      setTagBudgets((tagsRes.data ?? []).map((tag: any) => {
        const stats = tagSpendMap[tag.id]
        const date_range = stats
          ? stats.minDate === stats.maxDate ? fmtDate(stats.minDate) : `${fmtDate(stats.minDate)} – ${fmtDate(stats.maxDate)}`
          : ''
        return { ...tag, spent: stats?.spent ?? 0, txn_count: stats?.count ?? 0, date_range }
      }))
    } else {
      setTagBudgets((tagsRes.data ?? []).map((tag: any) => ({ ...tag, spent: 0, txn_count: 0, date_range: '' })))
    }

    setLoading(false)
  }

  useEffect(() => { load() }, [selectedMonth])

  async function saveBudget() {
    if (!editCat) return
    await supabase.from('categories').update({ name: nameVal.trim() || editCat.name, monthly_budget: Number(budgetVal), color_tag: colorVal }).eq('id', editCat.id)
    setEditCat(null)
    load()
  }

  async function deleteCategory(id: string) {
    await supabase.from('categories').delete().eq('id', id)
    setDeleteConfirm(null)
    load()
  }

  async function addCategory() {
    if (!newName.trim()) return
    await supabase.from('categories').insert({ name: newName.trim(), monthly_budget: Number(newBudget) || 0, color_tag: newColor })
    setNewName(''); setNewBudget(''); setNewColor('#C8DDD0'); setShowAdd(false)
    load()
  }

  async function saveAccountBudget() {
    if (!editAcct) return
    setAcctSaving(true)
    const updates: Record<string, number | null> = {
      monthly_budget: acctBudgetVal !== '' ? Number(acctBudgetVal) : null,
    }
    if (editAcct.account_type === 'credit') {
      updates.credit_limit = acctCreditLimitVal !== '' ? Number(acctCreditLimitVal) : null
    }
    await supabase.from('source_accounts').update(updates).eq('id', editAcct.id)
    setAcctSaving(false)
    setEditAcct(null)
    load()
  }

  const totalBudget = categories.reduce((s, c) => s + c.monthly_budget, 0)
  const totalSpent = categories.reduce((s, c) => s + (c.spent ?? 0), 0)
  const overCount = categories.filter(c => (c.spent ?? 0) > c.monthly_budget).length
  const isCurrentMonth = selectedMonth === currentYM()

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Budgets</h1>
          <p className="text-gray-400 text-sm mt-1">Monthly allocation vs actual spend.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-[#7FA68A] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#6d9478] transition-all">
          <Plus size={15} /> Add Category
        </button>
      </div>

      {/* Month picker */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setSelectedMonth(prevMonth(selectedMonth))}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-gray-700 min-w-36 text-center">{ymLabel(selectedMonth)}</span>
        <button onClick={() => setSelectedMonth(nextMonth(selectedMonth))}
          disabled={isCurrentMonth}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
          <ChevronRight size={16} />
        </button>
        {!isCurrentMonth && (
          <button onClick={() => setSelectedMonth(currentYM())}
            className="text-xs text-[#7FA68A] hover:underline ml-1">
            Back to current
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Budgeted', value: fmt(totalBudget), bg: 'bg-[#C8DDD0]' },
          { label: 'Net Spent', value: fmt(totalSpent), bg: 'bg-[#C4DCF0]' },
          { label: 'Over Budget', value: `${overCount} categories`, bg: overCount > 0 ? 'bg-[#F0CECE]' : 'bg-[#C4E8D5]' },
        ].map(card => (
          <div key={card.label} className={`${card.bg} rounded-2xl p-4`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 opacity-70">{card.label}</div>
            <div className="text-xl font-light text-gray-800 mt-1" style={{ fontFamily: 'Georgia,serif' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* ── Category Budgets ── */}
      <h2 className="text-base font-semibold text-gray-700 mb-3">Category Budgets</h2>
      {loading ? <p className="text-gray-400 text-sm">Loading...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          {categories.map(cat => {
            const spent = cat.spent ?? 0
            const grossSpent = cat.grossSpent ?? 0
            const credited = cat.credited ?? 0
            const pct = cat.monthly_budget > 0 ? Math.min((spent / cat.monthly_budget) * 100, 100) : 0
            const grossPct = cat.monthly_budget > 0 ? Math.min((grossSpent / cat.monthly_budget) * 100, 100) : 0
            const isOver = spent > cat.monthly_budget
            const isWarn = pct >= 80 && !isOver
            const hasCredits = credited > 0
            const barColor = isOver ? '#F87171' : isWarn ? '#FBBF24' : '#7FA68A'
            const grossBarColor = isOver ? '#FECACA' : isWarn ? '#FDE68A' : '#B8D9C3'

            return (
              <div key={cat.id} className={`bg-white border rounded-2xl p-4 shadow-sm transition-all hover:shadow-md ${isOver ? 'border-red-200' : isWarn ? 'border-amber-200' : 'border-gray-100'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cat.color_tag }} />
                  <span className="font-semibold text-gray-800 text-sm flex-1">{cat.name}</span>
                  {isOver ? <XCircle size={16} className="text-red-400" /> : isWarn ? <AlertTriangle size={16} className="text-amber-400" /> : <CheckCircle size={16} className="text-[#7FA68A]" />}
                  <button onClick={() => { setEditCat(cat); setNameVal(cat.name); setBudgetVal(String(cat.monthly_budget)); setColorVal(cat.color_tag || '#C8DDD0') }} className="p-1 text-gray-400 hover:text-gray-600"><Edit2 size={13} /></button>
                  <button onClick={() => setDeleteConfirm(cat.id)} className="p-1 text-gray-300 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <div className="text-xs text-gray-400">Net Spent</div>
                    <div className="text-lg font-light" style={{ fontFamily: 'Georgia,serif', color: isOver ? '#F87171' : '#374151' }}>{fmt(spent)}</div>
                    {hasCredits && (
                      <div className="text-xs text-green-600 mt-0.5">{fmt(grossSpent)} gross − {fmt(credited)} reimbursed</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">Budget</div>
                    <div className="text-lg font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>{fmt(cat.monthly_budget)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden relative">
                    {hasCredits && (
                      <div className="absolute inset-y-0 left-0 rounded-full transition-all"
                        style={{ width: `${grossPct}%`, background: grossBarColor }} />
                    )}
                    <div className="absolute inset-y-0 left-0 rounded-full transition-all"
                      style={{ width: `${pct}%`, background: barColor }} />
                  </div>
                  <span className="text-xs text-gray-400 w-8 text-right">{Math.round(pct)}%</span>
                </div>
                {hasCredits && (
                  <div className="flex gap-3 mt-1.5">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: grossBarColor }} /> Gross
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: barColor }} /> Net
                    </div>
                  </div>
                )}
                {isOver && <div className="mt-2 text-xs bg-red-50 text-red-400 rounded-lg px-3 py-1.5">⚠️ Over by {fmt(spent - cat.monthly_budget)}</div>}
                {isWarn && <div className="mt-2 text-xs bg-amber-50 text-amber-500 rounded-lg px-3 py-1.5">⚡ 80%+ used — watch your spend</div>}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Card & Account Budgets ── */}
      {accounts.length > 0 && (
        <>
          <h2 className="text-base font-semibold text-gray-700 mb-1">Card & Account Budgets</h2>
          <p className="text-xs text-gray-400 mb-4">Monthly spend per card or account. For credit cards, also set your credit limit to track utilisation.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.map(acct => {
              const spent = acct.spent ?? 0
              const budget = acct.monthly_budget ?? 0
              const hasBudget = budget > 0
              const pct = hasBudget ? Math.min((spent / budget) * 100, 100) : 0
              const isOver = hasBudget && spent > budget
              const isWarn = hasBudget && pct >= 80 && !isOver
              const barColor = isOver ? '#F87171' : isWarn ? '#FBBF24' : '#7FA68A'

              const creditLimit = acct.credit_limit ?? 0
              const hasCreditLimit = acct.account_type === 'credit' && creditLimit > 0
              const utilised = hasCreditLimit ? Math.min((spent / creditLimit) * 100, 100) : 0
              const available = hasCreditLimit ? Math.max(0, creditLimit - spent) : 0
              const utilisedColor = utilised >= 90 ? '#F87171' : utilised >= 70 ? '#FBBF24' : '#7FA68A'

              return (
                <div key={acct.id} className={`bg-white border rounded-2xl p-4 shadow-sm transition-all hover:shadow-md ${isOver ? 'border-red-200' : isWarn ? 'border-amber-200' : 'border-gray-100'}`}>
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-gray-600"
                      style={{ background: acct.color ?? '#C8DDD0' }}>
                      {TYPE_ICONS[acct.account_type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-800 text-sm">{acct.label}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1.5">
                        <span>{acct.bank_name}</span>
                        {acct.last4 && <span className="bg-gray-100 px-1.5 py-0.5 rounded-full">••••{acct.last4}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setEditAcct(acct)
                        setAcctBudgetVal(acct.monthly_budget != null ? String(acct.monthly_budget) : '')
                        setAcctCreditLimitVal(acct.credit_limit != null ? String(acct.credit_limit) : '')
                      }}
                      className="p-1 text-gray-400 hover:text-gray-600"
                    >
                      <Edit2 size={13} />
                    </button>
                  </div>

                  {/* Spend this month */}
                  <div className="flex items-end justify-between mb-2">
                    <div>
                      <div className="text-xs text-gray-400">Spent this month</div>
                      <div className="text-lg font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>
                        {fmt(spent)}
                      </div>
                    </div>
                    {hasBudget && (
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Monthly Budget</div>
                        <div className="text-lg font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>
                          {fmt(budget)}
                        </div>
                      </div>
                    )}
                    {!hasBudget && (
                      <button
                        onClick={() => { setEditAcct(acct); setAcctBudgetVal(''); setAcctCreditLimitVal(acct.credit_limit != null ? String(acct.credit_limit) : '') }}
                        className="text-xs text-[#7FA68A] hover:underline"
                      >
                        + Set budget
                      </button>
                    )}
                  </div>

                  {/* Budget progress bar */}
                  {hasBudget && (
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                      <span className="text-xs text-gray-400 w-8 text-right">{Math.round(pct)}%</span>
                    </div>
                  )}

                  {/* Credit limit section (credit cards only) */}
                  {acct.account_type === 'credit' && (
                    <div className={`rounded-xl p-3 ${hasCreditLimit ? 'bg-gray-50' : 'bg-[#F5F2EC]'}`}>
                      {hasCreditLimit ? (
                        <>
                          <div className="flex justify-between items-center mb-1.5">
                            <div>
                              <span className="text-xs text-gray-400">Limit Utilised</span>
                              <div className="text-sm font-semibold" style={{ color: utilisedColor }}>{fmt(spent)} / {fmt(creditLimit)}</div>
                            </div>
                            <div className="text-right">
                              <span className="text-xs text-gray-400">Available Credit</span>
                              <div className="text-sm font-semibold text-[#7FA68A]">{fmt(available)}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${utilised}%`, background: utilisedColor }} />
                            </div>
                            <span className="text-xs w-10 text-right" style={{ color: utilisedColor }}>{Math.round(utilised)}% used</span>
                          </div>
                          {utilised >= 90 && (
                            <div className="mt-1.5 text-xs text-red-400">⚠️ Near credit limit — {fmt(available)} left</div>
                          )}
                          {utilised >= 70 && utilised < 90 && (
                            <div className="mt-1.5 text-xs text-amber-500">⚡ High utilisation — affects credit score</div>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400 italic">Credit limit not set</span>
                          <button
                            onClick={() => { setEditAcct(acct); setAcctBudgetVal(acct.monthly_budget != null ? String(acct.monthly_budget) : ''); setAcctCreditLimitVal('') }}
                            className="text-xs text-[#7FA68A] hover:underline"
                          >
                            + Add limit
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {isOver && <div className="mt-2 text-xs bg-red-50 text-red-400 rounded-lg px-3 py-1.5">⚠️ Monthly budget over by {fmt(spent - budget)}</div>}
                  {isWarn && !isOver && <div className="mt-2 text-xs bg-amber-50 text-amber-500 rounded-lg px-3 py-1.5">⚡ 80%+ of monthly budget used</div>}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Tag Budgets ── */}
      {tagBudgets.length > 0 && (
        <div className="mt-10">
          <h2 className="text-base font-semibold text-gray-700 mb-1">Tag Budgets</h2>
          <p className="text-xs text-gray-400 mb-4">Spend rolled up by tag for {ymLabel(selectedMonth)}.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tagBudgets.map(tag => {
              const hasBudget = (tag.budget ?? 0) > 0
              const pct = hasBudget ? Math.min((tag.spent / tag.budget!) * 100, 100) : 0
              const isOver = hasBudget && tag.spent > tag.budget!
              const isWarn = hasBudget && pct >= 80 && !isOver
              const barColor = isOver ? '#F87171' : isWarn ? '#FBBF24' : '#7FA68A'

              return (
                <div key={tag.id} className={`bg-white border rounded-2xl p-4 shadow-sm transition-all hover:shadow-md ${isOver ? 'border-red-200' : isWarn ? 'border-amber-200' : 'border-gray-100'}`}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: tag.color ?? '#C8DDD0' }}>
                      <Tag size={14} className="text-gray-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-800 text-sm">{tag.name}</div>
                      {tag.date_range && <div className="text-xs text-gray-400 mt-0.5">{tag.date_range}</div>}
                    </div>
                    {hasBudget && (
                      isOver ? <XCircle size={16} className="text-red-400" /> :
                      isWarn ? <AlertTriangle size={16} className="text-amber-400" /> :
                      <CheckCircle size={16} className="text-[#7FA68A]" />
                    )}
                  </div>
                  <div className="flex items-end justify-between mb-2">
                    <div>
                      <div className="text-xs text-gray-400">Spent</div>
                      <div className="text-lg font-light" style={{ fontFamily: 'Georgia,serif', color: isOver ? '#F87171' : '#374151' }}>
                        {fmt(tag.spent)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">{tag.txn_count} txn{tag.txn_count !== 1 ? 's' : ''}</div>
                      {hasBudget && (
                        <div className="text-sm font-light text-gray-500">Budget {fmt(tag.budget!)}</div>
                      )}
                      {!hasBudget && tag.txn_count === 0 && (
                        <div className="text-xs text-gray-300 italic">No transactions</div>
                      )}
                    </div>
                  </div>
                  {hasBudget && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                      <span className="text-xs text-gray-400 w-8 text-right">{Math.round(pct)}%</span>
                    </div>
                  )}
                  {isOver && <div className="mt-2 text-xs bg-red-50 text-red-400 rounded-lg px-3 py-1.5">⚠️ Over by {fmt(tag.spent - tag.budget!)}</div>}
                  {isWarn && <div className="mt-2 text-xs bg-amber-50 text-amber-500 rounded-lg px-3 py-1.5">⚡ 80%+ of tag budget used</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Edit category modal */}
      {editCat && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-4" style={{ fontFamily: 'Georgia,serif' }}>Edit Category</h2>
            <div className="flex flex-col gap-3 mb-4">
              <input placeholder="Category name" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                value={nameVal} onChange={e => setNameVal(e.target.value)} />
              <input type="number" placeholder="Monthly budget (₹)" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                value={budgetVal} onChange={e => setBudgetVal(e.target.value)} />
              <div>
                <div className="text-xs text-gray-400 mb-2">Colour tag</div>
                <div className="flex gap-2 flex-wrap">
                  {['#C8DDD0','#D5CEED','#F0CECE','#F7DEC4','#C4DCF0','#C4E8D5','#F5D6B8','#E8C4D5','#B8D4E8','#D4E8B8'].map(c => (
                    <button key={c} onClick={() => setColorVal(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${colorVal === c ? 'border-gray-600 scale-110' : 'border-transparent'}`}
                      style={{ background: c }} />
                  ))}
                  <input type="color" value={colorVal} onChange={e => setColorVal(e.target.value)}
                    className="w-7 h-7 rounded-full border border-gray-200 cursor-pointer" title="Custom colour" />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditCat(null)} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500">Cancel</button>
              <button onClick={saveBudget} className="flex-1 bg-[#7FA68A] text-white rounded-xl py-2.5 text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add category modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-4" style={{ fontFamily: 'Georgia,serif' }}>Add Category</h2>
            <div className="flex flex-col gap-3">
              <input placeholder="Category name" className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                value={newName} onChange={e => setNewName(e.target.value)} />
              <input type="number" placeholder="Monthly budget (₹)" className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                value={newBudget} onChange={e => setNewBudget(e.target.value)} />
              <div>
                <div className="text-xs text-gray-400 mb-2">Colour tag</div>
                <div className="flex gap-2 flex-wrap">
                  {['#C8DDD0','#D5CEED','#F0CECE','#F7DEC4','#C4DCF0','#C4E8D5','#F5D6B8','#E8C4D5','#B8D4E8','#D4E8B8'].map(c => (
                    <button key={c} onClick={() => setNewColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${newColor === c ? 'border-gray-600 scale-110' : 'border-transparent'}`}
                      style={{ background: c }} />
                  ))}
                  <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
                    className="w-7 h-7 rounded-full border border-gray-200 cursor-pointer" title="Custom colour" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500">Cancel</button>
              <button onClick={addCategory} className="flex-1 bg-[#7FA68A] text-white rounded-xl py-2.5 text-sm font-medium">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-2" style={{ fontFamily: 'Georgia,serif' }}>Delete category?</h2>
            <p className="text-sm text-gray-500 mb-5">This won't delete any transactions, just the category label. Transactions in this category will become uncategorised.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500">Cancel</button>
              <button onClick={() => deleteCategory(deleteConfirm)} className="flex-1 bg-red-400 text-white rounded-xl py-2.5 text-sm font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Account budget / credit limit edit modal */}
      {editAcct && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-600"
                style={{ background: editAcct.color ?? '#C8DDD0' }}>
                {TYPE_ICONS[editAcct.account_type]}
              </div>
              <div>
                <h2 className="text-lg font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>{editAcct.label}</h2>
                <p className="text-xs text-gray-400">{editAcct.bank_name}{editAcct.last4 ? ` ••••${editAcct.last4}` : ''}</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Monthly Spend Budget <span className="text-gray-300">(optional)</span></label>
                <input
                  type="number"
                  placeholder="e.g. 15000"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                  value={acctBudgetVal}
                  onChange={e => setAcctBudgetVal(e.target.value)}
                />
                <p className="text-[10px] text-gray-400 mt-1">Track monthly debit spend against a cap for this card</p>
              </div>
              {editAcct.account_type === 'credit' && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Credit Limit <span className="text-gray-300">(optional)</span></label>
                  <input
                    type="number"
                    placeholder="e.g. 100000"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                    value={acctCreditLimitVal}
                    onChange={e => setAcctCreditLimitVal(e.target.value)}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Used to calculate limit utilisation %</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditAcct(null)} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500 flex items-center justify-center gap-1">
                <X size={13} /> Cancel
              </button>
              <button onClick={saveAccountBudget} disabled={acctSaving} className="flex-1 bg-[#7FA68A] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-[#6d9478] disabled:opacity-50 flex items-center justify-center gap-1">
                <Check size={13} /> {acctSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
