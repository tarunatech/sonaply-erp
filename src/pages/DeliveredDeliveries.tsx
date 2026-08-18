import { useState, useMemo, useEffect, useCallback } from "react";
import { getChallans, getSales, exportCSV, getBatches, Challan, Sale, StockBatch, formatLocalDate } from "@/lib/store";
import { format } from "date-fns";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Printer, Search } from "lucide-react";

const renderCustomer = (customerName: string) => {
  const match = customerName.match(/(.*?)\s*\(([^)]+)\)$/);
  if (match) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold text-slate-900 leading-tight">{match[1]}</span>
        <span className="text-[11px] text-slate-500 font-medium leading-none mt-0.5">({match[2]})</span>
      </div>
    );
  }
  return <span className="font-semibold text-slate-900 leading-tight">{customerName}</span>;
};

export default function DeliveredDeliveries() {
  const [challans, setChallans] = useState<Challan[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    const [c, s, b] = await Promise.all([getChallans(), getSales(), getBatches()]);
    // Only include non-cancelled Delivered challans
    setChallans(c.filter(challan => challan.status === "Delivered" && !challan.isCancelled));
    setSales(s);
    setBatches(b);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filteredChallans = useMemo(() => {
    const sorted = [...challans].sort((a, b) => {
      const saleA = sales.find(s => s.id === a.salesId);
      const saleB = sales.find(s => s.id === b.salesId);
      const dateA = saleA?.updatedAt || a.createdAt || "";
      const dateB = saleB?.updatedAt || b.createdAt || "";
      const dateCompare = dateB.localeCompare(dateA);
      if (dateCompare !== 0) return dateCompare;
      return (b.challanNo || '').localeCompare(a.challanNo || '', undefined, { numeric: true, sensitivity: "base" });
    });
    if (!filter) return sorted;
    const f = filter.toLowerCase();
    return sorted.filter(c => {
      const sale = sales.find(s => s.id === c.salesId);
      const orderNo = sale?.orderNo || "";
      return (c.customer || '').toLowerCase().includes(f) ||
             (c.product || '').toLowerCase().includes(f) ||
             (c.challanNo || '').toLowerCase().includes(f) ||
             orderNo.toLowerCase().includes(f);
    });
  }, [challans, sales, filter]);

  const groupedChallans = useMemo(() => {
    const groups: Record<string, Challan[]> = {};
    filteredChallans.forEach((c) => {
      if (!groups[c.challanNo]) groups[c.challanNo] = [];
      groups[c.challanNo].push(c);
    });
    return Object.entries(groups)
      .map(([challanNo, items]) => ({
        challanNo,
        customer: items[0].customer,
        clientPhone: items[0].clientPhone,
        createdAt: items[0].createdAt,
        items: items,
        salesId: items[0].salesId,
      }))
      .sort((a, b) => {
        const saleA = sales.find(s => s.id === a.salesId);
        const saleB = sales.find(s => s.id === b.salesId);
        const dateA = saleA?.updatedAt || a.createdAt || "";
        const dateB = saleB?.updatedAt || b.createdAt || "";
        const dateCompare = dateB.localeCompare(dateA);
        if (dateCompare !== 0) return dateCompare;
        return b.challanNo.localeCompare(a.challanNo, undefined, { numeric: true, sensitivity: "base" });
      });
  }, [filteredChallans, sales]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-green-600">Delivered Orders</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customer, product or challan/order #..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredChallans as any, `delivered-orders-${new Date().toISOString().slice(0, 10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
          <Button variant="outline" size="sm" onClick={() => printElement("delivered-table")}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0" id="delivered-table">
          <Table className="border-collapse border-2 border-slate-300 w-full" wrapperClassName="max-h-[calc(100vh-220px)]">
            <TableHeader className="sticky top-0 bg-slate-100 z-10 shadow-2xs border-b-2 border-slate-300">
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Date</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Challan #</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Client</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 w-2/5">Items / Quantities</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Status</TableHead>
              </TableRow>
            </TableHeader>
              <TableBody>
                {groupedChallans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="border-2 border-slate-300 text-center text-muted-foreground py-8">
                      No delivered orders found.
                    </TableCell>
                  </TableRow>
                ) : groupedChallans.map(group => {
                  return (
                    <TableRow key={group.challanNo} className="hover:bg-slate-50/40">
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700 font-medium whitespace-nowrap">{formatLocalDate(group.createdAt)}</TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 font-mono text-xs font-bold text-slate-900">{group.challanNo}</TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm min-w-[150px] max-w-[220px] break-words">
                        {renderCustomer(group.customer)}
                        <div className="text-[10px] text-muted-foreground mt-1">{group.clientPhone}</div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3">
                        <div className="text-sm space-y-2">
                          {group.items.map((item: any, idx: number) => {
                            return (
                              <div key={idx} className="border-b border-slate-100 last:border-0 pb-2 last:pb-0">
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-semibold text-slate-900">{item.product}</span>
                                    {item.batchNo && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                        Batch: {item.batchNo}
                                      </span>
                                    )}
                                    {item.stockCategory && (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                        item.stockCategory === 'Display' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                                        item.stockCategory === 'Damage' ? 'bg-red-50 text-red-800 border border-red-200' :
                                        'bg-blue-50 text-blue-800 border border-blue-200'
                                      }`}>
                                        {item.stockCategory}
                                      </span>
                                    )}
                                  </div>
 
                                  <span className="font-bold text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200">
                                    {item.quantity} Qty
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          {/* Show group-level narration one time only */}
                          {(() => {
                            const firstWithNotes = group.items.find(i => i.notes);
                            if (firstWithNotes && firstWithNotes.notes) {
                              return (
                                <div className="text-[10px] text-orange-600 font-semibold mt-2 bg-orange-50 px-2 py-1 rounded border border-orange-100 w-fit">
                                  Narration: {firstWithNotes.notes}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                          🚚 Delivered
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  );
}
