import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Edit2, AlertTriangle, CheckCircle, XCircle, Plus, Trash2 } from 'lucide-react'

interface Category {
  id: string
  name: string
  monthly_budget: number
  color_tag: string
  spent?: number
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

export default function Budgets() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editCat, setEditCat] = useState<Category | null>(null)
  const [nameVal, setNameVal] = useState('')
  const [budgetVal, setBudgetVal] = useState('')
  const [colorVal, setColorVal] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBudget, setNewBudget] = useState('')
  const [newColor, setNewColor] = useState('#C8DDD0')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  async function load() {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const { data: cats } = await supabase.from('categories').select('*').order('name')
    const { data: txns } = await supabase.from('transactions').select('category_id, amount').gte('date', monthStart)

    const spendMap: Record<string, number> = {}
    txns?.forEach(t => { if (t.category_id) spendMap[t.category_id] = (spendMap[t.category_id] ?? 0) + t.amount })

    setCategories((cats ?? []).map(c => ({ ...c, spent: spendMap[c.id] ?? 0 })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('categories').insert({ name: newName.trim(), monthly_budget: Number(newBudget) || 0, color_tag: newColor, user_id: user.id })
    setNewName(''); setNewBudget(''); setNewColor('#C8DDD0'); setShowAdd(false)
    load()
  }

  const totalBudget = categories.reduce((s, c) => s + c.monthly_budget, 0)
  const totalSpent = categories.reduce((s, c) => s + (c.spent ?? 0), 0)
  const overCount = categories.filter(c => (c.spent ?? 0) > c.monthly_budget).length

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Category Budgets</h1>
          <p className="text-gray-400 text-sm mt-1">Monthly allocation vs actual spend.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-[#7FA68A] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#6d9478] transition-all">
          <Plus size={15} /> Add Category
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Budgeted', value: fmt(totalBudget), bg: 'bg-[#C8DDD0]' },
          { label: 'Spent (MTD)', value: fmt(totalSpent), bg: 'bg-[#C4DCF0]' },
          { label: 'Over Budget', value: `${overCount} categories`, bg: overCount > 0 ? 'bg-[#F0CECE]' : 'bg-[#C4E8D5]' },
        ].map(card => (
          <div key={card.label} className={`${card.bg} rounded-2xl p-4`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 opacity-70">{card.label}</div>
            <div className="text-xl font-light text-gray-800 mt-1" style={{ fontFamily: 'Georgia,serif' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Category cards */}
      {loading ? <p className="text-gray-400 text-sm">Loading...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {categories.map(cat => {
            const spent = cat.spent ?? 0
            const pct = cat.monthly_budget > 0 ? Math.min((spent / cat.monthly_budget) * 100, 100) : 0
            const isOver = spent > cat.monthly_budget
            const isWarn = pct >= 80 && !isOver

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
                    <div className="text-xs text-gray-400">Spent</div>
                    <div className="text-lg font-light" style={{ fontFamily: 'Georgia,serif', color: isOver ? '#F87171' : '#374151' }}>{fmt(spent)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">Budget</div>
                    <div className="text-lg font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>{fmt(cat.monthly_budget)}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: isOver ? '#F87171' : isWarn ? '#FBBF24' : '#7FA68A' }} />
                  </div>
                  <span className="text-xs text-gray-400 w-8 text-right">{Math.round(pct)}%</span>
                </div>

                {isOver && <div className="mt-2 text-xs bg-red-50 text-red-400 rounded-lg px-3 py-1.5">⚠️ Over by {fmt(spent - cat.monthly_budget)}</div>}
                {isWarn && <div className="mt-2 text-xs bg-amber-50 text-amber-500 rounded-lg px-3 py-1.5">⚡ 80%+ used — watch your spend</div>}
              </div>
            )
          })}
        </div>
      )}

      {/* Edit modal */}
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
    </div>
  )
}
