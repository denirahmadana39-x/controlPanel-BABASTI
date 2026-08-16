import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/hooks/useAuth";
import { ToastProvider } from "@/components/ui/toast";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/layout/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { WebsitesPage } from "@/pages/WebsitesPage";
import { CreateWebsitePage } from "@/pages/CreateWebsitePage";
import { WebsiteDetailPage } from "@/pages/WebsiteDetailPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DASHBOARD_ROUTE_PATH } from "@/routing";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <LoginPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/register"
                element={
                  <PublicOnlyRoute>
                    <RegisterPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path={DASHBOARD_ROUTE_PATH}
                element={
                  <ProtectedRoute>
                    <AppShell>
                      <Routes>
                        <Route index element={<OverviewPage />} />
                        <Route path="websites" element={<WebsitesPage />} />
                        <Route path="websites/new" element={<CreateWebsitePage />} />
                        <Route path="websites/:id" element={<WebsiteDetailPage />} />
                        <Route path="settings" element={<SettingsPage />} />
                      </Routes>
                    </AppShell>
                  </ProtectedRoute>
                }
              />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
