import { useState, useCallback, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { getCurrentUser, logout, getBatches } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import StockList from "./pages/StockList";
import StockEntry from "./pages/StockEntry";
import PurchasePage from "./pages/PurchasePage";
import SalesPage from "./pages/SalesPage";
import SalesReturnPage from "./pages/SalesReturnPage";
import HoldPage from "./pages/HoldPage";
import ChallanPage from "./pages/ChallanPage";
import DailyExport from "./pages/DailyExport";
import ClientsPage from "./pages/ClientsPage";
import UserManagement from "./pages/UserManagement";
import NotFound from "./pages/NotFound";
import PendingDeliveries from "./pages/PendingDeliveries";
import DeliveredDeliveries from "./pages/DeliveredDeliveries";


const queryClient = new QueryClient();

const GlobalKeyboardShortcuts = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check Alt key shortcuts
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        const code = e.code;

        if (key === 's' || code === 'KeyS') {
          e.preventDefault();
          navigate('/sales');
        } else if (key === 'c' || code === 'KeyC') {
          e.preventDefault();
          navigate('/challans');
        } else if (key === 'p' || code === 'KeyP') {
          e.preventDefault();
          navigate('/purchases');
        } else if (key === 'l' || code === 'KeyL') {
          e.preventDefault();
          navigate('/stock');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  return null;
};


const App = () => {
  const [user, setUser] = useState(getCurrentUser());
  const handleLogin = useCallback(() => setUser(getCurrentUser()), []);
  const handleLogout = useCallback(() => { logout(); setUser(null); }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;

        // Only intercept if we are inside an input or select
        if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT') {
          return;
        }

        // Exclude specific input types where Enter should retain its default behavior
        if (target.tagName === 'INPUT') {
          const type = (target as HTMLInputElement).type;
          if (type === 'submit' || type === 'file' || type === 'reset') {
            return;
          }
        }

        // Get all focusable elements
        const focusableElements = Array.from(
          document.querySelectorAll<HTMLElement>(
            'input:not([disabled]):not([type="hidden"]):not([readonly]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter(el => el.tabIndex >= 0);

        const index = focusableElements.indexOf(target);
        if (index > -1) {
          e.preventDefault(); // Prevent form submission
          const nextElement = focusableElements[index + 1];
          if (nextElement) {
            nextElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!user) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider><Toaster /><LoginPage onLogin={handleLogin} /></TooltipProvider>
      </QueryClientProvider>
    );
  }

  const isAdmin = user.role === 'Admin';

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <GlobalKeyboardShortcuts />
          <SidebarProvider>
            <div className="min-h-screen flex w-full">
              <AppSidebar isAdmin={isAdmin} />
              <div className="flex-1 flex flex-col min-w-0">
                <header className="h-14 flex items-center justify-between border-b px-4 bg-card no-print">
                  <SidebarTrigger />
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{user.name} ({user.role})</span>
                    <Button variant="ghost" size="sm" onClick={handleLogout}><LogOut className="h-4 w-4" /></Button>
                  </div>
                </header>
                <main className="flex-1 p-4 md:p-6 overflow-auto">
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/stock" element={<StockList />} />
                    <Route path="/stock-entry" element={<StockEntry />} />
                    <Route path="/purchases" element={<PurchasePage />} />
                    <Route path="/sales" element={<SalesPage />} />
                    <Route path="/sales-returns" element={<SalesReturnPage />} />
                    <Route path="/holds" element={<HoldPage />} />
                    <Route path="/pending-orders" element={<PendingDeliveries />} />
                    <Route path="/delivered-orders" element={<DeliveredDeliveries />} />
                    <Route path="/challans" element={<ChallanPage />} />
                    <Route path="/export" element={<DailyExport />} />
                    <Route path="/clients" element={<ClientsPage />} />

                    {isAdmin && <Route path="/users" element={<UserManagement />} />}

                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </main>
              </div>
            </div>
          </SidebarProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
