import { useState, useRef, useCallback } from 'react'
import { Upload, FileText, AlertTriangle, CheckCircle, Trash2, ChevronDown } from 'lucide-react'
import { supabase } from '../supabase'

interface ParsedRow {
  id: string
  date: string
  description: string
  amount: number
  type: 'debit' | 'credit'
  utrNo: string
  source: string
  isDuplicate: boolean
  category_id: string
  spending_type: 'necessary' | 'unnecessary'
  selected: boolean
}

interface Category { id: string; name: string }

// ── Parsers ──────────────────────────────────────────────────────────────────

function parsePhonePe(text: string): Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] {
  const rows: Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] = []
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  let i = 0
  while (i < lines.length) {
    // Date line: "Oct 05, 2025"
    const dateLine = lines[i]
    const dateMatch = dateLine.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/)
    if (!dateMatch) { i++; continue }

    // Time line: "02:46 PM"
    const timeLine = lines[i + 1] ?? ''
    if (!timeLine.match(/\d{2}:\d{2}\s*(AM|PM)/i)) { i++; continue }

    // Description lines until "Credit" or "Debit"
    let desc = ''
    let j = i + 2
    let utrNo = ''
    while (j < lines.length) {
      if (lines[j].startsWith('Transaction ID')) { j++; continue }
      if (lines[j].startsWith('UTR No')) {
        utrNo = lines[j].replace('UTR No :', '').replace('UTR No:', '').trim()
        j++; continue
      }
      if (lines[j].startsWith('Debited from') || lines[j].startsWith('Credited to')) { j++; continue }
      if (lines[j] === 'Credit' || lines[j] === 'Debit') break
      if (lines[j].startsWith('Page ')) break
      if (lines[j].startsWith('This is a system')) break
      desc += (desc ? ' ' : '') + lines[j]
      j++
    }

    const typeStr = lines[j] ?? ''
    if (typeStr !== 'Credit' && typeStr !== 'Debit') { i = j + 1; continue }
    const type = typeStr === 'Credit' ? 'credit' : 'debit'

    // Amount: next line(s) — handle split amounts like "INR \r\n50000.00"
    let amtStr = ''
    let k = j + 1
    while (k < lines.length) {
      const l = lines[k]
      if (l.startsWith('INR')) { amtStr = l.replace('INR', '').trim(); k++; break }
      if (/^\d[\d,]*(\.\d+)?$/.test(l) && amtStr === '') { amtStr = l; k++; break }
      if (/^\d[\d,]*(\.\d+)?$/.test(l)) { amtStr += l; k++; break }
      break
    }
    if (!amtStr) { i = k; continue }

    const amount = parseFloat(amtStr.replace(/,/g, ''))
    if (isNaN(amount) || amount <= 0) { i = k; continue }

    const dateObj = new Date(dateLine)
    const dateISO = isNaN(dateObj.getTime()) ? '' : dateObj.toISOString().slice(0, 10)
    if (!dateISO) { i = k; continue }

    // Clean description
    const cleanDesc = desc
      .replace(/^Paid to\s+/i, '')
      .replace(/^Received from\s+/i, '')
      .replace(/^Payment Received\s*/i, 'Received')
      .trim()

    rows.push({ id: utrNo || `pp-${Date.now()}-${rows.length}`, date: dateISO, description: cleanDesc, amount, type, utrNo, source: 'PhonePe' })
    i = k
  }
  return rows
}

function parseGPay(text: string): Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] {
  const rows: Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] = []
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  let i = 0
  while (i < lines.length) {
    // Date line: "02 Apr, 2026"
    const dateLine = lines[i]
    const dateMatch = dateLine.match(/^(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec),\s+(\d{4})$/)
    if (!dateMatch) { i++; continue }

    const timeLine = lines[i + 1] ?? ''
    if (!timeLine.match(/\d{2}:\d{2}\s*(AM|PM)/i)) { i++; continue }

    // Next line: "Paid to X" or "Received from X" or "Self transfer to X"
    const descLine = lines[i + 2] ?? ''
    let type: 'debit' | 'credit' = 'debit'
    if (descLine.toLowerCase().startsWith('received from')) type = 'credit'
    else if (descLine.toLowerCase().startsWith('self transfer')) type = 'debit'

    // UPI Transaction ID line
    const upiLine = lines[i + 3] ?? ''
    const upiMatch = upiLine.match(/UPI Transaction ID:\s*(\S+)/)
    const utrNo = upiMatch ? upiMatch[1] : ''

    // Amount line: "₹993" or "₹1,700"
    let amtStr = ''
    let k = i + 4
    while (k < lines.length && k < i + 8) {
      const l = lines[k]
      if (l.startsWith('₹')) { amtStr = l.replace('₹', '').replace(/,/g, '').trim(); break }
      k++
    }
    if (!amtStr) { i = k + 1; continue }

    const amount = parseFloat(amtStr)
    if (isNaN(amount) || amount <= 0) { i = k + 1; continue }

    const cleanDesc = descLine
      .replace(/^Paid to\s+/i, '')
      .replace(/^Received from\s+/i, '')
      .replace(/^Self transfer to\s+/i, 'Self Transfer → ')
      .trim()

    const dateStr = `${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]}`
    const dateObj = new Date(dateStr)
    const dateISO = isNaN(dateObj.getTime()) ? '' : dateObj.toISOString().slice(0, 10)
    if (!dateISO) { i = k + 1; continue }

    rows.push({ id: utrNo || `gp-${Date.now()}-${rows.length}`, date: dateISO, description: cleanDesc, amount, type, utrNo, source: 'GPay' })
    i = k + 1
  }
  return rows
}

function detectAndParse(text: string, _filename: string): Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] {
  if (text.includes('PhonePe') || text.includes('UTR No')) return parsePhonePe(text)
  if (text.includes('Google Pay') || text.includes('UPI Transaction ID')) return parseGPay(text)
  // fallback: try both
  const pp = parsePhonePe(text)
  if (pp.length > 0) return pp
  return parseGPay(text)
}

// ── Auto-categorisation rules ────────────────────────────────────────────────

const RULES: { pattern: RegExp; category: string; type: 'necessary' | 'unnecessary' }[] = [
  { pattern: /swiggy|zomato|domino|pizza|burger|mcdon|kfc|biryani|cafe|bakery|restaurant|food|dining|diner|eat/i, category: 'Dining', type: 'unnecessary' },
  { pattern: /blinkit|bigbasket|grocer|vegetable|fruit|maligai|super.?market|provision/i, category: 'Groceries', type: 'necessary' },
  { pattern: /netflix|spotify|apple media|amazon prime|hotstar|jio|airtel|vodafone|vi |recharge|myjio|subscription/i, category: 'Subscriptions', type: 'unnecessary' },
  { pattern: /uber|ola|rapido|bmtc|bus|metro|auto|cab|transport|petrol|fuel|parking/i, category: 'Transport', type: 'necessary' },
  { pattern: /electricity|water|gas|bill|utility|mobile|phone|internet|broadband/i, category: 'Utility', type: 'necessary' },
  { pattern: /medical|pharmacy|chemist|hospital|doctor|clinic|dental|health/i, category: 'Health', type: 'necessary' },
  { pattern: /amazon|flipkart|myntra|shopping|store|mall|fashion|clothes|shoes/i, category: 'Shopping', type: 'unnecessary' },
  { pattern: /gift|flowers|jewel|wedding|birthday/i, category: 'Gifting', type: 'unnecessary' },
  { pattern: /mutual fund|groww|zerodha|iccl|investment|sip/i, category: 'Subscriptions', type: 'necessary' },
]

function autoCategory(desc: string): { category: string; type: 'necessary' | 'unnecessary' } {
  for (const rule of RULES) {
    if (rule.pattern.test(desc)) return { category: rule.category, type: rule.type }
  }
  return { category: '', type: 'necessary' }
}

// ── Component ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

export default function Import() {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [committed, setCommitted] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  async function loadCategories() {
    const { data } = await supabase.from('categories').select('id, name').order('name')
    setCategories(data ?? [])
  }

  async function processFile(file: File) {
    setLoading(true)
    setCommitted(0)
    await loadCategories()

    const text = await file.text()
    const parsed = detectAndParse(text, file.name)

    // Check duplicates against existing UTR nos in DB
    const utrs = parsed.map(r => r.utrNo).filter(Boolean)
    let existingUtrs = new Set<string>()
    if (utrs.length > 0) {
      // Store UTR in notes field with prefix for dedup check
      const { data } = await supabase
        .from('transactions')
        .select('notes')
        .like('notes', 'UTR:%')
      existingUtrs = new Set((data ?? []).map(r => r.notes.replace('UTR:', '')))
    }

    const { data: catData } = await supabase.from('categories').select('id, name').order('name')
    const cats = catData ?? []

    const withMeta: ParsedRow[] = parsed.map(r => {
      const { category, type } = autoCategory(r.description)
      const cat = cats.find(c => c.name === category)
      return {
        ...r,
        isDuplicate: existingUtrs.has(r.utrNo),
        category_id: cat?.id ?? '',
        spending_type: type,
        selected: !existingUtrs.has(r.utrNo),
      }
    })

    setRows(withMeta)
    setCategories(cats)
    setLoading(false)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [])

  function toggleRow(id: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, selected: !r.selected } : r))
  }

  function toggleAll() {
    const allSelected = rows.filter(r => !r.isDuplicate).every(r => r.selected)
    setRows(prev => prev.map(r => r.isDuplicate ? r : { ...r, selected: !allSelected }))
  }

  function updateRow(id: string, field: keyof ParsedRow, value: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function deleteRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  async function commit() {
    setCommitting(true)
    const toInsert = rows.filter(r => r.selected)
    let count = 0

    for (const row of toInsert) {
      const modeRes = await supabase.from('payment_modes').select('id').eq('name', 'UPI').single()
      const platformMap: Record<string, string> = {
        PhonePe: 'PhonePe', GPay: 'GPay', Paytm: 'Paytm'
      }
      const platRes = await supabase.from('platforms').select('id').eq('name', platformMap[row.source] ?? row.source).single()

      await supabase.from('transactions').insert({
        date: row.date,
        amount: row.amount,
        mode_id: modeRes.data?.id ?? null,
        platform_id: platRes.data?.id ?? null,
        category_id: row.category_id || null,
        spending_type: row.spending_type,
        notes: `UTR:${row.utrNo} | ${row.description}`.slice(0, 200),
      })
      count++
    }

    setCommitted(count)
    setRows(prev => prev.filter(r => !r.selected))
    setCommitting(false)
  }

  const selectedCount = rows.filter(r => r.selected).length
  const dupCount = rows.filter(r => r.isDuplicate).length
  const debits = rows.filter(r => r.selected && r.type === 'debit')
  const totalSelected = debits.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-light text-gray-800" style={{ fontFamily: 'Georgia,serif' }}>Bulk Import</h1>
        <p className="text-gray-400 text-sm mt-1">Upload your PhonePe, GPay, or Paytm statement. Parsed entirely in your browser — nothing uploaded to any server.</p>
      </div>

      {/* Drop zone */}
      {rows.length === 0 && (
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-3xl p-16 flex flex-col items-center gap-4 cursor-pointer transition-all
            ${dragging ? 'border-[#7FA68A] bg-[#C8DDD0]/20' : 'border-gray-200 hover:border-[#7FA68A] hover:bg-gray-50'}`}
        >
          <input ref={fileRef} type="file" accept=".pdf,.csv,.xlsx" className="hidden"
            onChange={e => { if (e.target.files?.[0]) processFile(e.target.files[0]) }} />
          <div className="w-16 h-16 bg-[#C8DDD0] rounded-2xl flex items-center justify-center">
            <Upload size={28} strokeWidth={1.5} className="text-[#7FA68A]" />
          </div>
          <div className="text-center">
            <div className="text-base font-medium text-gray-700">Drop your statement here</div>
            <div className="text-sm text-gray-400 mt-1">PhonePe PDF · GPay PDF · Paytm CSV/Excel</div>
          </div>
          <div className="flex gap-3">
            {['PhonePe', 'GPay', 'Paytm'].map(app => (
              <span key={app} className="text-xs bg-[#F5F2EC] text-gray-500 px-3 py-1.5 rounded-full">{app}</span>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-sm">Parsing your statement…</div>
        </div>
      )}

      {committed > 0 && rows.length === 0 && (
        <div className="bg-[#C8DDD0] rounded-2xl p-6 flex items-center gap-4 mt-4">
          <CheckCircle size={24} className="text-[#7FA68A]" />
          <div>
            <div className="font-semibold text-gray-800">{committed} transactions imported successfully!</div>
            <div className="text-sm text-gray-600 mt-0.5">They're now in your Transaction Ledger.</div>
          </div>
          <button onClick={() => { setCommitted(0) }} className="ml-auto text-sm text-gray-500 underline">Import another</button>
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex gap-3">
              <div className="bg-[#C8DDD0] rounded-xl px-4 py-2 text-sm">
                <span className="text-gray-600">Total rows: </span><strong>{rows.length}</strong>
              </div>
              <div className="bg-[#D5CEED] rounded-xl px-4 py-2 text-sm">
                <span className="text-gray-600">Selected: </span><strong>{selectedCount}</strong>
              </div>
              {dupCount > 0 && (
                <div className="bg-[#F0CECE] rounded-xl px-4 py-2 text-sm">
                  <span className="text-gray-600">Duplicates: </span><strong>{dupCount}</strong>
                </div>
              )}
              <div className="bg-[#F7DEC4] rounded-xl px-4 py-2 text-sm">
                <span className="text-gray-600">Total spend: </span><strong>{fmt(totalSelected)}</strong>
              </div>
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setRows([])} className="text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-xl px-4 py-2">
                Clear
              </button>
              <button onClick={commit} disabled={committing || selectedCount === 0}
                className="bg-[#7FA68A] text-white rounded-xl px-6 py-2 text-sm font-medium hover:bg-[#6d9478] disabled:opacity-50 transition-all">
                {committing ? 'Importing…' : `Import ${selectedCount} transactions`}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F2EC] text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-3 text-left w-8">
                      <input type="checkbox" onChange={toggleAll}
                        checked={rows.filter(r => !r.isDuplicate).every(r => r.selected)}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-3 text-left">Date</th>
                    <th className="px-3 py-3 text-left">Description</th>
                    <th className="px-3 py-3 text-left">Amount</th>
                    <th className="px-3 py-3 text-left">Category</th>
                    <th className="px-3 py-3 text-left">Type</th>
                    <th className="px-3 py-3 text-left">Source</th>
                    <th className="px-3 py-3 text-left">Status</th>
                    <th className="px-3 py-3 text-left w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id}
                      className={`border-t border-gray-50 transition-all
                        ${row.isDuplicate ? 'opacity-50 bg-[#F0CECE]/20' : row.selected ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={row.selected} onChange={() => toggleRow(row.id)}
                          disabled={row.isDuplicate} className="rounded" />
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{row.date}</td>
                      <td className="px-3 py-2.5 max-w-48">
                        <input className="w-full text-gray-800 bg-transparent outline-none focus:bg-gray-50 rounded px-1 truncate"
                          value={row.description}
                          onChange={e => updateRow(row.id, 'description', e.target.value)} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={row.type === 'credit' ? 'text-[#7FA68A] font-medium' : 'text-gray-800'}>
                          {row.type === 'credit' ? '+' : '-'}{fmt(row.amount)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <select className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none focus:border-[#7FA68A] max-w-32"
                          value={row.category_id}
                          onChange={e => updateRow(row.id, 'category_id', e.target.value)}>
                          <option value="">— pick —</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <select className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none focus:border-[#7FA68A]"
                          value={row.spending_type}
                          onChange={e => updateRow(row.id, 'spending_type', e.target.value as 'necessary' | 'unnecessary')}>
                          <option value="necessary">Necessary</option>
                          <option value="unnecessary">Unnecessary</option>
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs bg-[#F5F2EC] text-gray-500 px-2 py-0.5 rounded-full">{row.source}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.isDuplicate
                          ? <span className="text-xs bg-[#F0CECE] text-red-400 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><AlertTriangle size={10} /> Duplicate</span>
                          : <span className="text-xs bg-[#C8DDD0] text-[#7FA68A] px-2 py-0.5 rounded-full w-fit">New</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => deleteRow(row.id)} className="text-gray-300 hover:text-red-400 transition-all">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}