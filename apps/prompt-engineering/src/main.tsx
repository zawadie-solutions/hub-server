import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ProgressProvider } from './store/progress'
import { AuthProvider } from './store/auth'
import { Landing } from './pages/Landing'
import { Dashboard } from './pages/Dashboard'
import { Lesson } from './pages/Lesson'
import { Progress } from './pages/Progress'
import { Evaluate } from './pages/Evaluate'
import { Exam } from './pages/Exam'
import { Leaderboard } from './pages/Leaderboard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthProvider>
        <ProgressProvider>
          <Routes>
            <Route element={<App />}>
              <Route index element={<Landing />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="modules/:moduleId/lessons/:lessonId" element={<Lesson />} />
              <Route path="progress" element={<Progress />} />
              <Route path="evaluate" element={<Evaluate />} />
              <Route path="exam" element={<Exam />} />
              <Route path="leaderboard" element={<Leaderboard />} />
            </Route>
          </Routes>
        </ProgressProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
