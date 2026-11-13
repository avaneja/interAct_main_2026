import { createBrowserRouter, type RouteObject } from 'react-router'
import Layout from './components/Layout.tsx'
import ConfigurePage from './pages/ConfigurePage.tsx'
import HomePage from './pages/HomePage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import TopicPage from './pages/TopicPage.tsx'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'new', element: <TopicPage /> },
      { path: 'sessions/:id/topic', element: <TopicPage /> },
      { path: 'sessions/:id/configure', element: <ConfigurePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
