import { LayoutDashboard, Package, PackagePlus, ShoppingCart, TrendingUp, ClipboardList, Download, Users, FileText, CheckCircle2, UserCircle } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Stock List", url: "/stock", icon: Package },
  { title: "Stock Entry", url: "/stock-entry", icon: PackagePlus },
  { title: "Purchases", url: "/purchases", icon: ShoppingCart },
  { title: "Sales", url: "/sales", icon: TrendingUp },
  { title: "Orders", url: "/orders", icon: ClipboardList },
  { title: "Pending Orders", url: "/pending-orders", icon: ClipboardList },
  { title: "Challans", url: "/challans", icon: FileText },
  { title: "Delivered Orders", url: "/delivered-orders", icon: CheckCircle2 },
  { title: "Daily Export", url: "/export", icon: Download },
  { title: "Clients", url: "/clients", icon: UserCircle },
  { title: "Users", url: "/users", icon: Users },
];


export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const filtered = isAdmin ? items : items.filter(i => i.url !== '/users');

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/70">
            {!collapsed && "🪵 Sonaply ERP"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filtered.map(item => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end={item.url === '/'} className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
