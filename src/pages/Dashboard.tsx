import { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getBatches, getSales, getPurchases, getOrders, CATEGORIES } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Package, Clock, TrendingUp, ShoppingCart, AlertTriangle, FileText } from "lucide-react";

const COLORS = ["hsl(213,94%,48%)", "hsl(142,76%,36%)", "hsl(25,95%,53%)", "hsl(0,84%,60%)", "hsl(280,65%,60%)", "hsl(38,92%,50%)", "hsl(180,60%,45%)", "hsl(330,70%,55%)"];

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);

  const refreshData = useCallback(async () => {
    const [batches, sales, purchases, orders] = await Promise.all([
      getBatches(), getSales(), getPurchases(), getOrders()
    ]);
    const today = new Date().toISOString().slice(0, 10);

    const totalStock = batches.reduce((s, b) => s + b.availableQty, 0);
    const pendingOrdersCount = orders.filter(o => o.status === 'Pending').length;
    const todaySales = sales.filter(s => s.orderDate === today).reduce((a, s) => a + (s.totalPrice || 0), 0);
    const todayPurchases = purchases.filter(p => p.date === today).reduce((a, p) => a + (p.totalAmount || 0), 0);

    const catDist = CATEGORIES.map(c => ({
      name: c, value: batches.filter(b => b.category === c).reduce((s, b) => s + b.availableQty, 0)
    })).filter(c => c.value > 0);

    const challans = await (await fetch('/api/challans')).json();
    const todayChallans = challans.filter((c: any) => c.date === today).length;

    const months: Record<string, number> = {};
    sales.forEach(s => {
      const m = s.orderDate.slice(0, 7);
      months[m] = (months[m] || 0) + (s.totalPrice || 0);
    });
    const monthlySales = Object.entries(months).sort().slice(-6).map(([m, v]) => ({ month: m, sales: v }));

    setData({ totalStock, pendingOrders: pendingOrdersCount, todaySales, todayPurchases, todayChallans, catDist, monthlySales });
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const cards = useMemo(() => {
    if (!data) return [];
    return [
      { title: "Total Stock", value: data.totalStock, icon: Package, color: "text-primary", url: "/stock" },
      { title: "Pending Orders", value: data.pendingOrders, icon: Clock, color: "text-warning", url: "/orders" },
      { title: "Today's Sales", value: `₹${data.todaySales.toLocaleString()}`, icon: TrendingUp, color: "text-success", url: "/sales" },
      { title: "Today's Purchases", value: `₹${data.todayPurchases.toLocaleString()}`, icon: ShoppingCart, color: "text-primary", url: "/purchases" },
      { title: "Today's Challans", value: data.todayChallans, icon: FileText, color: "text-blue-500", url: "/challans" },
    ];
  }, [data]);

  if (!data) return <div className="flex items-center justify-center h-full">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(c => (
          <Card 
            key={c.title} 
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => {
              if (c.url) navigate(c.url);
            }}
          >
            <CardContent className="flex items-center gap-4 p-6">
              <c.icon className={`h-10 w-10 ${c.color}`} />
              <div>
                <p className="text-sm text-muted-foreground">{c.title}</p>
                <p className="text-2xl font-bold">{c.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Monthly Sales</CardTitle></CardHeader>
          <CardContent className="h-72">
            {data.monthlySales.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlySales}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} /><Bar dataKey="sales" fill="hsl(213,94%,48%)" radius={[4,4,0,0]} /></BarChart>
              </ResponsiveContainer>
            ) : <p className="text-muted-foreground text-center pt-20">No sales data yet</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Category Distribution</CardTitle></CardHeader>
          <CardContent className="h-72">
            {data.catDist.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={data.catDist} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {data.catDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            ) : <p className="text-muted-foreground text-center pt-20">No stock data yet</p>}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
