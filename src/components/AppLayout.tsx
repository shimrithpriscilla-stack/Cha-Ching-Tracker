import { useState } from 'react'
import { IndianRupee, Receipt, Layers, PieChart, BarChart3, Upload } from 'lucide-react'

const navItems = [
  { id: 'income', label: 'Income', icon: IndianRupee },
  { id: 'transactions', label: 'Transactions', icon: Receipt },
  { id: 'budgets', label: 'Budgets', icon: Layers },
  { id: 'analysis', label: 'Analysis', icon: PieChart },
  { id: 'compare', label: 'Compare', icon: BarChart3 },
    { id: 'import', label: 'Import', icon: Upload },
]

interface Props {
  children: React.ReactNode
  activePage: string
  setActivePage: (page: string) => void
  userEmail: string
  onSignOut: () => void
}

export default function AppLayout({ children, activePage, setActivePage, userEmail, onSignOut }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex min-h-screen bg-[#FAF8F4]">
      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex flex-col bg-[#F5F2EC] border-r border-gray-100 transition-all duration-200 ${collapsed ? 'w-16' : 'w-56'}`}>
        <div className="flex items-center gap-3 p-4 border-b border-gray-100">
          <div className="w-9 h-9 bg-[#7FA68A] rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0">₹</div>
          {!collapsed && (
            <div>
              <div className="text-base font-light text-gray-800" style={{fontFamily: 'Georgia, serif'}}>Cha-Ching</div>
              <div className="text-xs text-gray-400">Finance Tracker</div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 flex flex-col gap-1">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActivePage(id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full text-left
                ${activePage === id ? 'bg-[#C8DDD0] text-[#7FA68A]' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Icon size={18} strokeWidth={1.5} className="flex-shrink-0" />
              {!collapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100">
          {!collapsed && <p className="text-xs text-gray-400 truncate mb-2">{userEmail}</p>}
          <button onClick={onSignOut} className="text-xs text-gray-400 hover:text-gray-600 w-full text-left px-2">
            {collapsed ? '←' : 'Sign out'}
          </button>
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-3 text-gray-400 hover:text-gray-600 border-t border-gray-100 text-xs"
        >
          {collapsed ? '→' : '← Collapse'}
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 pb-20 md:pb-0">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#F5F2EC] border-t border-gray-100 flex z-50">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActivePage(id)}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium transition-all
              ${activePage === id ? 'text-[#7FA68A]' : 'text-gray-400'}`}
          >
            <Icon size={20} strokeWidth={1.5} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
