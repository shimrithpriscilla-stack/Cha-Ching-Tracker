import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Edit2, Trash2, Tag, Check, X } from 'lucide-react'

export interface TagItem {
  id: string
  name: string
  color: string
  budget: number | null
  txn_count?: number
  total_spent?: number
  date_range?: string
}

const PRESET_TAG_COLORS = [
  '#C8DDD0', '#D5CEED', '#F7DEC4', '#C4DCF0',
  '#F0CECE', '#C4E8D5', '#F0EBE0', '#FFF3C4',
  '#E8D5F0', '#F0D5E8', '#D5E8F0', '#E8F0D5',
]

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

const EMPTY_FORM = { name: '', color: PRESET_TAG_COLORS[0], budget: '' }

export default function Tags() {
  const [tags, setTags] = useState<TagItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Load tags
    const { data: tagsData } = await supabase
      .from('tags')
      .select('*')
      .eq('user_id', user.id)
      .order('name')

    if (!tagsData) { setLoading(false); return }

    // Load transaction_tags with transaction amounts + dates
    const { data: txTagData } = await supabase
      .from('transaction_tags')
      .select('tag_id, transactions(id, amount, date, spending_type)')

    const tagStats: Record<string, { count: number; total: number; minDate: string; maxDate: string }> = {}
    txTagData?.forEach((row: any) => {
      const t = row.transactions
      if (!t) return
      const id = row.tag_id
      if (!tagStats[id]) tagStats[id] = { count: 0, total: 0, minDate: t.date, maxDate: t.date }
      tagStats[id].count++
      if (t.spending_type !== 'credit' && t.amount > 0) tagStats[id].total += t.amount
      if (t.date < tagStats[id].minDate) tagStats[id].minDate = t.date
      if (t.date > tagStats[id].maxDate) tagStats[id].maxDate = t.date
    })

    setTags(tagsData.map(tag => {
      const stats = tagStats[tag.id]
      let date_range = ''
      if (stats) {
        const fmt_d = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
        date_range = stats.minDate === stats.maxDate ? fmt_d(stats.minDate) : `${fmt_d(stats.minDate)} – ${fmt_d(stats.maxDate)}`
      }
      return {
        ...tag,
        txn_count: stats?.count ?? 0,
        total_spent: stats?.total ?? 0,
        date_range,
      }
    }))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setShowForm(true)
  }

  function openEdit(tag: TagItem) {
    setEditId(tag.id)
    setForm({ name: tag.name, color: tag.color ?? PRESET_TAG_COLORS[0], budget: tag.budget != null ? String(tag.budget) : '' })
    setError('')
    setShowForm(true)
  }

  async function save() {
    if (!form.name.trim()) { setError('Tag name is required.'); return }
    setSaving(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not logged in'); setSaving(false); return }

    const payload = {
      user_id: user.id,
      name: form.name.trim(),
      color: form.color,
      budget: form.budget.trim() ? parseFloat(form.budget) : null,
    }

    if (editId) {
      const { error: e } = await supabase.from('tags').update(payload).eq('id', editId)
      if (e) { setError(e.message); setSaving(false); return }
    } else {
      const { error: e } = await supabase.from('tags').insert(payload)
      if (e) { setError(e.message); setSaving(false); return }
    }

    setSaving(false)
    setShowForm(false)
    setEditId(null)
    load()
  }

  async function remove(id: string) {
    setDeletingId(id)
    await supabase.from('tags').delete().eq('id', id)
    setDeletingId(null)
    setDeleteConfirm(null)
    load()
  }

  const totalTagged = tags.reduce((s, t) => s + (t.total_spent ?? 0), 0)
  const totalTxns = tags.reduce((s, t) => s + (t.txn_count ?? 0), 0)

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Tags</h1>
          <p className="text-gray-400 text-sm mt-1">Group transactions across trips, events, or any theme.</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-[#7FA68A] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#6d9478] transition-all"
        >
          <Plus size={15} /> New Tag
        </button>
      </div>

      {/* Info callout */}
      <div className="bg-[#F5F2EC] rounded-2xl px-4 py-3 text-sm text-gray-500 mb-6">
        <strong className="text-gray-700">How tags work:</strong> Create tags like "Goa Trip", "Fresher's Night", or "Interview Season". Then tag individual transactions from the Transactions page — one transaction can have multiple tags. You'll see the total rolled up here per tag.
      </div>

      {/* Summary strip */}
      {tags.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-[#C8DDD0] rounded-2xl px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-gray-600 opacity-70 font-semibold">Tags</div>
            <div className="text-xl font-light text-gray-800 mt-0.5" style={{ fontFamily: 'Georgia,serif' }}>{tags.length}</div>
          </div>
          <div className="bg-[#C4DCF0] rounded-2xl px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-gray-600 opacity-70 font-semibold">Tagged Txns</div>
            <div className="text-xl font-light text-gray-800 mt-0.5" style={{ fontFamily: 'Georgia,serif' }}>{totalTxns}</div>
          </div>
          <div className="bg-[#D5CEED] rounded-2xl px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-gray-600 opacity-70 font-semibold">Total Spent</div>
            <div className="text-xl font-light text-gray-800 mt-0.5" style={{ fontFamily: 'Georgia,serif' }}>{fmt(totalTagged)}</div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : tags.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          <Tag size={32} strokeWidth={1} className="mx-auto mb-3 text-gray-300" />
          No tags yet. Create your first tag to start grouping transactions.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tags.map(tag => {
            const hasBudget = (tag.budget ?? 0) > 0
            const spent = tag.total_spent ?? 0
            const pct = hasBudget ? Math.min((spent / tag.budget!) * 100, 100) : 0
            const isOver = hasBudget && spent > tag.budget!
            const barColor = isOver ? '#F87171' : pct >= 80 ? '#FBBF24' : '#7FA68A'

            return (
              <div key={tag.id} className={`bg-white border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all ${isOver ? 'border-red-200' : 'border-gray-100'}`}>
                {/* Header */}
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: tag.color ?? '#C8DDD0' }}>
                    <Tag size={14} className="text-gray-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 text-sm">{tag.name}</div>
                    {tag.date_range && (
                      <div className="text-xs text-gray-400 mt-0.5">{tag.date_range}</div>
                    )}
                  </div>
                  <button onClick={() => openEdit(tag)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => setDeleteConfirm(tag.id)} disabled={deletingId === tag.id}
                    className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-50 rounded-lg disabled:opacity-40">
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Spend stats */}
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <div className="text-xs text-gray-400">Total Spent</div>
                    <div className="text-lg font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>
                      {fmt(spent)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">{tag.txn_count} transaction{tag.txn_count !== 1 ? 's' : ''}</div>
                    {hasBudget && (
                      <div className="text-sm font-light text-gray-500">Budget {fmt(tag.budget!)}</div>
                    )}
                    {!hasBudget && tag.txn_count === 0 && (
                      <div className="text-xs text-gray-300 italic">No transactions yet</div>
                    )}
                  </div>
                </div>

                {/* Budget bar */}
                {hasBudget && (
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                    </div>
                    <span className="text-xs text-gray-400 w-8 text-right">{Math.round(pct)}%</span>
                  </div>
                )}
                {isOver && <div className="text-xs bg-red-50 text-red-400 rounded-lg px-3 py-1.5">⚠️ Over budget by {fmt(spent - tag.budget!)}</div>}
              </div>
            )
          })}
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-4" style={{ fontFamily: 'Georgia,serif' }}>
              {editId ? 'Edit Tag' : 'New Tag'}
            </h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Tag Name <span className="text-red-400">*</span></label>
                <input
                  placeholder="e.g. Goa Trip, Fresher's Night, Interview Season"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && save()}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Budget <span className="text-gray-300">(optional)</span></label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">₹</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 8000"
                    className="w-full border border-gray-200 rounded-xl pl-7 pr-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                    value={form.budget}
                    onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Optional — track total spend for this tag against a cap</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Colour</label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_TAG_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      className="w-7 h-7 rounded-lg border-2 transition-all flex items-center justify-center"
                      style={{ background: c, borderColor: form.color === c ? '#7FA68A' : 'transparent' }}
                    >
                      {form.color === c && <Check size={12} className="text-gray-600" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setShowForm(false); setEditId(null) }}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500 hover:bg-gray-50 flex items-center justify-center gap-1"
              >
                <X size={13} /> Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 bg-[#7FA68A] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-[#6d9478] disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <Check size={13} /> {saving ? 'Saving…' : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-2" style={{ fontFamily: 'Georgia,serif' }}>Delete tag?</h2>
            <p className="text-sm text-gray-500 mb-5">The tag will be removed from all transactions. Transactions themselves won't be deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-500">Cancel</button>
              <button onClick={() => remove(deleteConfirm)} disabled={!!deletingId}
                className="flex-1 bg-red-400 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                {deletingId ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
