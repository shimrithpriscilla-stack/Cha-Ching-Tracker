import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Plus, Trash2, Edit2, Check, X, CreditCard, Wallet, Building2 } from 'lucide-react'

export interface SourceAccount {
  id: string
  last4: string | null
  bank_name: string
  label: string
  account_type: 'savings' | 'credit' | 'wallet'
  color?: string
}

const TYPE_LABELS: Record<string, string> = {
  savings: 'Savings / UPI',
  credit: 'Credit Card',
  wallet: 'Wallet / Prepaid',
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  savings: <Building2 size={14} />,
  credit: <CreditCard size={14} />,
  wallet: <Wallet size={14} />,
}

const PRESET_COLORS = [
  '#C8DDD0', '#D5CEED', '#F7DEC4', '#C4DCF0',
  '#F0CECE', '#C4E8D5', '#F0EBE0', '#FFF3C4',
]

const EMPTY_FORM: { last4: string; bank_name: string; label: string; account_type: 'savings' | 'credit' | 'wallet'; color: string } = { last4: '', bank_name: '', label: '', account_type: 'savings', color: PRESET_COLORS[0] }

export default function Settings() {
  const [accounts, setAccounts] = useState<SourceAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('source_accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    setAccounts(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setShowForm(true)
  }

  function openEdit(a: SourceAccount) {
    setEditId(a.id)
    setForm({
      last4: a.last4 ?? '',
      bank_name: a.bank_name,
      label: a.label,
      account_type: a.account_type as 'savings' | 'credit' | 'wallet',
      color: (a as any).color ?? PRESET_COLORS[0],
    })
    setError('')
    setShowForm(true)
  }

  async function save() {
    if (!form.bank_name.trim() || !form.label.trim()) {
      setError('Bank name and label are required.')
      return
    }
    setSaving(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not logged in'); setSaving(false); return }

    const payload = {
      user_id: user.id,
      last4: form.last4.trim() || null,
      bank_name: form.bank_name.trim(),
      label: form.label.trim(),
      account_type: form.account_type,
      color: form.color,
    }

    if (editId) {
      const { error: e } = await supabase.from('source_accounts').update(payload).eq('id', editId)
      if (e) { setError(e.message); setSaving(false); return }
    } else {
      const { error: e } = await supabase.from('source_accounts').insert(payload)
      if (e) { setError(e.message); setSaving(false); return }
    }

    setSaving(false)
    setShowForm(false)
    setEditId(null)
    load()
  }

  async function remove(id: string) {
    setDeletingId(id)
    await supabase.from('source_accounts').delete().eq('id', id)
    setDeletingId(null)
    load()
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Settings</h1>
          <p className="text-gray-400 text-sm mt-1">Manage your cards and accounts.</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-[#7FA68A] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#6d9478] transition-all"
        >
          <Plus size={15} /> Add Account
        </button>
      </div>

      {/* Info callout */}
      <div className="bg-[#F5F2EC] rounded-2xl px-4 py-3 text-sm text-gray-500 mb-6">
        <strong className="text-gray-700">How it works:</strong> Add each card or bank account you use. During import, transactions are automatically tagged with the matching account based on the bank name or last 4 digits of your card. You can then filter transactions by account.
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          <CreditCard size={32} strokeWidth={1} className="mx-auto mb-3 text-gray-300" />
          No accounts yet. Add your first card or bank account.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map(a => (
            <div key={a.id}
              className="bg-white border border-gray-100 rounded-2xl px-4 py-3.5 flex items-center gap-4 shadow-sm">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: (a as any).color ?? '#C8DDD0' }}
              >
                {TYPE_ICONS[a.account_type]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-800 text-sm">{a.label}</div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                  <span>{a.bank_name}</span>
                  {a.last4 && <span className="bg-gray-100 px-2 py-0.5 rounded-full">••••{a.last4}</span>}
                  <span className="bg-gray-100 px-2 py-0.5 rounded-full">{TYPE_LABELS[a.account_type]}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => openEdit(a)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg">
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => remove(a.id)}
                  disabled={deletingId === a.id}
                  className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-50 rounded-lg disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-light text-gray-800 mb-4" style={{ fontFamily: 'Georgia,serif' }}>
              {editId ? 'Edit Account' : 'Add Account'}
            </h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Label <span className="text-red-400">*</span></label>
                <input
                  placeholder="e.g. SBI Savings, Niyo Travel, Axis MyZone"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Bank / Issuer Name <span className="text-red-400">*</span></label>
                <input
                  placeholder="e.g. SBI, Niyo SBM, Axis Bank, HDFC"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A]"
                  value={form.bank_name}
                  onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
                />
                <p className="text-[10px] text-gray-400 mt-1">Used to match transactions during import</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Last 4 Digits <span className="text-gray-300">(optional)</span></label>
                <input
                  placeholder="e.g. 1802"
                  maxLength={4}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#7FA68A] font-mono tracking-widest"
                  value={form.last4}
                  onChange={e => setForm(f => ({ ...f, last4: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                />
                <p className="text-[10px] text-gray-400 mt-1">Helps distinguish two accounts from the same bank</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Account Type</label>
                <select
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none bg-white focus:border-[#7FA68A]"
                  value={form.account_type}
                  onChange={e => setForm(f => ({ ...f, account_type: e.target.value as typeof form.account_type }))}
                >
                  <option value="savings">Savings / UPI</option>
                  <option value="credit">Credit Card</option>
                  <option value="wallet">Wallet / Prepaid</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Colour</label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map(c => (
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
                <Check size={13} /> {saving ? 'Saving…' : editId ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
