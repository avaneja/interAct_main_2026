import { createBrowserRouter, type RouteObject } from 'react-router'
import RequireAuth from './auth/RequireAuth.tsx'
import Layout from './components/Layout.tsx'
import ConfigurePage from './pages/ConfigurePage.tsx'
import HistoryPage from './pages/HistoryPage.tsx'
import HomePage from './pages/HomePage.tsx'
import CallPage from './pages/CallPage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import PlanPage from './pages/PlanPage.tsx'
import ReportPage from './pages/ReportPage.tsx'
import SignInPage from './pages/SignInPage.tsx'
import TopicPage from './pages/TopicPage.tsx'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'sign-in', element: <SignInPage /> },
      {
        // Everything about interviews needs a signed-in user.
        element: <RequireAuth />,
        children: [
          { path: 'new', element: <TopicPage /> },
          { path: 'history', element: <HistoryPage /> },
          { path: 'sessions/:id/topic', element: <TopicPage /> },
          { path: 'sessions/:id/configure', element: <ConfigurePage /> },
          { path: 'sessions/:id/plan', element: <PlanPage /> },
          { path: 'sessions/:id/interview', element: <CallPage /> },
          { path: 'sessions/:id/report', element: <ReportPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
