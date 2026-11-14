import { createBrowserRouter } from 'react-router-dom'
import { RequireAuth } from '../features/auth/RequireAuth'
import { DashboardLayout } from '../layouts/DashboardLayout'
import {
  ActivityPage,
  AssistantPage,
  DashboardPage,
  DocumentsPage,
  LoginPage,
  PlannerPage,
  ProfilePage,
  ServiceDetailPage,
  ServicesPage,
  SignupPage,
  VaultPage,
} from './lazyPages'
import { NotFoundPage } from './NotFoundPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <DashboardLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'services', element: <ServicesPage /> },
      { path: 'services/:serviceId', element: <ServiceDetailPage /> },
      { path: 'planner', element: <PlannerPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'assistant', element: <AssistantPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
      // Account pages require sign-in; every existing page stays public.
      {
        path: 'profile',
        element: (
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        ),
      },
      {
        path: 'vault',
        element: (
          <RequireAuth>
            <VaultPage />
          </RequireAuth>
        ),
      },
      {
        path: 'activity',
        element: (
          <RequireAuth>
            <ActivityPage />
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
