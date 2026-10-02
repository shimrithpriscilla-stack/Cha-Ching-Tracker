import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'
import AppLayout from './components/AppLayout'
import Income from './pages/Income'
import Transactions from './pages/Transactions'
import Budgets from './pages/Budgets'
import Analysis from './pages/Analysis'
import IncomeVsSpend from './pages/IncomeVsSpend'

const PAGES: Record<string, React.ReactElement> = {
  income: <Income />,
  transactions: <Transactions />,
  budgets: <Budgets />,
  analysis: <Analysis />,
  compare: <IncomeVsSpend />,
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [activePage, setActivePage] = useState('income')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF8F4]">
      <p className="text-gray-400 text-sm">Loading...</p>
    </div>
  )

  if (!session) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF8F4]">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-10 flex flex-col items-center gap-6 w-full max-w-sm">
        <div className="w-14 h-14 bg-[#7FA68A] rounded-2xl flex items-center justify-center text-white text-2xl font-bold">₹</div>
        <div className="text-center">
          <h1 className="text-3xl font-light text-gray-800" style={{fontFamily:'Georgia,serif'}}>Cha-Ching</h1>
          <p className="text-gray-400 text-sm mt-1">Your personal finance tracker</p>
        </div>
        <button onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-2xl px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all">
          <img src="https://www.google.com/favicon.ico" className="w-4 h-4" />
          Continue with Google
        </button>
      </div>
    </div>
  )

  return (
    <AppLayout
      activePage={activePage}
      setActivePage={setActivePage}
      userEmail={session.user.email ?? ''}
      onSignOut={() => supabase.auth.signOut()}
    >
      {PAGES[activePage]}
    </AppLayout>
  )
}