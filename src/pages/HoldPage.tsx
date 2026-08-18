import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getHolds, releaseHold, cancelHold, Hold, exportCSV, formatLocalDate } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Download, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

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

export default function HoldPage() {
  const navigate = useNavigate();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const fetchHolds = async () => {
    try {
      const data = await getHolds();
      setHolds(data);
    } catch (error) {
      toast({ title: "Failed to fetch holds", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolds();
  }, []);

  const handleRelease = async (id: string) => {
    try {
      await releaseHold(id);
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      toast({ title: "Hold released", description: "Order moved to Sales." });
      navigate("/sales");
    } catch (error) {
      toast({ title: "Failed to release hold", variant: "destructive" });
    }
  };

  const handleCancelHold = async (id: string) => {
    if (!window.confirm("Cancel this hold and restore quantity back to Available stock?")) return;
    try {
      await cancelHold(id);
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      toast({ title: "Hold cancelled", description: "Stock restored to Available." });
      fetchHolds();
    } catch (error: any) {
      toast({ title: "Failed to cancel hold", description: error?.message || "An error occurred", variant: "destructive" });
    }
  };

  const groupedHolds = useMemo(() => {
    const groups: Record<string, Hold[]> = {};
    holds.forEach((h) => {
      const key = `${h.clientName}_${h.holdDate}_${h.clientPhone || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(h);
    });
    return Object.values(groups).map((items) => ({
      id: items.map((item) => item.id).join(","),
      clientName: items[0].clientName,
      clientPhone: items[0].clientPhone,
      holdDate: items[0].holdDate,
      quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      items: items,
    }));
  }, [holds]);

  const filteredHolds = useMemo(() => {
    return groupedHolds.filter((g) =>
      (g.clientName || '').toLowerCase().includes(search.toLowerCase()) ||
      g.items.some((item) => (item.productName || '').toLowerCase().includes(search.toLowerCase()))
    );
  }, [groupedHolds, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-amber-600">Active Holds</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by client or product..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredHolds as any, `holds-${new Date().toISOString().slice(0, 10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
          <Button variant="outline" size="sm" onClick={() => printElement("holds-table")}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0" id="holds-table">
          <Table className="border-collapse border-2 border-slate-300 w-full" wrapperClassName="max-h-[calc(100vh-130px)]">
            <TableHeader className="sticky top-0 bg-slate-100 z-10 shadow-2xs border-b-2 border-slate-300">
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Date</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Client Name</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Product</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Batch</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Quantity</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="border-2 border-slate-300 text-center py-4">Loading...</TableCell>
                  </TableRow>
                ) : filteredHolds.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="border-2 border-slate-300 text-center py-8 text-muted-foreground">No active holds found.</TableCell>
                  </TableRow>
                ) : (
                  filteredHolds.map((h) => (
                    <TableRow key={h.id} className="hover:bg-slate-50/40">
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700 font-medium whitespace-nowrap">
                        {formatLocalDate(h.holdDate)}
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm min-w-[150px] max-w-[220px] break-words">
                        {renderCustomer(h.clientName)}
                        {h.clientPhone && (
                          <div className="text-[10px] text-muted-foreground mt-1">{h.clientPhone}</div>
                        )}
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm font-medium text-slate-900">
                        <div className="flex flex-col gap-1.5">
                          {h.items.map((item, idx) => (
                            <div key={item.id} className={idx > 0 ? "border-t pt-1.5 border-slate-100" : ""}>
                              {item.productName}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm">
                        <div className="flex flex-col gap-1.5">
                          {h.items.map((item, idx) => (
                            <div key={item.id} className={idx > 0 ? "border-t pt-1.5 border-slate-100" : ""}>
                              {item.batchNo ? (
                                <span className="px-1.5 py-0.5 rounded font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                  Batch: {item.batchNo}
                                </span>
                              ) : (
                                '-'
                              )}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-right font-semibold text-amber-600 text-sm">
                        <div className="flex flex-col gap-1.5">
                          {h.items.map((item, idx) => (
                            <div key={item.id} className={idx > 0 ? "border-t pt-1.5 border-slate-100" : ""}>
                              {item.quantity}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-right no-print">
                        <div className="flex items-center justify-end gap-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleRelease(h.id)} 
                            className="text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700 h-8"
                          >
                            Release Hold to Challan
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleCancelHold(h.id)} 
                            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 h-8"
                          >
                            Cancel Hold
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  );
}
