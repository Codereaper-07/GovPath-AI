import { lazy } from 'react'

// Route-level code splitting: each page loads on first visit (same components, same behaviour).
export const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
export const ServicesPage = lazy(() => import('../features/services/ServicesPage').then((m) => ({ default: m.ServicesPage })))
export const ServiceDetailPage = lazy(() =>
  import('../features/services/ServiceDetailPage').then((m) => ({ default: m.ServiceDetailPage })),
)
export const PlannerPage = lazy(() => import('../features/planner/PlannerPage').then((m) => ({ default: m.PlannerPage })))
export const DocumentsPage = lazy(() => import('../features/documents/DocumentsPage').then((m) => ({ default: m.DocumentsPage })))
export const LoginPage = lazy(() => import('../features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
export const SignupPage = lazy(() => import('../features/auth/SignupPage').then((m) => ({ default: m.SignupPage })))
export const ProfilePage = lazy(() => import('../features/auth/ProfilePage').then((m) => ({ default: m.ProfilePage })))
export const AssistantPage = lazy(() => import('../features/assistant/AssistantPage').then((m) => ({ default: m.AssistantPage })))

