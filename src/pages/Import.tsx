import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`

import React, { useState, useEffect } from 'react'
import { Upload, AlertTriangle, CheckCircle, Trash2, RefreshCw, ArrowUpDown, RotateCcw, Pencil, ChevronDown } from 'lucide-react'
import { supabase } from '../supabase'

interface SoftDupMatch {
  date: string
  merchant: string
  amount: number
  notes: string
}

interface ParsedRow {
  id: string
  date: string
  description: string
  amount: number
  type: 'debit' | 'credit'
  utrNo: string
  note: string
  source: string
  account: string          // e.g. "SBI", "Niyo SBM", "Axis MyZone", "Axis Neo"
  isDuplicate: boolean
  isSoftDuplicate: boolean
  softDupMatch: SoftDupMatch | null
  category_id: string
  spending_type: 'necessary' | 'unnecessary' | 'credit'
  selected: boolean
}

interface Category { id: string; name: string }
interface PaymentMode { id: string; name: string }

type SortField = 'date' | 'amount'
type SortDir = 'asc' | 'desc'

// ── Account detection helpers ─────────────────────────────────────────────────

/**
 * Normalize a raw account string (from "Debited from X" lines or bank labels)
 * into a clean account name matching the source_accounts table.
 */
function normalizeAccountName(raw: string): string {
  const s = raw.toLowerCase()
  if (/niyo|sbm bank|sbm/i.test(s)) return 'Niyo SBM'
  if (/sbi|state bank/i.test(s)) return 'SBI'
  if (/myzone/i.test(s)) return 'Axis MyZone'
  if (/neo/i.test(s)) return 'Axis Neo'
  if (/axis/i.test(s)) return 'Axis MyZone'
  // Return the raw trimmed value as fallback so we don't lose info
  return raw.trim()
}

/**
 * Document-level fallback: scan full text for account keywords.
 * Used only when per-transaction signals are absent.
 */
function detectPhonePayAccount(fullText: string): string {
  if (/niyo|SBM|sbm bank/i.test(fullText)) return 'Niyo SBM'
  if (/SBI|State Bank/i.test(fullText)) return 'SBI'
  return ''
}

function detectGPayAccount(fullText: string): string {
  if (/niyo|SBM|sbm bank/i.test(fullText)) return 'Niyo SBM'
  if (/SBI|State Bank/i.test(fullText)) return 'SBI'
  return ''
}

/**
 * Paytm: detect Axis MyZone vs Axis Neo from card number hints or card label.
 * Paytm statements often say "AXIS BANK - ...MyZone" or show last 4 digits
 * that differ between the two cards. We look for card-name keywords.
 */
function detectPaytmAccount(fullText: string): string {
  if (/myzone/i.test(fullText)) return 'Axis MyZone'
  if (/neo/i.test(fullText)) return 'Axis Neo'
  if (/axis/i.test(fullText)) return 'Axis MyZone'
  return ''
}

// ── Date helpers ─────────────────────────────────────────────────────────────
/**
 * Parse a date string and return a YYYY-MM-DD string using LOCAL date components.
 * Using new Date(str).toISOString() would give UTC midnight, which shifts the
 * date backward by one day in IST (UTC+5:30) — e.g. "Oct 1, 2026" → "Sep 30".
 * This function always uses the local year/month/day, so the date is stable.
 */
function parseLocalDate(str: string): string {
  const d = new Date(str)
  if (isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Parsers ──────────────────────────────────────────────────────────────────

function parsePhonePe(text: string, account: string): Omit<ParsedRow, 'isDuplicate' | 'isSoftDuplicate' | 'softDupMatch' | 'category_id' | 'spending_type' | 'selected'>[] {
  const rows: Omit<ParsedRow, 'isDuplicate' | 'isSoftDuplicate' | 'softDupMatch' | 'category_id' | 'spending_type' | 'selected'>[] = []
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
    // Per-transaction account: capture from "Debited from X" / "Credited to X" lines
    let rowAccount = ''
    while (j < lines.length) {
      if (lines[j].startsWith('Transaction ID')) { j++; continue }
      if (lines[j].startsWith('UTR No')) {
        utrNo = lines[j].replace('UTR No :', '').replace('UTR No:', '').trim()
        j++; continue
      }
      if (lines[j].startsWith('Debited from')) {
        // e.g. "Debited from XXXXXX1234" or "Debited from SBI Savings Account"
        const rawAccount = lines[j].replace(/^Debited from\s*/i, '').trim()
        if (rawAccount) rowAccount = normalizeAccountName(rawAccount)
        j++; continue
      }
      if (lines[j].startsWith('Credited to')) {
        // Credit transactions: "Credited to XXXXXX1234" — still captures the bank
        const rawAccount = lines[j].replace(/^Credited to\s*/i, '').trim()
        if (rawAccount) rowAccount = normalizeAccountName(rawAccount)
        j++; continue
      }
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

    const dateISO = parseLocalDate(dateLine)
    if (!dateISO) { i = k; continue }

    const cleanDesc = desc
      .replace(/^Paid to\s+/i, '')
      .replace(/^Received from\s+/i, '')
      .replace(/^Payment Received\s*/i, 'Received')
      .trim()

    // Use per-row account if captured, else fall back to document-level account
    const finalAccount = rowAccount || account
    rows.push({ id: utrNo || `pp-${Date.now()}-${rows.length}`, date: dateISO, description: cleanDesc, amount, type, utrNo, note, source: 'PhonePe', account: finalAccount })
    i = k
  }
  return rows
}

function parseGPay(text: string, account: string): Omit<ParsedRow, 'isDuplicate' | 'isSoftDuplicate' | 'softDupMatch' | 'category_id' | 'spending_type' | 'selected'>[] {
  const rows: Omit<ParsedRow, 'isDuplicate' | 'isSoftDuplicate' | 'softDupMatch' | 'category_id' | 'spending_type' | 'selected'>[] = []
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

    // GPay statements typically show bank/account name in lines after the UPI Transaction ID
    // e.g. "SBI Savings Account" or "Niyo SBM" on lines i+4 to i+7 before the ₹ amount line
    let amtStr = ''
    let rowAccount = ''
    let k = i + 4
    while (k < lines.length && k < i + 10) {
      const l = lines[k]
      if (l.startsWith('₹')) { amtStr = l.replace('₹', '').replace(/,/g, '').trim(); k++; break }
      // Detect bank name lines before we hit the amount
      if (!amtStr && !l.match(/^\d/) && !l.startsWith('UPI') && l.length > 2) {
        const candidate = normalizeAccountName(l)
        // Only accept if it matches a known account — avoids picking up merchant names
        if (['Niyo SBM', 'SBI', 'Axis MyZone', 'Axis Neo'].includes(candidate)) {
          rowAccount = candidate
        }
      }
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
    const dateISO = parseLocalDate(dateStr)
    if (!dateISO) { i = k + 1; continue }

    // Use per-row account if captured, else fall back to document-level account
    const finalAccount = rowAccount || account
    rows.push({ id: utrNo || `gp-${Date.now()}-${rows.length}`, date: dateISO, description: cleanDesc, amount, type, utrNo, note: '', source: 'GPay', account: finalAccount })
    i = k
  }
  return rows
}

function parsePaytm(text: string, account: string): Omit<ParsedRow, 'isDuplicate' | 'isSoftDuplicate' | 'softDupMatch' | 'category_id' | 'spending_type' | 'selected'>[] {
  const rows: Omit<ParsedRow, 'isDuplicate' | 'isSoftDuplicate' | 'softDupMatch' | 'category_id' | 'spending_type' | 'selected'>[] = []
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
    let rowAccount = ''
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
        // "Axis Bank - MyZone Credit Card" or "Axis Bank - Neo Credit Card" or "Axis Bank"
        if (l.startsWith('Axis Bank')) {
          if (/myzone/i.test(l)) rowAccount = 'Axis MyZone'
          else if (/neo/i.test(l)) rowAccount = 'Axis Neo'
          else rowAccount = account // fall back to document-level (which detects MyZone vs Neo)
        }
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
    // Use local date components directly — toISOString() would give UTC midnight
    // which shifts the date back by one day in IST (UTC+5:30)
    const y = dateObj.getFullYear()
    const mo = String(dateObj.getMonth() + 1).padStart(2, '0')
    const d = String(dateObj.getDate()).padStart(2, '0')
    const dateISO = `${y}-${mo}-${d}`

    const cleanDesc = desc.replace(/^Paid to\s+/i, '').replace(/^Received from\s+/i, '').trim()
    // Use per-row account if captured, else document-level fallback
    const finalAccount = rowAccount || account
    rows.push({ id: utrNo, date: dateISO, description: cleanDesc, amount, type, utrNo, note, source: 'Paytm', account: finalAccount })
    i = j
  }
  return rows
}

function parsePhonePeCSV(text: string): Omit<ParsedRow, 'isDuplicate' | 'isSoftDuplicate' | 'softDupMatch' | 'category_id' | 'spending_type' | 'selected'>[] {
  const rows: Omit<ParsedRow, 'isDuplicate' | 'isSoftDuplicate' | 'softDupMatch' | 'category_id' | 'spending_type' | 'selected'>[] = []
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  // Find the header row — "Date,Time,Transaction Details,..."
  const headerIdx = lines.findIndex(l => l.startsWith('Date,') && l.includes('Transaction Details'))
  if (headerIdx === -1) return rows

  // Detect account from phone number line at top (PhonePe CSV has no card info, just SBI/Niyo clues)
  const account = detectPhonePayAccount(lines.slice(0, headerIdx).join(' '))

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    // CSV fields: Date,Time,Transaction Details,Transaction ID,UTR,Transaction Type,Credit/debit instrument,Amount
    const parts = line.split(',')
    if (parts.length < 8) continue

    const dateStr = parts[0].trim()         // 2025-10-05
    const details = parts[2].trim()          // "Paid to New Tasty Bekery"
    const utrNo = parts[4].trim()            // UTR number
    const txnType = parts[5].trim()          // "Credit" or "Debit"
    const amtStr = parts[parts.length - 1].trim()  // Amount (last field, handles commas in merchant name)

    if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) continue
    if (!txnType.match(/^(Credit|Debit)$/i)) continue

    const amount = parseFloat(amtStr.replace(/,/g, ''))
    if (isNaN(amount) || amount <= 0) continue

    const type = txnType.toLowerCase() === 'credit' ? 'credit' : 'debit'

    const cleanDesc = details
      .replace(/^Paid to\s+/i, '')
      .replace(/^Received from\s+/i, '')
      .trim()

    rows.push({
      id: utrNo || `ppcsv-${Date.now()}-${rows.length}`,
      date: dateStr,
      description: cleanDesc,
      amount,
      type,
      utrNo,
      note: '',
      source: 'PhonePe',
      account,
    })
  }
  return rows
}

function detectAndParse(text: string): Omit<ParsedRow, 'isDuplicate' | 'isSoftDuplicate' | 'softDupMatch' | 'category_id' | 'spending_type' | 'selected'>[] {
  if (text.includes('Paytm Statement') || text.includes('Passbook Payments History')) {
    return parsePaytm(text, detectPaytmAccount(text))
  }
  // PhonePe CSV — has a header row starting with "Date,Time,Transaction Details"
  if (text.includes('Transaction Details') && text.includes('Transaction Type')) {
    return parsePhonePeCSV(text)
  }
  if (text.includes('PhonePe') || text.includes('UTR No')) {
    return parsePhonePe(text, detectPhonePayAccount(text))
  }
  if (text.includes('Google Pay') || text.includes('UPI Transaction ID')) {
    return parseGPay(text, detectGPayAccount(text))
  }
  const pp = parsePhonePe(text, detectPhonePayAccount(text))
  if (pp.length > 0) return pp
  return parseGPay(text, detectGPayAccount(text))
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

function fmtDate(iso: string) {
  if (!iso) return ""
  const [y, m, d] = iso.split("-")
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  return `${d}-${months[parseInt(m, 10) - 1]}-${y}`
}

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

      const { data: existing } = await supabase
        .from('categories')
        .select('id, name')
        .ilike('name', name)
        .limit(1)
        .single()

      if (existing) {
        onNewCategory(existing)
        onSelect(rowId, existing.id)
        setAdding(false)
        setNewName('')
        setSaving(false)
        return
      }

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
              const related = e.relatedTarget as HTMLElement | null
              if (related?.dataset?.cataction) return
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

interface ImportBatch {
  batchId: string
  count: number
  importedAt: string
  label: string   // e.g. "PhonePe · 12 txns"
}

const BATCH_HISTORY_KEY = 'import_batch_history'
const IMPORT_DRAFT_KEY = 'cc_import_draft'
const COL_WIDTHS_KEY = 'cc_import_col_widths'

interface ColWidths {
  checkbox: number
  date: number
  description: number
  notes: number
  amount: number
  category: number
  type: number
  account: number
  status: number
  del: number
}

const DEFAULT_COL_WIDTHS: ColWidths = {
  checkbox: 36,
  date: 120,
  description: 240,
  notes: 160,
  amount: 110,
  category: 170,
  type: 130,
  account: 130,
  status: 100,
  del: 36,
}

function loadColWidths(): ColWidths {
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY)
    if (!raw) return DEFAULT_COL_WIDTHS
    return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(raw) }
  } catch { return DEFAULT_COL_WIDTHS }
}

function saveColWidths(w: ColWidths) {
  try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(w)) } catch {}
}

function loadDraft(): ParsedRow[] {
  try {
    const raw = localStorage.getItem(IMPORT_DRAFT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveDraft(rows: ParsedRow[]) {
  try {
    if (rows.length === 0) {
      localStorage.removeItem(IMPORT_DRAFT_KEY)
    } else {
      localStorage.setItem(IMPORT_DRAFT_KEY, JSON.stringify(rows))
    }
  } catch {}
}

function clearDraft() {
  try { localStorage.removeItem(IMPORT_DRAFT_KEY) } catch {}
}

function loadBatchHistory(): ImportBatch[] {
  try {
    const raw = localStorage.getItem(BATCH_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveBatchHistory(batches: ImportBatch[]) {
  try { localStorage.setItem(BATCH_HISTORY_KEY, JSON.stringify(batches.slice(0, 20))) } catch {}
}

// ── Resizable column handle ──────────────────────────────────────────────────
interface ResizeHandleProps {
  currentWidth: number
  onWidthChange: (newWidth: number) => void
}
function ResizeHandle({ currentWidth, onWidthChange }: ResizeHandleProps) {
  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = currentWidth
    function onMove(ev: MouseEvent) {
      const newWidth = Math.max(36, startWidth + (ev.clientX - startX))
      onWidthChange(newWidth)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 5,
        cursor: 'col-resize',
        userSelect: 'none',
        zIndex: 1,
      }}
      className="hover:bg-[#7FA68A]/40 active:bg-[#7FA68A]/60 transition-colors"
    />
  )
}

export default function Import() {
  const [rows, setRows] = useState<ParsedRow[]>(() => loadDraft())
  const [categories, setCategories] = useState<Category[]>([])
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([])
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('Reading your statement…')
  const [committing, setCommitting] = useState(false)
  const [committed, setCommitted] = useState(0)
  const [error, setError] = useState('')
  const [refreshingCats, setRefreshingCats] = useState(false)
  const [batchHistory, setBatchHistory] = useState<ImportBatch[]>(() => loadBatchHistory())
  const [undoing, setUndoing] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // Sort state
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Filter state (multi-select via Set)
  const [filterSources, setFilterSources] = useState<Set<string>>(new Set())
  const [filterAccounts, setFilterAccounts] = useState<Set<string>>(new Set())
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  // Hide duplicates toggle — when true, hides all rows marked as hard or soft duplicate
  const [hideDuplicates, setHideDuplicates] = useState(false)

  // Bulk edit state — values to apply to all selected visible rows
  const [bulkCategory, setBulkCategory] = useState('')
  const [bulkSpendingType, setBulkSpendingType] = useState('')
  const [bulkAccount, setBulkAccount] = useState('')
  const [bulkSource, setBulkSource] = useState('')
  const [bulkType, setBulkType] = useState('')
  const [bulkDate, setBulkDate] = useState('')

  // Column widths — persisted to localStorage
  const [colWidths, setColWidths] = useState<ColWidths>(() => loadColWidths())

  function updateColWidth(col: keyof ColWidths, width: number) {
    setColWidths(prev => {
      const next = { ...prev, [col]: Math.max(36, width) }
      saveColWidths(next)
      return next
    })
  }

  // Persist parsed rows to localStorage on every change so reload doesn't lose work
  useEffect(() => {
    saveDraft(rows)
  }, [rows])

  // Load categories from DB if rows were restored from draft (so dropdowns work)
  useEffect(() => {
    if (rows.length > 0 && categories.length === 0) {
      supabase.from('categories').select('id, name').order('name').then(({ data }) => {
        if (data) setCategories(data)
      })
      supabase.from('payment_modes').select('id, name').order('name').then(({ data }) => {
        if (data) setPaymentModes(data)
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'amount' ? 'desc' : 'asc')
    }
  }

  function toggleFilter(set: Set<string>, setter: (s: Set<string>) => void, val: string) {
    const next = new Set(set)
    if (next.has(val)) next.delete(val)
    else next.add(val)
    setter(next)
  }

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
    // Reset filters on new file
    setFilterSources(new Set())
    setFilterAccounts(new Set())
    setFilterTypes(new Set())
    setHideDuplicates(false)

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

    // Soft-duplicate check: fetch existing transactions for dates that appear in parsed rows.
    // A soft dup = same date + same amount + similar merchant (no UTR to compare).
    const parsedDates = [...new Set(parsed.map(r => r.date))]
    const { data: existingForDates } = await supabase
      .from('transactions')
      .select('date, merchant, amount, notes')
      .in('date', parsedDates)

    const softDupCandidates = existingForDates ?? []

    function merchantSimilar(a: string, b: string): boolean {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
      const na = norm(a), nb = norm(b)
      if (na === nb) return true
      // Check if one contains the other (≥4 chars to avoid noise)
      const longer = na.length >= nb.length ? na : nb
      const shorter = na.length < nb.length ? na : nb
      return shorter.length >= 4 && longer.includes(shorter)
    }

    function findSoftDup(r: typeof parsed[0]): SoftDupMatch | null {
      // Only apply soft-dup check when there's no UTR (i.e. would be a manual entry match)
      if (r.utrNo) return null
      const match = softDupCandidates.find(
        e => e.date === r.date &&
          Math.abs(e.amount) === Math.abs(r.amount) &&
          merchantSimilar(e.merchant ?? '', r.description)
      )
      return match ? { date: match.date, merchant: match.merchant ?? '', amount: match.amount, notes: match.notes ?? '' } : null
    }

    setLoadingMsg('Loading categories, payment modes & note history…')
    const [catResult, modeResult, noteHistoryResult, catHistoryResult] = await Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('payment_modes').select('id, name').order('name'),
      supabase
        .from('transactions')
        .select('merchant, notes, created_at')
        .not('notes', 'is', null)
        .not('notes', 'eq', '')
        .order('created_at', { ascending: false })
        .limit(500),
      // Category memory: fetch most recent category_id per merchant
      supabase
        .from('transactions')
        .select('merchant, category_id, created_at')
        .not('merchant', 'is', null)
        .not('category_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1000),
    ])
    const cats = catResult.data ?? []
    setPaymentModes(modeResult.data ?? [])

    const merchantNoteMap = new Map<string, string>()
    for (const row of (noteHistoryResult.data ?? [])) {
      const merchant = (row.merchant ?? '').trim().toLowerCase()
      if (!merchant) continue
      if (merchantNoteMap.has(merchant)) continue
      const noteParts = (row.notes ?? '').split(' | ')
      const userNote = noteParts.find(p => !p.startsWith('UTR:') && p !== 'PhonePe' && p !== 'GPay' && p !== 'Paytm' && p.trim() !== '')
      if (userNote) merchantNoteMap.set(merchant, userNote.trim())
    }

    // Build merchant → category_id memory map (most recent assignment wins)
    const merchantCatMap = new Map<string, string>()
    for (const row of (catHistoryResult.data ?? [])) {
      const merchant = (row.merchant ?? '').trim().toLowerCase()
      if (!merchant || !row.category_id) continue
      if (merchantCatMap.has(merchant)) continue  // already have most recent
      merchantCatMap.set(merchant, row.category_id)
    }

    const withMeta: ParsedRow[] = parsed.map(r => {
      const { category, type } = autoCategory(r.description)
      const keywordCat = cats.find(c => c.name === category)

      // Category memory: prefer past human assignment for this merchant over keyword guess
      const merchantKey = r.description.trim().toLowerCase()
      const memoryCatId = merchantCatMap.get(merchantKey) ?? ''
      // Verify the remembered cat_id still exists
      const memoryCatValid = memoryCatId && cats.some(c => c.id === memoryCatId)
      const resolvedCatId = memoryCatValid ? memoryCatId : (keywordCat?.id ?? '')

      const suggestedNote = r.note || merchantNoteMap.get(merchantKey) || ''
      const hardDup = existingUtrs.has(r.utrNo)
      const softDupMatch = hardDup ? null : findSoftDup(r)
      return {
        ...r,
        note: suggestedNote,
        isDuplicate: hardDup,
        isSoftDuplicate: !hardDup && softDupMatch !== null,
        softDupMatch,
        category_id: resolvedCatId,
        spending_type: r.type === 'credit' ? 'credit' : type,
        selected: !hardDup,
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
    setRows(rows.map(r => {
      if (r.id !== id) return r
      if (field === 'amount') {
        const n = parseFloat(value)
        return { ...r, amount: isNaN(n) ? r.amount : n }
      }
      return { ...r, [field]: value }
    }))
  }

  function deleteRow(id: string) {
    setRows(rows.filter(r => r.id !== id))
  }


  function deleteSelectedRows() {
    // Delete rows that are visible+selected (respects current filters including hideDuplicates)
    const selectedSet = new Set(
      rows
        .filter(r => {
          if (!r.selected) return false
          if (hideDuplicates && (r.isDuplicate || r.isSoftDuplicate)) return false
          if (filterSources.size > 0 && !filterSources.has(r.source)) return false
          if (filterAccounts.size > 0 && !filterAccounts.has(r.account)) return false
          if (filterTypes.size > 0 && !filterTypes.has(r.type)) return false
          return true
        })
        .map(r => r.id)
    )
    setRows(rows.filter(r => !selectedSet.has(r.id)))
  }

  function handleNewCategory(cat: Category) {
    setCategories(prev => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function commit() {
    const toInsert = visibleRows.filter(r => r.selected && !r.isDuplicate)
    if (toInsert.length === 0) return
    setCommitting(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Not logged in'); setCommitting(false); return }

      // Generate a batch ID for this import (used for undo)
      const batchId = crypto.randomUUID()

      // Detect the sources in this batch for a human label
      const sources = [...new Set(toInsert.map(r => r.source))].join(', ')

      // Fetch user's source accounts for matching
      const { data: sourceAccounts } = await supabase
        .from('source_accounts')
        .select('id, bank_name, last4')
        .eq('user_id', user.id)
      const sa = sourceAccounts ?? []

      // Match a parsed row's account name + optional last4 to a source account
      function matchSourceAccount(account: string, utrNo: string): string | null {
        if (!account) return null
        // Try to extract last4 from UTR or account string (PhonePe: "XXXXXX1802" suffix)
        const last4Match = utrNo.match(/\d{4}$/) ?? account.match(/\d{4}$/)
        const last4 = last4Match?.[0] ?? null

        // First try: bank name match + last4 match (most specific)
        if (last4) {
          const byBothFields = sa.find(a =>
            a.bank_name.toLowerCase() === account.toLowerCase() &&
            a.last4 === last4
          )
          if (byBothFields) return byBothFields.id
        }

        // Second try: bank name contains / is contained in account name (partial match)
        const byName = sa.find(a =>
          account.toLowerCase().includes(a.bank_name.toLowerCase()) ||
          a.bank_name.toLowerCase().includes(account.toLowerCase())
        )
        return byName?.id ?? null
      }

      // Find the payment mode ID for each row's account, if it matches
      const records = toInsert.map(r => {
        const modeMatch = paymentModes.find(m => m.name.toLowerCase() === r.account.toLowerCase())
        const isCredit = r.type === 'credit'
        const sourceAccountId = matchSourceAccount(r.account, r.utrNo)
        return {
          user_id: user.id,
          date: r.date,
          merchant: r.description,
          amount: isCredit ? -Math.abs(r.amount) : r.amount,
          spending_type: isCredit ? 'credit' : r.spending_type,
          category_id: r.category_id || null,
          mode_id: modeMatch?.id ?? null,
          batch_id: batchId,
          source_account_id: sourceAccountId,
          // Only store user-provided note; UTR stored internally for dedup only
          notes: [r.note, r.source ? `APP:${r.source}` : '', r.utrNo ? `UTR:${r.utrNo}` : ''].filter(Boolean).join(' | '),
        }
      })

      const { error: insertError } = await supabase.from('transactions').insert(records)
      setCommitting(false)
      if (insertError) {
        setError('Import failed: ' + insertError.message)
        return
      }

      // Save to batch history for undo
      const newBatch: ImportBatch = {
        batchId,
        count: toInsert.length,
        importedAt: new Date().toISOString(),
        label: `${sources} · ${toInsert.length} txns`,
      }
      const updated = [newBatch, ...batchHistory]
      saveBatchHistory(updated)
      setBatchHistory(updated)

      setCommitted(toInsert.length)
      clearDraft()
      setRows([])
    } catch (e: any) {
      setError('Import failed: ' + (e.message ?? 'Unknown error'))
      setCommitting(false)
    }
  }

  async function undoBatch(batchId: string) {
    setUndoing(batchId)
    try {
      const { error: delError } = await supabase
        .from('transactions')
        .delete()
        .eq('batch_id', batchId)
      if (delError) {
        setError('Undo failed: ' + delError.message)
        setUndoing(null)
        return
      }
      // Remove from local history
      const updated = batchHistory.filter(b => b.batchId !== batchId)
      saveBatchHistory(updated)
      setBatchHistory(updated)
    } catch (e: any) {
      setError('Undo failed: ' + (e.message ?? 'Unknown error'))
    }
    setUndoing(null)
  }

  // ── Derived: filtered + sorted rows ──────────────────────────────────────────

  const allSources = [...new Set(rows.map(r => r.source))].sort()
  const allAccounts = [...new Set(rows.map(r => r.account).filter(Boolean))].sort()
  const allTypes = ['debit', 'credit']

  const visibleRows = rows
    .filter(r => {
      if (hideDuplicates && (r.isDuplicate || r.isSoftDuplicate)) return false
      if (filterSources.size > 0 && !filterSources.has(r.source)) return false
      if (filterAccounts.size > 0 && !filterAccounts.has(r.account)) return false
      if (filterTypes.size > 0 && !filterTypes.has(r.type)) return false
      return true
    })
    .sort((a, b) => {
      if (sortField === 'date') {
        const diff = a.date.localeCompare(b.date)
        return sortDir === 'asc' ? diff : -diff
      }
      if (sortField === 'amount') {
        const diff = a.amount - b.amount
        return sortDir === 'asc' ? diff : -diff
      }
      return 0
    })

  const selectedCount = visibleRows.filter(r => r.selected).length
  const dupCount = rows.filter(r => r.isDuplicate).length

  // Apply bulk field to all visible+selected rows (respects current filters)
  function bulkUpdateSelected(field: string, value: string) {
    if (!value) return
    const selectedVisible = new Set(visibleRows.filter(r => r.selected).map(r => r.id))
    setRows(rows.map(r => {
      if (!selectedVisible.has(r.id)) return r
      if (field === 'amount') {
        const n = parseFloat(value)
        return { ...r, amount: isNaN(n) ? r.amount : n }
      }
      return { ...r, [field]: value }
    }))
  }
  const softDupCount = rows.filter(r => r.isSoftDuplicate).length
  const debits = visibleRows.filter(r => r.selected && r.type === 'debit')
  const totalSelected = debits.reduce((s, r) => s + r.amount, 0)

  function SortBtn({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button
        onClick={() => toggleSort(field)}
        className={`flex items-center gap-1 text-left hover:text-[#7FA68A] transition-all ${active ? 'text-[#7FA68A] font-semibold' : ''}`}
      >
        {label}
        <ArrowUpDown size={10} className={active ? 'opacity-100' : 'opacity-30'} />
        {active && <span className="text-[10px] opacity-60">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    )
  }

  function FilterChips({ label, options, active, onToggle }: { label: string; options: string[]; active: Set<string>; onToggle: (v: string) => void }) {
    if (options.length < 2) return null
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">{label}:</span>
        {options.map(opt => (
          <button key={opt} onClick={() => onToggle(opt)}
            className={`text-xs px-2.5 py-0.5 rounded-full border transition-all ${
              active.has(opt)
                ? 'bg-[#7FA68A] text-white border-[#7FA68A]'
                : 'bg-white text-gray-500 border-gray-200 hover:border-[#7FA68A]'
            }`}>
            {opt}
          </button>
        ))}
      </div>
    )
  }

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

      {/* Draft restored banner + mini upload trigger */}
      {rows.length > 0 && !loading && (
        <div className="mb-3 bg-[#F5F2EC] border border-[#C8DDD0] text-gray-600 rounded-xl px-4 py-2.5 text-sm flex items-center gap-3">
          <span className="text-[#7FA68A]">✓</span>
          <span className="flex-1">Draft restored — {rows.length} rows. Review and import, or clear all to start fresh.</span>
          <label className="cursor-pointer text-xs text-[#7FA68A] hover:underline flex items-center gap-1">
            <Upload size={11} /> Upload another
            <input type="file" accept=".pdf,.csv,.xlsx" className="hidden"
              onChange={e => { if (e.target.files?.[0]) processFile(e.target.files[0]) }} />
          </label>
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
        <div className="bg-[#C8DDD0] rounded-2xl p-6 flex items-center gap-4 mb-4">
          <CheckCircle size={24} className="text-[#7FA68A]" />
          <div>
            <div className="font-semibold text-gray-800">{committed} transactions imported successfully!</div>
            <div className="text-sm text-gray-600 mt-0.5">They're now in your Transaction Ledger. Use "Import History" below to undo.</div>
          </div>
          <button onClick={() => setCommitted(0)} className="ml-auto text-sm text-gray-500 underline">
            Import another
          </button>
        </div>
      )}

      {/* Import History / Undo section */}
      {batchHistory.length > 0 && rows.length === 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowHistory(h => !h)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3 transition-all">
            <RotateCcw size={14} />
            Import History ({batchHistory.length} batches)
            <span className="text-gray-400">{showHistory ? '▲' : '▼'}</span>
          </button>
          {showHistory && (
            <div className="flex flex-col gap-2">
              {batchHistory.map(batch => {
                const importedAt = new Date(batch.importedAt)
                const dateStr = importedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                const timeStr = importedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={batch.batchId} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-4 shadow-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-700 text-sm truncate">{batch.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{dateStr} at {timeStr}</div>
                    </div>
                    <button
                      onClick={() => undoBatch(batch.batchId)}
                      disabled={undoing === batch.batchId}
                      className="flex items-center gap-1.5 text-xs text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-xl transition-all disabled:opacity-50 flex-shrink-0">
                      <RotateCcw size={11} className={undoing === batch.batchId ? 'animate-spin' : ''} />
                      {undoing === batch.batchId ? 'Undoing…' : 'Undo'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Staging table */}
      {rows.length > 0 && (
        <>
          {/* Summary chips */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="bg-[#C8DDD0] rounded-xl px-4 py-2 text-sm">
              <span className="text-gray-600">Rows: </span><strong>{rows.length}</strong>
              {rows.length !== visibleRows.length && <span className="text-gray-400 ml-1">(showing {visibleRows.length})</span>}
            </div>
            <div className="bg-[#D5CEED] rounded-xl px-4 py-2 text-sm">
              <span className="text-gray-600">Selected: </span><strong>{selectedCount}</strong>
            </div>
            {dupCount > 0 && (
              <div className="bg-[#F0CECE] rounded-xl px-4 py-2 text-sm">
                <span className="text-gray-600">Duplicates: </span><strong>{dupCount}</strong>
              </div>
            )}
            {softDupCount > 0 && (
              <div className="bg-amber-100 border border-amber-200 rounded-xl px-4 py-2 text-sm">
                <span className="text-amber-700">Possible dups: </span><strong className="text-amber-800">{softDupCount}</strong>
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
            <div className="ml-auto flex gap-2">
              <button onClick={() => { clearDraft(); setRows([]); setError('') }}
                className="text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-xl px-4 py-2">
                Clear all
              </button>
              {selectedCount > 0 && (
                <button onClick={deleteSelectedRows}
                  className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 rounded-xl px-4 py-2 transition-all">
                  <Trash2 size={13} /> Delete {selectedCount}
                </button>
              )}
              <button onClick={commit} disabled={committing || selectedCount === 0}
                className="bg-[#7FA68A] text-white rounded-xl px-6 py-2 text-sm font-medium hover:bg-[#6d9478] disabled:opacity-50 transition-all">
                {committing ? 'Importing…' : `Import ${selectedCount} transactions`}
              </button>
            </div>
          </div>

          {/* Bulk edit toolbar — shown when rows are selected */}
          {selectedCount > 0 && (
            <div className="mb-3 bg-[#2D2D2D] text-white rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-gray-300 flex-shrink-0">
                <Pencil size={13} className="text-[#7FA68A]" />
                <span className="font-medium text-white">Bulk edit</span>
                <span className="text-gray-400">({selectedCount} selected)</span>
              </div>
              <div className="flex flex-wrap gap-2 items-center">

                {/* Category */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Cat:</span>
                  <div className="relative flex items-center">
                    <select
                      value={bulkCategory}
                      onChange={e => { setBulkCategory(e.target.value); if (e.target.value) bulkUpdateSelected('category_id', e.target.value) }}
                      className="text-xs bg-[#3D3D3D] text-white border border-[#555] rounded-lg pl-2 pr-6 py-1 outline-none appearance-none cursor-pointer hover:border-[#7FA68A] focus:border-[#7FA68A] transition-all"
                    >
                      <option value="">— pick —</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <ChevronDown size={10} className="absolute right-1.5 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Spending type */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Type:</span>
                  <div className="relative flex items-center">
                    <select
                      value={bulkSpendingType}
                      onChange={e => { setBulkSpendingType(e.target.value); if (e.target.value) bulkUpdateSelected('spending_type', e.target.value) }}
                      className="text-xs bg-[#3D3D3D] text-white border border-[#555] rounded-lg pl-2 pr-6 py-1 outline-none appearance-none cursor-pointer hover:border-[#7FA68A] focus:border-[#7FA68A] transition-all"
                    >
                      <option value="">— pick —</option>
                      <option value="necessary">Necessary</option>
                      <option value="unnecessary">Unnecessary</option>
                      <option value="credit">Credit</option>
                    </select>
                    <ChevronDown size={10} className="absolute right-1.5 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Source / App */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">App:</span>
                  <div className="relative flex items-center">
                    <select
                      value={bulkSource}
                      onChange={e => { setBulkSource(e.target.value); if (e.target.value) bulkUpdateSelected('source', e.target.value) }}
                      className="text-xs bg-[#3D3D3D] text-white border border-[#555] rounded-lg pl-2 pr-6 py-1 outline-none appearance-none cursor-pointer hover:border-[#7FA68A] focus:border-[#7FA68A] transition-all"
                    >
                      <option value="">— pick —</option>
                      {['GPay', 'PhonePe', 'Paytm'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown size={10} className="absolute right-1.5 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Account / Bank */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Account:</span>
                  <div className="relative flex items-center">
                    <select
                      value={bulkAccount}
                      onChange={e => { setBulkAccount(e.target.value); if (e.target.value) bulkUpdateSelected('account', e.target.value) }}
                      className="text-xs bg-[#3D3D3D] text-white border border-[#555] rounded-lg pl-2 pr-6 py-1 outline-none appearance-none cursor-pointer hover:border-[#7FA68A] focus:border-[#7FA68A] transition-all"
                    >
                      <option value="">— pick —</option>
                      {/* Known accounts + any in current batch */}
                      {['SBI', 'Niyo SBM', 'Axis MyZone', 'Axis Neo', ...allAccounts.filter(a => !['SBI','Niyo SBM','Axis MyZone','Axis Neo'].includes(a))].map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <ChevronDown size={10} className="absolute right-1.5 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Debit / Credit */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Dr/Cr:</span>
                  <div className="relative flex items-center">
                    <select
                      value={bulkType}
                      onChange={e => { setBulkType(e.target.value); if (e.target.value) bulkUpdateSelected('type', e.target.value) }}
                      className="text-xs bg-[#3D3D3D] text-white border border-[#555] rounded-lg pl-2 pr-6 py-1 outline-none appearance-none cursor-pointer hover:border-[#7FA68A] focus:border-[#7FA68A] transition-all"
                    >
                      <option value="">— pick —</option>
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                    <ChevronDown size={10} className="absolute right-1.5 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Date override */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Date:</span>
                  <input
                    type="date"
                    value={bulkDate}
                    onChange={e => { setBulkDate(e.target.value); if (e.target.value) bulkUpdateSelected('date', e.target.value) }}
                    className="text-xs bg-[#3D3D3D] text-white border border-[#555] rounded-lg px-2 py-1 outline-none cursor-pointer hover:border-[#7FA68A] focus:border-[#7FA68A] transition-all"
                  />
                </div>

              </div>

              {/* Reset bulk selectors */}
              <button
                onClick={() => { setBulkCategory(''); setBulkSpendingType(''); setBulkAccount(''); setBulkSource(''); setBulkType(''); setBulkDate('') }}
                className="ml-auto text-[10px] text-gray-500 hover:text-gray-300 underline flex-shrink-0 transition-all"
              >
                Reset selectors
              </button>
            </div>
          )}

          {/* Filter chips */}
          <div className="flex gap-4 mb-3 flex-wrap items-center bg-[#F5F2EC] rounded-2xl px-4 py-2.5">
            <FilterChips
              label="App"
              options={allSources}
              active={filterSources}
              onToggle={v => toggleFilter(filterSources, setFilterSources, v)}
            />
            {allAccounts.length > 0 && (
              <FilterChips
                label="Account"
                options={allAccounts}
                active={filterAccounts}
                onToggle={v => toggleFilter(filterAccounts, setFilterAccounts, v)}
              />
            )}
            <FilterChips
              label="Type"
              options={allTypes}
              active={filterTypes}
              onToggle={v => toggleFilter(filterTypes, setFilterTypes, v)}
            />
            {/* Hide duplicates toggle — hides both hard dups and soft dups */}
            {(dupCount > 0 || softDupCount > 0) && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">Dupes:</span>
                <button
                  onClick={() => setHideDuplicates(h => !h)}
                  className={`text-xs px-2.5 py-0.5 rounded-full border transition-all flex items-center gap-1 ${
                    hideDuplicates
                      ? 'bg-[#7FA68A] text-white border-[#7FA68A]'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-[#7FA68A]'
                  }`}
                >
                  {hideDuplicates ? '✓ Hidden' : 'Hide dupes'}
                  <span className={`text-[10px] rounded-full px-1 ${hideDuplicates ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'}`}>
                    {dupCount + softDupCount}
                  </span>
                </button>
              </div>
            )}
            {(filterSources.size > 0 || filterAccounts.size > 0 || filterTypes.size > 0 || hideDuplicates) && (
              <button
                onClick={() => { setFilterSources(new Set()); setFilterAccounts(new Set()); setFilterTypes(new Set()); setHideDuplicates(false) }}
                className="text-xs text-gray-400 hover:text-gray-600 underline ml-auto"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: colWidths.checkbox }} />
                  <col style={{ width: colWidths.date }} />
                  <col style={{ width: colWidths.description }} />
                  <col style={{ width: colWidths.notes }} />
                  <col style={{ width: colWidths.amount }} />
                  <col style={{ width: colWidths.category }} />
                  <col style={{ width: colWidths.type }} />
                  <col style={{ width: colWidths.account }} />
                  <col style={{ width: colWidths.status }} />
                  <col style={{ width: colWidths.del }} />
                </colgroup>
                <thead>
                  <tr className="bg-[#F5F2EC] text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.checkbox }}>
                      <input type="checkbox" onChange={toggleAll}
                        checked={visibleRows.filter(r => !r.isDuplicate).length > 0 && visibleRows.filter(r => !r.isDuplicate).every(r => r.selected)}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.date }}>
                      <SortBtn field="date" label="Date" />
                      <ResizeHandle currentWidth={colWidths.date} onWidthChange={w => updateColWidth('date', w)} />
                    </th>
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.description }}>
                      Description
                      <ResizeHandle currentWidth={colWidths.description} onWidthChange={w => updateColWidth('description', w)} />
                    </th>
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.notes }}>
                      Notes
                      <ResizeHandle currentWidth={colWidths.notes} onWidthChange={w => updateColWidth('notes', w)} />
                    </th>
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.amount }}>
                      <SortBtn field="amount" label="Amount" />
                      <ResizeHandle currentWidth={colWidths.amount} onWidthChange={w => updateColWidth('amount', w)} />
                    </th>
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.category }}>
                      Category
                      <ResizeHandle currentWidth={colWidths.category} onWidthChange={w => updateColWidth('category', w)} />
                    </th>
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.type }}>
                      Type
                      <ResizeHandle currentWidth={colWidths.type} onWidthChange={w => updateColWidth('type', w)} />
                    </th>
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.account }}>
                      Account
                      <ResizeHandle currentWidth={colWidths.account} onWidthChange={w => updateColWidth('account', w)} />
                    </th>
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.status }}>
                      Status
                      <ResizeHandle currentWidth={colWidths.status} onWidthChange={w => updateColWidth('status', w)} />
                    </th>
                    <th className="px-3 py-3 text-left relative overflow-hidden" style={{ width: colWidths.del }}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(row => (
                    <tr key={row.id}
                      className={`border-t border-gray-50 transition-all
                        ${row.isDuplicate ? 'opacity-50 bg-[#F0CECE]/20' : row.isSoftDuplicate ? 'bg-amber-50/60' : row.selected ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={row.selected} onChange={() => toggleRow(row.id)}
                          disabled={row.isDuplicate} className="rounded" />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <input type="date"
                          className="text-xs text-gray-600 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-[#7FA68A] outline-none cursor-pointer"
                          value={row.date}
                          onChange={e => updateRow(row.id, 'date', e.target.value)} />
                      </td>
                      <td className="px-3 py-2.5 overflow-hidden">
                        <input className="w-full text-gray-800 bg-transparent outline-none focus:bg-gray-50 rounded px-1 truncate"
                          value={row.description}
                          onChange={e => updateRow(row.id, 'description', e.target.value)} />
                      </td>
                      <td className="px-3 py-2.5 overflow-hidden">
                        <input className={`w-full text-xs rounded px-1 truncate outline-none placeholder:text-gray-300
                          ${row.note
                            ? 'text-gray-700 bg-[#F5F2EC] focus:bg-[#EDE9E0]'
                            : 'text-gray-500 bg-transparent focus:bg-gray-50'}`}
                          placeholder="add note…"
                          title={row.note ? 'Auto-suggested from previous import' : ''}
                          value={row.note}
                          onChange={e => updateRow(row.id, 'note', e.target.value)} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap overflow-hidden">
                        <div className="flex items-center gap-1">
                          <span className={row.type === 'credit' ? 'text-[#7FA68A] font-medium' : 'text-gray-800'}>{row.type === 'credit' ? '+' : '−'}</span>
                          <input type="number" min="0" step="0.01"
                            className={`w-full text-sm bg-transparent border-b border-transparent hover:border-gray-200 focus:border-[#7FA68A] outline-none ${row.type === 'credit' ? 'text-[#7FA68A] font-medium' : 'text-gray-800'}`}
                            value={row.amount}
                            onChange={e => updateRow(row.id, 'amount', e.target.value)} />
                        </div>
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
                        <div className="flex flex-col gap-1">
                          <select
                            className="text-xs bg-[#F5F2EC] text-gray-500 px-2 py-0.5 rounded-full border-none outline-none cursor-pointer hover:bg-[#EDE9E0] w-fit"
                            value={row.source}
                            onChange={e => updateRow(row.id, 'source', e.target.value)}
                          >
                            {['GPay', 'PhonePe', 'Paytm', ''].map(s => (
                              <option key={s} value={s}>{s || '—'}</option>
                            ))}
                          </select>
                          <input
                            className="text-[10px] text-gray-400 font-medium px-2 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-[#7FA68A] outline-none w-24"
                            placeholder="account…"
                            value={row.account}
                            onChange={e => updateRow(row.id, 'account', e.target.value)}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.isDuplicate
                          ? <span className="text-xs bg-[#F0CECE] text-red-400 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><AlertTriangle size={10} /> Duplicate</span>
                          : row.isSoftDuplicate && row.softDupMatch
                            ? <div className="relative group">
                                <span className="text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit cursor-help border border-amber-200">
                                  <AlertTriangle size={10} /> Possible dup
                                </span>
                                {/* Tooltip showing the existing transaction */}
                                <div className="absolute right-0 top-6 z-50 hidden group-hover:block w-56 bg-white border border-amber-200 rounded-xl shadow-lg p-3 text-xs">
                                  <p className="font-semibold text-amber-700 mb-1">Existing transaction found</p>
                                  <p className="text-gray-700 font-medium truncate">{row.softDupMatch.merchant || '—'}</p>
                                  <p className="text-gray-500">{row.softDupMatch.date}</p>
                                  <p className="text-gray-800 font-semibold">₹{Math.abs(row.softDupMatch.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                                  {row.softDupMatch.notes && (
                                    <p className="text-gray-400 mt-1 truncate">{row.softDupMatch.notes}</p>
                                  )}
                                  <p className="text-amber-500 mt-1.5 text-[10px]">Deselect if already logged</p>
                                </div>
                              </div>
                            : <span className="text-xs bg-[#C8DDD0] text-[#7FA68A] px-2 py-0.5 rounded-full w-fit">New</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => deleteRow(row.id)} className="text-gray-300 hover:text-red-400 transition-all">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-sm text-gray-400">
                        No rows match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
