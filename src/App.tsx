import { useState, useCallback, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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
import OrderTracking from "./pages/OrderTracking";
import DeliveredOrders from "./pages/DeliveredOrders";
import PendingOrders from "./pages/PendingOrders";
import ChallanPage from "./pages/ChallanPage";
import DailyExport from "./pages/DailyExport";
import ClientsPage from "./pages/ClientsPage";
import UserManagement from "./pages/UserManagement";
import NotFound from "./pages/NotFound";


const queryClient = new QueryClient();


const App = () => {
  const [user, setUser] = useState(getCurrentUser());
  const handleLogin = useCallback(() => setUser(getCurrentUser()), []);
  const handleLogout = useCallback(() => { logout(); setUser(null); }, []);

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
                    <Route path="/orders" element={<OrderTracking />} />
                    <Route path="/pending-orders" element={<PendingOrders />} />
                    <Route path="/delivered-orders" element={<DeliveredOrders />} />
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
