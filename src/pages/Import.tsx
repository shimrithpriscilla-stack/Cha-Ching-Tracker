import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`

import { useState } from 'react'
import { Upload, AlertTriangle, CheckCircle, Trash2, RefreshCw, Plus } from 'lucide-react'
import { supabase } from '../supabase'

interface ParsedRow {
  id: string
  date: string
  description: string
  amount: number
  type: 'debit' | 'credit'
  utrNo: string
  note: string
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
    const dateLine = lines[i]
    const dateMatch = dateLine.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/)
    if (!dateMatch) { i++; continue }

    const timeLine = lines[i + 1] ?? ''
    if (!timeLine.match(/\d{2}:\d{2}\s*(AM|PM)/i)) { i++; continue }

    let desc = ''
    let j = i + 2
    let utrNo = ''
    let note = ''
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
      if (/^notes?:/i.test(lines[j])) {
        note = lines[j].replace(/^notes?:\s*/i, '').trim()
        j++; continue
      }
      desc += (desc ? ' ' : '') + lines[j]
      j++
    }

    const typeStr = lines[j] ?? ''
    if (typeStr !== 'Credit' && typeStr !== 'Debit') { i = j + 1; continue }
    const type = typeStr === 'Credit' ? 'credit' : 'debit'

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

    const cleanDesc = desc
      .replace(/^Paid to\s+/i, '')
      .replace(/^Received from\s+/i, '')
      .replace(/^Payment Received\s*/i, 'Received')
      .trim()

    rows.push({ id: utrNo || `pp-${Date.now()}-${rows.length}`, date: dateISO, description: cleanDesc, amount, type, utrNo, note, source: 'PhonePe' })
    i = k
  }
  return rows
}

function parseGPay(text: string): Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] {
  const rows: Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] = []
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  let i = 0
  while (i < lines.length) {
    const dateLine = lines[i]
    const dateMatch = dateLine.match(/^(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec),\s+(\d{4})$/)
    if (!dateMatch) { i++; continue }

    const timeLine = lines[i + 1] ?? ''
    if (!timeLine.match(/\d{2}:\d{2}\s*(AM|PM)/i)) { i++; continue }

    const descLine = lines[i + 2] ?? ''
    let type: 'debit' | 'credit' = 'debit'
    if (descLine.toLowerCase().startsWith('received from')) type = 'credit'
    else if (descLine.toLowerCase().startsWith('self transfer')) type = 'debit'

    const upiLine = lines[i + 3] ?? ''
    const upiMatch = upiLine.match(/UPI Transaction ID:\s*(\S+)/)
    const utrNo = upiMatch ? upiMatch[1] : ''

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

    rows.push({ id: utrNo || `gp-${Date.now()}-${rows.length}`, date: dateISO, description: cleanDesc, amount, type, utrNo, note: '', source: 'GPay' })
    i = k + 1
  }
  return rows
}

function parsePaytm(text: string): Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] {
  const rows: Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] = []
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  let i = 0
  while (i < lines.length) {
    const dateLine = lines[i]
    const dateMatch = dateLine.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/)
    if (!dateMatch) { i++; continue }

    const timeLine = lines[i + 1] ?? ''
    if (!timeLine.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) { i++; continue }

    let desc = ''
    let utrNo = ''
    let note = ''
    let type: 'debit' | 'credit' = 'debit'
    let amtStr = ''
    let j = i + 2

    while (j < lines.length) {
      const l = lines[j]
      if (l.startsWith('UPI ID:')) { j++; continue }
      if (l.startsWith('UPI Ref No:')) {
        utrNo = l.replace('UPI Ref No:', '').trim()
        j++; continue
      }
      if (/^notes?:/i.test(l)) { note = l.replace(/^notes?:\s*/i, '').trim(); j++; continue }
      if (l.startsWith('Tag:') || l.startsWith('#')) { j++; continue }
      if (l.startsWith('Axis Bank') || l.startsWith('- Rs.') || l.startsWith('+ Rs.')) {
        if (l.startsWith('- Rs.')) { type = 'debit'; amtStr = l.replace('- Rs.', '').replace(/,/g, '').trim() }
        if (l.startsWith('+ Rs.')) { type = 'credit'; amtStr = l.replace('+ Rs.', '').replace(/,/g, '').trim() }
        j++
        if (!amtStr && lines[j]) { amtStr = lines[j].replace(/,/g, '').trim(); j++ }
        break
      }
      if (l.startsWith('Page ') || l.startsWith('For any queries') || l.startsWith('Passbook')) break
      if (!desc) desc = l
      else desc += ' ' + l
      j++
    }

    if (!amtStr || !utrNo) { i = j; continue }
    const amount = parseFloat(amtStr)
    if (isNaN(amount) || amount <= 0) { i = j; continue }

    const currentYear = new Date().getFullYear()
    const monthNum = new Date(`${dateMatch[2]} 1`).getMonth()
    const day = parseInt(dateMatch[1])
    const dateObj = new Date(currentYear, monthNum, day)
    if (dateObj > new Date()) dateObj.setFullYear(currentYear - 1)
    const dateISO = dateObj.toISOString().slice(0, 10)

    const cleanDesc = desc.replace(/^Paid to\s+/i, '').replace(/^Received from\s+/i, '').trim()
    rows.push({ id: utrNo, date: dateISO, description: cleanDesc, amount, type, utrNo, note, source: 'Paytm' })
    i = j
  }
  return rows
}

function detectAndParse(text: string): Omit<ParsedRow, 'isDuplicate' | 'category_id' | 'spending_type' | 'selected'>[] {
  if (text.includes('Paytm Statement') || text.includes('Passbook Payments History')) return parsePaytm(text)
  if (text.includes('PhonePe') || text.includes('UTR No')) return parsePhonePe(text)
  if (text.includes('Google Pay') || text.includes('UPI Transaction ID')) return parseGPay(text)
  const pp = parsePhonePe(text)
  if (pp.length > 0) return pp
  return parseGPay(text)
}

// ── Auto-categorisation rules ─────────────────────────────────────────────────

const RULES: { pattern: RegExp; category: string; type: 'necessary' | 'unnecessary' }[] = [
  { pattern: /swiggy|zomato|domino|pizza|burger|mcdon|kfc|biryani|cafe|bakery|restaurant|food|dining|diner|eat/i, category: 'Dining', type: 'unnecessary' },
  { pattern: /blinkit|bigbasket|grocer|vegetable|fruit|maligai|super.?market|provision/i, category: 'Groceries', type: 'necessary' },
  { pattern: /netflix|spotify|apple media|amazon prime|hotstar|jio|airtel|vodafone|vi |recharge|myjio|subscription/i, category: 'Subscriptions', type: 'unnecessary' },
  { pattern: /uber|ola|rapido|bmtc|bus|metro|auto|cab|transport|petrol|fuel|parking/i, category: 'Transport', type: 'necessary' },
  { pattern: /electricity|water|gas|bill|utility|mobile|phone|internet|broadband/i, category: 'Utility', type: 'necessary' },
  { pattern: /medical|pharmacy|chemist|hospital|doctor|clinic|dental|health/i, category: 'Health', type: 'necessary' },
  { pattern: /amazon|flipkart|myntra|shopping|store|mall|fashion|clothes|shoes/i, category: 'Shopping', type: 'unnecessary' },
  { pattern: /gift|flowers|jewel|wedding|birthday/i, category: 'Gifting', type: 'unnecessary' },
  { pattern: /mutual fund|groww|zerodha|iccl|investment|sip/i, category: 'Investments', type: 'necessary' },
]

function autoCategory(desc: string): { category: string; type: 'necessary' | 'unnecessary' } {
  for (const rule of RULES) {
    if (rule.pattern.test(desc)) return { category: rule.category, type: rule.type }
  }
  return { category: '', type: 'necessary' }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

// ── Inline category creator ───────────────────────────────────────────────────

interface InlineCatProps {
  rowId: string
  categories: Category[]
  value: string
  onSelect: (rowId: string, catId: string) => void
  onNewCategory: (cat: Category) => void
}

function CategorySelect({ rowId, categories, value, onSelect, onNewCategory }: InlineCatProps) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [catError, setCatError] = useState('')

  async function createCategory(nameOverride?: string) {
    const name = (nameOverride ?? newName).trim()
    if (!name) return
    setCatError('')
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setCatError('Not logged in'); setSaving(false); return }
    const { data, error } = await supabase
        .from('categories')
        .insert({ name, user_id: user.id })
        .select('id, name')
        .single()
      if (error) { setCatError(error.message); setSaving(false); return }
      if (!data) { setCatError('No data returned'); setSaving(false); return }
      onNewCategory(data)
      onSelect(rowId, data.id)
      setAdding(false)
      setNewName('')
    } catch (e: any) {
      setCatError(e.message ?? 'Unknown error')
    }
    setSaving(false)
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className="text-xs border border-[#7FA68A] rounded-lg px-2 py-1 outline-none w-28"
            placeholder="e.g. Miscellaneous"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); createCategory() }
              if (e.key === 'Escape') { setAdding(false); setNewName(''); setCatError('') }
            }}
            onBlur={e => {
              // if focus moves to a sibling button, let it handle the click
              const related = e.relatedTarget as HTMLElement | null
              if (related?.dataset?.cataction) return
              // otherwise just keep the input open
            }}
          />
          <button
            data-cataction="save"
            type="button"
            disabled={saving}
            className="text-xs bg-[#7FA68A] text-white px-2 py-1 rounded-lg disabled:opacity-50 flex-shrink-0"
            onClick={() => createCategory()}
          >
            {saving ? '…' : 'Save'}
          </button>
          <button
            data-cataction="cancel"
            type="button"
            className="text-xs text-gray-400 hover:text-gray-600 px-1 flex-shrink-0"
            onClick={() => { setAdding(false); setNewName(''); setCatError('') }}
          >
            ✕
          </button>
        </div>
        {catError && <div className="text-xs text-red-500">{catError}</div>}
      </div>
    )
  }

  return (
    <select
      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none focus:border-[#7FA68A] max-w-36"
      value={value}
      onChange={e => {
        if (e.target.value === '__add__') {
          setAdding(true)
        } else {
          onSelect(rowId, e.target.value)
        }
      }}
    >
      <option value="">-- pick --</option>
      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      <option value="__add__">✚ Add new…</option>
    </select>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Import() {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('Reading your statement…')
  const [committing, setCommitting] = useState(false)
  const [committed, setCommitted] = useState(0)
  const [error, setError] = useState('')
  const [refreshingCats, setRefreshingCats] = useState(false)

  async function refreshCategories() {
    setRefreshingCats(true)
    const { data } = await supabase.from('categories').select('id, name').order('name')
    if (data) setCategories(data)
    setRefreshingCats(false)
  }

  async function processFile(file: File) {
    setLoading(true)
    setError('')
    setCommitted(0)
    setLoadingMsg('Reading your statement…')

    let text = ''

    try {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setLoadingMsg('Extracting text from PDF…')
        const arrayBuffer = await file.arrayBuffer()
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
        const pdf = await loadingTask.promise
        setLoadingMsg(`Processing ${pdf.numPages} pages…`)
        const pages: string[] = []
        for (let p = 1; p <= pdf.numPages; p++) {
          setLoadingMsg(`Reading page ${p} of ${pdf.numPages}…`)
          const page = await pdf.getPage(p)
          const content = await page.getTextContent()
          const pageText = content.items
            .map((item: any) => ('str' in item ? item.str : ''))
            .join(' ')
          pages.push(pageText)
        }
        const rawText = pages.join(' ')
        text = rawText
          .replace(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/g, '\n$&')
          .replace(/(\d{2}:\d{2}\s*(?:AM|PM))/gi, '\n$1')
          .replace(/(Paid to )/g, '\nPaid to ')
          .replace(/(Received from )/g, '\nReceived from ')
          .replace(/(Transaction ID\s*:)/g, '\nTransaction ID :')
          .replace(/(UTR No\s*:)/g, '\nUTR No :')
          .replace(/(Debited from )/g, '\nDebited from ')
          .replace(/(Credited to )/g, '\nCredited to ')
          .replace(/\b(Debit)\s+(INR)/g, '\nDebit\nINR ')
          .replace(/\b(Credit)\s+(INR)/g, '\nCredit\nINR ')
          .replace(/\bINR\s+(\d)/g, '\nINR $1')
          .replace(/(UPI Transaction ID:\s*)(\S)/g, '\nUPI Transaction ID: $2')
          .replace(/(₹)(\d)/g, '\n₹$2')
          .replace(/(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec),\s+(\d{4})/g, '\n$1 $2, $3')
      } else {
        setLoadingMsg('Reading file…')
        text = await file.text()
      }
    } catch (err) {
      setError('Could not read this file: ' + (err as Error).message)
      setLoading(false)
      return
    }

    if (!text || text.trim().length < 50) {
      setError('No text could be extracted from this file. Try the unlocked PDF version.')
      setLoading(false)
      return
    }

    setLoadingMsg('Parsing transactions…')
    const parsed = detectAndParse(text)

    if (parsed.length === 0) {
      const detected = text.includes('PhonePe') ? 'PhonePe' : text.includes('Google Pay') ? 'GPay' : text.includes('Paytm') ? 'Paytm' : 'Unknown'
      setError(`Parsed 0 transactions. Detected format: ${detected}. Check if the PDF is password-protected or try a different file.`)
      setLoading(false)
      return
    }

    setLoadingMsg('Checking for duplicates…')
    const utrs = parsed.map(r => r.utrNo).filter(Boolean)
    let existingUtrs = new Set<string>()
    if (utrs.length > 0) {
      // Fetch all stored UTRs from the notes field (stored as "UTR:XXXXXXXXX | source")
      // We pull all notes containing "UTR:" and extract the numbers client-side
      const { data } = await supabase
        .from('transactions')
        .select('notes')
        .like('notes', '%UTR:%')
      existingUtrs = new Set(
        (data ?? [])
          .flatMap(r => {
            const m = (r.notes ?? '').match(/UTR:(\S+)/)
            return m ? [m[1].replace(/\|.*$/, '').trim()] : []
          })
      )
    }

    setLoadingMsg('Loading categories & note history…')
    const [catResult, noteHistoryResult] = await Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      // Fetch merchant→most recent note mapping for auto-suggest
      supabase
        .from('transactions')
        .select('merchant, notes, created_at')
        .not('notes', 'is', null)
        .not('notes', 'eq', '')
        .order('created_at', { ascending: false })
        .limit(500),
    ])
    const cats = catResult.data ?? []

    // Build merchant → last user note map (strip UTR/source metadata parts)
    const merchantNoteMap = new Map<string, string>()
    for (const row of (noteHistoryResult.data ?? [])) {
      const merchant = (row.merchant ?? '').trim().toLowerCase()
      if (!merchant) continue
      if (merchantNoteMap.has(merchant)) continue // already have most recent
      // Extract the user-written note part (before the first " | UTR:" or " | PhonePe" etc.)
      const noteParts = (row.notes ?? '').split(' | ')
      const userNote = noteParts.find(p => !p.startsWith('UTR:') && p !== 'PhonePe' && p !== 'GPay' && p !== 'Paytm' && p.trim() !== '')
      if (userNote) merchantNoteMap.set(merchant, userNote.trim())
    }

    const withMeta: ParsedRow[] = parsed.map(r => {
      const { category, type } = autoCategory(r.description)
      const cat = cats.find(c => c.name === category)
      // Auto-suggest note from history if not already parsed from PDF
      const suggestedNote = r.note || merchantNoteMap.get(r.description.trim().toLowerCase()) || ''
      return {
        ...r,
        note: suggestedNote,
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

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function toggleAll() {
    const nonDup = rows.filter(r => !r.isDuplicate)
    const allSelected = nonDup.every(r => r.selected)
    setRows(rows.map(r => r.isDuplicate ? r : { ...r, selected: !allSelected }))
  }

  function toggleRow(id: string) {
    setRows(rows.map(r => r.id === id ? { ...r, selected: !r.selected } : r))
  }

  function updateRow(id: string, field: string, value: string) {
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function deleteRow(id: string) {
    setRows(rows.filter(r => r.id !== id))
  }

  function handleNewCategory(cat: Category) {
    setCategories(prev => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function commit() {
    const toInsert = rows.filter(r => r.selected && !r.isDuplicate)
    if (toInsert.length === 0) return
    setCommitting(true)

    const records = toInsert.map(r => ({
      date: r.date,
      merchant: r.description,
      amount: r.amount,
      spending_type: r.spending_type,
      category_id: r.category_id || null,
      notes: [r.note, r.utrNo ? `UTR:${r.utrNo}` : '', r.source].filter(Boolean).join(' | '),
    }))

    const { error: insertError } = await supabase.from('transactions').insert(records)
    setCommitting(false)
    if (insertError) {
      setError('Import failed: ' + insertError.message)
      return
    }
    setCommitted(toInsert.length)
    setRows([])
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

      {/* Error message */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 rounded-2xl px-4 py-3 text-sm flex items-start gap-3">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Drop zone */}
      {rows.length === 0 && !loading && committed === 0 && (
        <label htmlFor="file-upload"
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          className={`border-2 border-dashed rounded-3xl p-16 flex flex-col items-center gap-4 cursor-pointer transition-all
            ${dragging ? 'border-[#7FA68A] bg-[#C8DDD0]/20' : 'border-gray-200 hover:border-[#7FA68A] hover:bg-gray-50'}`}
        >
          <input id="file-upload" type="file" accept=".pdf,.csv,.xlsx" className="hidden"
            onChange={e => { if (e.target.files?.[0]) processFile(e.target.files[0]) }} />
          <div className="w-16 h-16 bg-[#C8DDD0] rounded-2xl flex items-center justify-center">
            <Upload size={28} strokeWidth={1.5} className="text-[#7FA68A]" />
          </div>
          <div className="text-center">
            <div className="text-base font-medium text-gray-700">Drop your statement here</div>
            <div className="text-sm text-gray-400 mt-1">or click to browse</div>
            <div className="text-xs text-gray-400 mt-1">PhonePe PDF · GPay PDF · Paytm CSV/Excel/PDF</div>
          </div>
          <div className="flex gap-3">
            {['PhonePe', 'GPay', 'Paytm'].map(app => (
              <span key={app} className="text-xs bg-[#F5F2EC] text-gray-500 px-3 py-1.5 rounded-full">{app}</span>
            ))}
          </div>
        </label>
      )}

      {/* Loading spinner */}
      {loading && (
        <div className="text-center py-20 flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#C8DDD0] border-t-[#7FA68A] rounded-full animate-spin" />
          <div className="text-gray-600 text-sm font-medium">{loadingMsg}</div>
          <div className="text-gray-400 text-xs">This may take a few seconds for large PDFs</div>
        </div>
      )}

      {/* Success message */}
      {committed > 0 && rows.length === 0 && (
        <div className="bg-[#C8DDD0] rounded-2xl p-6 flex items-center gap-4">
          <CheckCircle size={24} className="text-[#7FA68A]" />
          <div>
            <div className="font-semibold text-gray-800">{committed} transactions imported successfully!</div>
            <div className="text-sm text-gray-600 mt-0.5">They're now in your Transaction Ledger.</div>
          </div>
          <button onClick={() => setCommitted(0)} className="ml-auto text-sm text-gray-500 underline">
            Import another
          </button>
        </div>
      )}

      {/* Staging table */}
      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex gap-3 flex-wrap">
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
              <button
                onClick={refreshCategories}
                disabled={refreshingCats}
                title="Refresh categories from database"
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#7FA68A] border border-gray-200 rounded-xl px-3 py-2 transition-all disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshingCats ? 'animate-spin' : ''} />
                Refresh categories
              </button>
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setRows([]); setError('') }}
                className="text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-xl px-4 py-2">
                Clear
              </button>
              <button onClick={commit} disabled={committing || selectedCount === 0}
                className="bg-[#7FA68A] text-white rounded-xl px-6 py-2 text-sm font-medium hover:bg-[#6d9478] disabled:opacity-50 transition-all">
                {committing ? 'Importing…' : `Import ${selectedCount} transactions`}
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F2EC] text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-3 text-left w-8">
                      <input type="checkbox" onChange={toggleAll}
                        checked={rows.filter(r => !r.isDuplicate).length > 0 && rows.filter(r => !r.isDuplicate).every(r => r.selected)}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-3 text-left">Date</th>
                    <th className="px-3 py-3 text-left">Description</th>
                    <th className="px-3 py-3 text-left">Notes</th>
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
                      <td className="px-3 py-2.5 max-w-40">
                        <input className={`w-full text-xs rounded px-1 truncate outline-none placeholder:text-gray-300
                          ${row.note
                            ? 'text-gray-700 bg-[#F5F2EC] focus:bg-[#EDE9E0]'
                            : 'text-gray-500 bg-transparent focus:bg-gray-50'}`}
                          placeholder="add note…"
                          title={row.note ? 'Auto-suggested from previous import' : ''}
                          value={row.note}
                          onChange={e => updateRow(row.id, 'note', e.target.value)} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={row.type === 'credit' ? 'text-[#7FA68A] font-medium' : 'text-gray-800'}>
                          {row.type === 'credit' ? '+' : '-'}{fmt(row.amount)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <CategorySelect
                          rowId={row.id}
                          categories={categories}
                          value={row.category_id}
                          onSelect={(id, catId) => updateRow(id, 'category_id', catId)}
                          onNewCategory={handleNewCategory}
                        />
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
