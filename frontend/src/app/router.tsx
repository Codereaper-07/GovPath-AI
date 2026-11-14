import { createBrowserRouter } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { AssistantPage } from '../features/assistant/AssistantPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { DocumentsPage } from '../features/documents/DocumentsPage'
import { PlannerPage } from '../features/planner/PlannerPage'
import { ServiceDetailPage } from '../features/services/ServiceDetailPage'
import { ServicesPage } from '../features/services/ServicesPage'
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
