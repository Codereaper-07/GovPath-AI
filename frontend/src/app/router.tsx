import { createBrowserRouter } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { AssistantPage, DashboardPage, DocumentsPage, PlannerPage, ServiceDetailPage, ServicesPage } from './lazyPages'
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
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
