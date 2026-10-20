import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './styles.css'
import { getToken } from './api'
import { AuthPage } from './pages/AuthPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { EditorPage } from './pages/EditorPage'
import { BuilderListPage } from './pages/BuilderListPage'
import { BuilderPage } from './pages/BuilderPage'
import { LibraryPage } from './pages/LibraryPage'
import { ErrorBoundary } from './components/ErrorBoundary'

function Guard({ children }: { children: React.ReactElement }) {
  return getToken() ? children : <Navigate to="/login" replace />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/" element={<Guard><ProjectsPage /></Guard>} />
        <Route path="/builder" element={<Guard><BuilderListPage /></Guard>} />
        <Route path="/builder/:id" element={<Guard><BuilderPage /></Guard>} />
        <Route path="/library" element={<Guard><LibraryPage /></Guard>} />
        <Route path="/projects/:id" element={<Guard><EditorPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
