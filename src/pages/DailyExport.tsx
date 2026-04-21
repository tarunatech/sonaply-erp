import { useState } from "react";
import { getSales, getPurchases, getBatches, getOrders, exportCSV } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";

export default function DailyExport() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const doExport = (type: string) => {
    const d = date;
    let data: Record<string, unknown>[] = [];
    switch (type) {
      case 'sales': data = getSales().filter(s => s.orderDate === d) as any; break;
      case 'purchases': data = getPurchases().filter(p => p.date === d) as any; break;
      case 'stock': data = getBatches().filter(b => b.date === d) as any; break;
      case 'orders': data = getOrders().filter(o => o.orderDate === d) as any; break;
    }
    if (!data.length) { alert('No data for this date'); return; }
    exportCSV(data, `daily-${type}-${d}.csv`);
  };

  const exports = [
    { key: 'sales', title: 'Daily Sales', desc: 'Export all sales for the selected date' },
    { key: 'purchases', title: 'Daily Purchases', desc: 'Export all purchases for the selected date' },
    { key: 'stock', title: 'Daily Stock Updates', desc: 'Export stock entries for the selected date' },
    { key: 'orders', title: 'Daily Orders', desc: 'Export all orders for the selected date' },
  ];

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Daily Export</h1>
      <div className="w-48">
        <Label>Select Date</Label>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {exports.map(e => (
          <Card key={e.key}>
            <CardHeader className="pb-2"><CardTitle className="text-lg">{e.title}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">{e.desc}</p>
              <Button variant="outline" onClick={() => doExport(e.key)}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
