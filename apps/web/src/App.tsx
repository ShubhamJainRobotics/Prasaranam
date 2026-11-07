import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext.js';
import { ToastProvider } from './context/ToastContext.js';
import { ProtectedRoute } from './components/auth/ProtectedRoute.js';
import { AppShell } from './components/layout/AppShell.js';

// Pages
import { LandingPage } from './routes/LandingPage.js';
import { LoginPage } from './routes/LoginPage.js';
import { RegisterPage } from './routes/RegisterPage.js';
import { ForgotPasswordPage } from './routes/ForgotPasswordPage.js';
import { ResetPasswordPage } from './routes/ResetPasswordPage.js';
import { AuthCallbackPage } from './routes/AuthCallbackPage.js';
import { AppEntryPage } from './routes/AppEntryPage.js';
import { OrganisationOverviewPage } from './routes/OrganisationOverviewPage.js';
import { OrganisationMembersPage } from './routes/OrganisationMembersPage.js';
import { ProjectDashboardPage } from './routes/ProjectDashboardPage.js';
import { ProjectMembersPage } from './routes/ProjectMembersPage.js';
import { ProjectSettingsPage } from './routes/ProjectSettingsPage.js';
import { ProjectSourcesPage } from './routes/ProjectSourcesPage.js';
import { SourceDetailPage } from './routes/SourceDetailPage.js';
import { ProjectKnowledgePage } from './routes/ProjectKnowledgePage.js';
import { ProjectQuestionsPage } from './routes/ProjectQuestionsPage.js';
import { AccountSettingsPage } from './routes/AccountSettingsPage.js';
import { NotFoundPage } from './routes/NotFoundPage.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />

              {/* Protected Workspace routes */}
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<AppEntryPage />} />
                <Route
                  path="organisations/:organisationId"
                  element={<OrganisationOverviewPage />}
                />
                <Route
                  path="organisations/:organisationId/members"
                  element={<OrganisationMembersPage />}
                />
                <Route path="projects/:projectId" element={<ProjectDashboardPage />} />
                <Route path="projects/:projectId/sources" element={<ProjectSourcesPage />} />
                <Route
                  path="projects/:projectId/sources/:sourceId"
                  element={<SourceDetailPage />}
                />
                <Route path="projects/:projectId/knowledge" element={<ProjectKnowledgePage />} />
                <Route path="projects/:projectId/questions" element={<ProjectQuestionsPage />} />
                <Route path="projects/:projectId/members" element={<ProjectMembersPage />} />
                <Route path="projects/:projectId/settings" element={<ProjectSettingsPage />} />
                <Route path="settings" element={<AccountSettingsPage />} />
              </Route>

              {/* 404 Catch-all */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
};
