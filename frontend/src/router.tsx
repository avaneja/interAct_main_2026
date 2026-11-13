import { createBrowserRouter, type RouteObject } from 'react-router'
import App from './App.tsx'
import Layout from './components/Layout.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <App /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
