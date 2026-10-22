import { Outlet } from 'react-router-dom'
import { NavBar } from './components/NavBar'

function App() {
  return (
    <div className="flex min-h-svh flex-col bg-bg">
      <NavBar />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-text-softer">
        Zawadie PromptClass — internal training for Zawadie Solutions agents. Your progress is
        saved on this device and synced when signed in.
        <br />
        Built by Kit Alimasi
      </footer>
    </div>
  )
}

export default App
