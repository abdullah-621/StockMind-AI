import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  Calculator,
  FileSpreadsheet,
  GitCompare,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Recycle,
  Settings,
  ShieldAlert,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

export type NavSection =
  | 'dashboard'
  | 'inventory'
  | 'movements'
  | 'forecasting'
  | 'risk'
  | 'matching'
  | 'recovery'
  | 'financial'
  | 'copilot'
  | 'reports'
  | 'settings';

interface NotificationItem {
  id: number;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  sku: string | null;
  is_read: number;
  created_at: string;
}

interface LayoutProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  children: React.ReactNode;
}

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Executive Dashboard', icon: BarChart3 }],
  },
  {
    label: 'Inventory Operations',
    items: [
      { id: 'inventory', label: 'Smart Inventory', icon: Boxes },
      { id: 'movements', label: 'Stock Movements', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'AI Intelligence',
    items: [
      { id: 'risk', label: 'Dead Stock Risk', icon: ShieldAlert },
      { id: 'forecasting', label: 'Demand & Reorder', icon: TrendingUp },
      { id: 'matching', label: 'Material Matching', icon: GitCompare },
    ],
  },
  {
    label: 'Value Recovery',
    items: [
      { id: 'recovery', label: 'Recovery Engine', icon: Recycle },
      { id: 'financial', label: 'Financial Simulator', icon: Calculator },
    ],
  },
  {
    label: 'Assistant & Governance',
    items: [
      { id: 'copilot', label: 'AI Inventory Copilot', icon: MessageSquareText },
      { id: 'reports', label: 'Reports & Methodology', icon: FileSpreadsheet },
      { id: 'settings', label: 'Settings & RBAC', icon: Settings },
    ],
  },
];

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Executive Dashboard',
  inventory: 'Smart Inventory Management',
  movements: 'Stock Movements & Audit Trail',
  forecasting: 'Demand Forecasting & Reorder Intelligence',
  risk: 'Dead Stock & Slow-Moving Detection',
  matching: 'Material Compatibility Intelligence',
  recovery: 'Dead Stock Recovery Engine',
  financial: 'Financial Intelligence & What-If Simulator',
  copilot: 'AI Inventory Copilot',
  reports: 'Business Intelligence Reports & Documentation',
  settings: 'Workspace Settings & Access Control',
};

export function Layout({ activeSection, onNavigate, children }: LayoutProps) {
  const { user, theme, toggleTheme, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const loadNotifications = async () => {
    try {
      const res = await apiFetch<{ notifications: NotificationItem[] }>('/api/notifications');
      setNotifications(res.notifications);
    } catch {
      // Ignore background fetch error
    }
  };

  // Load notifications once at mount; refresh when the panel is opened instead
  // of issuing the same request on every sidebar navigation.
  useEffect(() => {
    loadNotifications();
  }, []);

  const unreadCount = notifications.filter((n) => n.is_read === 0).length;

  const markRead = async (id: number) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
  };

  const markAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  };

  const handleNavClick = (id: NavSection) => {
    onNavigate(id);
    setMobileMenuOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="px-5 h-16 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-blue-600 text-white flex items-center justify-center shrink-0">
          <Activity className="w-4 h-4" />
        </div>
        <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
          StockMind AI
        </span>
      </div>

      <nav aria-label="Primary Sidebar" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-3 mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 text-white dark:bg-blue-600 dark:text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1">
        <div className="font-medium text-slate-700 dark:text-slate-200 truncate">
          {user?.fullName}
        </div>
        <div className="truncate">
          {user?.role} · Knitwear Ops
        </div>
        <div className="pt-1 text-[11px] text-slate-400 dark:text-slate-500">
          Dataset: Synthetic Factory Data
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[80vw] h-full z-10">{sidebarContent}</aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 dark:text-slate-500 whitespace-nowrap">
                StockMind AI
              </span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">/</span>
              <h1 className="font-display font-semibold text-base text-slate-900 dark:text-slate-100 truncate">
                {SECTION_TITLES[activeSection]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => {
                setNotifOpen(true);
                loadNotifications();
              }}
              aria-label={`Notifications (${unreadCount} unread)`}
              className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Bell className="w-4 h-4" />
              <span className="hidden sm:inline">Alerts</span>
              {unreadCount > 0 && (
                <span className="font-mono tabular-nums text-rose-600 dark:text-rose-400 font-semibold">
                  ({unreadCount})
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>

      {/* Notifications Slide-Over Drawer */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={() => setNotifOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="font-display font-semibold text-base">Inventory Alerts</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {unreadCount} unread notifications
                </p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline px-2 py-1"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  aria-label="Close notifications"
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No alerts recorded.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-4 space-y-1.5 ${
                      n.is_read === 0 ? 'bg-slate-50/70 dark:bg-slate-800/40' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`font-semibold uppercase tracking-wide ${
                          n.severity === 'critical'
                            ? 'text-rose-600 dark:text-rose-400'
                            : n.severity === 'warning'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {n.severity}
                      </span>
                      <span className="font-mono text-slate-400">
                        {n.sku ?? 'System'}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {n.title}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {n.message}
                    </p>
                    {n.is_read === 0 && (
                      <button
                        type="button"
                        onClick={() => markRead(n.id)}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline pt-1"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
