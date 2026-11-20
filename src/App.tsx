import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout, type NavSection } from './components/Layout';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { MovementsPage } from './pages/MovementsPage';
import { RiskPage } from './pages/RiskPage';
import { ForecastingPage } from './pages/ForecastingPage';
import { MatchingPage } from './pages/MatchingPage';
import { RecoveryPage } from './pages/RecoveryPage';
import { FinancialPage } from './pages/FinancialPage';
import { CopilotPage } from './pages/CopilotPage';
import { ReportsPage, SettingsPage } from './pages/ReportsSettingsPage';

function WorkspaceRouter() {
  const { user, loading } = useAuth();
  const [section, setSection] = useState<NavSection>('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-sm text-slate-500">
        Loading StockMind AI workspace...
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <Layout activeSection={section} onNavigate={setSection}>
      {section === 'dashboard' && <DashboardPage onNavigate={setSection} />}
      {section === 'inventory' && <InventoryPage />}
      {section === 'movements' && <MovementsPage />}
      {section === 'risk' && <RiskPage onNavigate={setSection} />}
      {section === 'forecasting' && <ForecastingPage />}
      {section === 'matching' && <MatchingPage />}
      {section === 'recovery' && <RecoveryPage />}
      {section === 'financial' && <FinancialPage />}
      {section === 'copilot' && <CopilotPage />}
      {section === 'reports' && <ReportsPage />}
      {section === 'settings' && <SettingsPage />}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceRouter />
    </AuthProvider>
  );
}
