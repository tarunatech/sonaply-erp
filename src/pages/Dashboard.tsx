import { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboardStats, DashboardStats } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Package, Clock, TrendingUp, ShoppingCart, FileText } from "lucide-react";

const COLORS = ["hsl(213,94%,48%)", "hsl(142,76%,36%)", "hsl(25,95%,53%)", "hsl(0,84%,60%)", "hsl(280,65%,60%)", "hsl(38,92%,50%)", "hsl(180,60%,45%)", "hsl(330,70%,55%)"];

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardStats | null>(null);

  const refreshData = useCallback(async () => {
    try {
      const stats = await getDashboardStats();
      setData(stats);
    } catch (err) {
      console.error("Failed to load dashboard stats:", err);
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const cards = useMemo(() => {
    if (!data) return [];
    return [
      { title: "Total Stock", value: `${data.totalStock.toLocaleString()} units`, icon: Package, color: "text-primary", url: "/stock" },
      { title: "Pending Deliveries", value: data.pendingDeliveries.toLocaleString(), icon: Clock, color: "text-warning", url: "/pending-orders" },
      { title: "Today's Sales Qty", value: `${(data.todaySalesQty ?? data.todaySales).toLocaleString()} Qty`, icon: TrendingUp, color: "text-success", url: "/sales" },
      { title: "Today's Purchases Qty", value: `${(data.todayPurchasesQty ?? data.todayPurchases).toLocaleString()} Qty`, icon: ShoppingCart, color: "text-primary", url: "/purchases" },
      { title: "Today's Challans", value: data.todayChallans.toLocaleString(), icon: FileText, color: "text-blue-500", url: "/challans" },
    ];
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    const source = data.monthlyComparison || data.monthlySales || [];
    return source.map((item) => {
      const parts = item.month.split("-");
      let formattedMonth = item.month;
      if (parts.length === 2) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
        if (!isNaN(d.getTime())) {
          formattedMonth = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        }
      }
      return {
        ...item,
        formattedMonth,
        purchaseQty: Number(item.purchaseQty ?? 0),
        salesQty: Number(item.salesQty ?? item.sales ?? 0),
      };
    });
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
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Monthly Purchases vs Sales Qty</CardTitle>
            <p className="text-xs text-muted-foreground">Last 6 months comparison (Units)</p>
          </CardHeader>
          <CardContent className="h-72">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="formattedMonth" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(val: number, name: string) => [`${val.toLocaleString()} units`, name]}
                    contentStyle={{ borderRadius: "8px", border: "1px solid #cbd5e1" }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ paddingBottom: "10px", fontSize: "12px" }}
                  />
                  <Bar dataKey="purchaseQty" name="Purchase Qty" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="salesQty" name="Sales Qty" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-muted-foreground text-center pt-20">No monthly data yet</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Category Distribution</CardTitle></CardHeader>
          <CardContent className="h-72">
            {data.catDist.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.catDist} cx="50%" cy="50%" outerRadius={80} dataKey="value">
                    {data.catDist.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `${v.toLocaleString()} units`} />
                  <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: "20px", fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-muted-foreground text-center pt-20">No stock data yet</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
