import { useState, useMemo, useEffect, useCallback } from "react";
import { getSales, getChallans, exportCSV, addChallan, getBatches, confirmChallanGroup, deleteChallanGroup, Sale, StockBatch, Challan, formatLocalDate } from "@/lib/store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Download, Printer, Search, FilePlus2, CheckCircle2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

export default function PendingDeliveries() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [challans, setChallans] = useState<Challan[]>([]);
  const [cancelledPChallans, setCancelledPChallans] = useState<Challan[]>([]);
  const [filter, setFilter] = useState("");
  const { toast } = useToast();
  const [showChallanDialog, setShowChallanDialog] = useState(false);
  const [currentSale, setCurrentSale] = useState<Sale | null>(null);
  const [challanForm, setChallanForm] = useState({ quantity: 0, batchNo: "", notes: "", stockCategory: "Available" });
  const [batches, setBatches] = useState<StockBatch[]>([]);

  const refresh = useCallback(async () => {
    const [s, b, c] = await Promise.all([getSales(), getBatches(), getChallans()]);
    setBatches(b);
    setChallans(c);

    // Filter sales to ONLY show those with unhandled pending quantities or pending P-xxxx draft challans
    const pendingSales = s.filter(sale => {
      if (sale.status === "Delivered" || sale.status === "Cancelled" || !sale.pendingQty || sale.pendingQty <= 0) return false;

      const saleChallans = c.filter(ch => ch.salesId === sale.id && !ch.isCancelled);
      
      // Check if there is a P-xxxx challan waiting in Pending state
      const hasPendingPChallan = saleChallans.some(
        ch => ch.challanNo.startsWith("P-") && ch.status === "Pending"
      );
      if (hasPendingPChallan) return true;

      // Calculate quantity already covered by CH-xxxx challans or Confirmed/Delivered P-xxxx challans
      const coveredQty = saleChallans.reduce((sum, ch) => {
        const isCH = ch.challanNo.startsWith("CH-") || ch.challanNo.startsWith("CH");
        const isConfirmedOrDelivered = ch.status === "Confirmed" || ch.status === "Delivered";
        if (isCH || isConfirmedOrDelivered) {
          return sum + Number(ch.quantity || 0);
        }
        return sum;
      }, 0);

      const unhandledPendingQty = (sale.pendingQty || 0) - coveredQty;
      return unhandledPendingQty > 0;
    });

    setSales(pendingSales);

    // Track cancelled P-xxx challans so admin can see and delete them
    const cancelledP = c.filter(ch =>
      ch.challanNo.startsWith("P-") && ch.isCancelled
    );
    setCancelledPChallans(cancelledP);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const getPendingChallanForSale = (saleId: string): Challan | null =>
    challans.find(c =>
      c.salesId === saleId &&
      c.challanNo.startsWith("P-") &&
      c.status === "Pending" &&
      !c.isCancelled
    ) ?? null;

  const getUnhandledPendingQty = (sale: Sale): number => {
    const saleChallans = challans.filter(ch => ch.salesId === sale.id && !ch.isCancelled);
    const pendingP = saleChallans.find(ch => ch.challanNo.startsWith("P-") && ch.status === "Pending");
    if (pendingP) return Number(pendingP.quantity || 0);

    const coveredQty = saleChallans.reduce((sum, ch) => {
      const isCH = ch.challanNo.startsWith("CH-") || ch.challanNo.startsWith("CH");
      const isConfirmedOrDelivered = ch.status === "Confirmed" || ch.status === "Delivered";
      if (isCH || isConfirmedOrDelivered) {
        return sum + Number(ch.quantity || 0);
      }
      return sum;
    }, 0);
    return Math.max(0, (sale.pendingQty || 0) - coveredQty);
  };

  const handleConfirmChallan = async (challan: Challan) => {
    if (!window.confirm(`Confirm ${challan.challanNo}? It will move to the Delivery Challans page.`)) return;
    try {
      await confirmChallanGroup(challan.challanNo);
      toast({ title: "Challan Confirmed", description: `${challan.challanNo} moved to Delivery Challans page.` });
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      refresh();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteCancelledP = async (challanNo: string) => {
    if (!window.confirm(`Delete cancelled challan ${challanNo}? This cannot be undone.`)) return;
    try {
      await deleteChallanGroup(challanNo);
      toast({ title: "Deleted", description: `${challanNo} removed.` });
      refresh();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleCreateChallan = async () => {
    if (!currentSale) return;
    const maxQty = getUnhandledPendingQty(currentSale);
    if (challanForm.quantity <= 0 || challanForm.quantity > maxQty) {
      toast({ title: "Invalid Quantity", description: `Quantity must be between 1 and ${maxQty}`, variant: "destructive" });
      return;
    }
    try {
      const createdChallan = await addChallan({
        salesId: currentSale.id,
        customer: currentSale.customer,
        clientPhone: currentSale.clientPhone,
        product: currentSale.product,
        quantity: challanForm.quantity,
        batchNo: challanForm.batchNo || "0",
        notes: challanForm.notes,
        stockCategory: challanForm.stockCategory as any,
        status: "Pending",
      } as any);
      toast({ title: "Pending Challan Created", description: `${createdChallan.challanNo} created. Click Confirm to move it to Delivery Challans.` });
      setShowChallanDialog(false);
      setChallanForm({ quantity: 0, batchNo: "", notes: "", stockCategory: "Available" });
      setCurrentSale(null);
      refresh();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create challan", variant: "destructive" });
    }
  };

  const filteredSales = useMemo(() => {
    const base = filter
      ? sales.filter(s => {
          const f = filter.toLowerCase();
          return s.customer.toLowerCase().includes(f) || s.product.toLowerCase().includes(f) || s.orderNo.toLowerCase().includes(f);
        })
      : sales;
    return base.sort((a, b) => {
      const dateA = a.updatedAt || a.createdAt || a.orderDate || "";
      const dateB = b.updatedAt || b.createdAt || b.orderDate || "";
      const dateCompare = dateB.localeCompare(dateA);
      if (dateCompare !== 0) return dateCompare;
      return b.orderNo.localeCompare(a.orderNo, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [sales, filter]);

  const currentProductBatches = useMemo(() => currentSale ? batches.filter(b => b.productName === currentSale.product) : [], [currentSale, batches]);

  const currentBatchOptions = useMemo(() => {
    const list = new Set<string>();
    if (currentSale?.batchNo) list.add(currentSale.batchNo);
    currentProductBatches.forEach(b => { if (b.batchNumber) list.add(b.batchNumber); });
    return Array.from(list);
  }, [currentSale, currentProductBatches]);

  const groupedPendingDeliveries = useMemo(() => {
    const groups: Record<string, {
      groupKey: string;
      orderNo: string;
      challanNo: string | null;
      customer: string;
      clientPhone: string;
      orderDate: string;
      createdAt: string | null;
      status: string;
      salesItems: {
        sale: Sale;
        pendingChallan: Challan | null;
        displayPendingQty: number;
        totalStock: number;
      }[];
    }> = {};

    filteredSales.forEach(s => {
      const pendingChallan = getPendingChallanForSale(s.id);
      const groupKey = pendingChallan ? pendingChallan.challanNo : s.orderNo;
      
      const displayPendingQty = getUnhandledPendingQty(s);
      
      const totalStock = batches
        .filter(b => b.productName.trim().toLowerCase() === s.product.trim().toLowerCase())
        .reduce((acc, curr) => {
          const col = s.stockCategory === "Display" ? curr.displayQty : s.stockCategory === "Damage" ? curr.damageQty : curr.availableQty;
          return acc + Number(col || 0);
        }, 0);

      if (!groups[groupKey]) {
        groups[groupKey] = {
          groupKey,
          orderNo: s.orderNo,
          challanNo: pendingChallan ? pendingChallan.challanNo : null,
          customer: s.customer,
          clientPhone: s.clientPhone,
          orderDate: s.orderDate,
          createdAt: pendingChallan ? pendingChallan.createdAt : null,
          status: s.status,
          salesItems: []
        };
      }
      
      groups[groupKey].salesItems.push({
        sale: s,
        pendingChallan,
        displayPendingQty,
        totalStock
      });
    });

    return Object.values(groups);
  }, [filteredSales, challans, batches]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-red-600">Pending Deliveries</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search customer, product or order..." value={filter} onChange={e => setFilter(e.target.value)} className="pl-9 h-9" />
          </div>
          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredSales as any, `pending-${new Date().toISOString().slice(0,10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
          <Button variant="outline" size="sm" onClick={() => printElement("pending-table")}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0" id="pending-table">
          <div className="overflow-x-auto">
            <Table className="border-collapse border-2 border-slate-300 w-full">
              <TableHeader className="bg-slate-50/75">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Date</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Challan #</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Client</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Product</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Ordered</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right text-green-600">Delivered</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right text-red-600">Pending Qty</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Status</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedPendingDeliveries.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="border-2 border-slate-300 text-center text-muted-foreground py-8">No pending deliveries!</TableCell></TableRow>
                ) : groupedPendingDeliveries.map(group => {
                  return (
                    <TableRow key={group.groupKey} className="hover:bg-slate-50/40">
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700 font-medium whitespace-nowrap">
                        {formatLocalDate(group.createdAt || group.orderDate)}
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 font-mono text-xs text-slate-700">
                        <div className="font-semibold text-slate-900">{group.orderNo}</div>
                        {group.challanNo && (
                          <div className="text-[10px] font-bold text-orange-600 mt-1 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded w-fit">
                             {group.challanNo}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm min-w-[150px] max-w-[220px] break-words">
                        {renderCustomer(group.customer)}
                        <div className="text-[10px] text-muted-foreground mt-1">{group.clientPhone}</div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-1">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1.5 border-b border-slate-100 last:border-0 flex flex-col justify-center min-h-[50px]">
                              <div className="font-semibold text-slate-900">{item.sale.product}</div>
                              <div className="flex flex-wrap gap-1 items-center mt-1">
                                {item.sale.batchNo && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                    Batch: {item.sale.batchNo}
                                  </span>
                                )}
                                {item.totalStock >= 0 ? (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-green-50 text-green-800 border border-green-200">
                                    Stock: Ready ({item.totalStock} extra, {item.sale.stockCategory || "Available"})
                                  </span>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-50 text-red-800 border border-red-200">
                                    Stock: Shortage (Need {Math.abs(item.totalStock)}, {item.sale.stockCategory || "Available"})
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                          {/* Show group-level narration one time only */}
                          {(() => {
                            const firstWithNotes = group.salesItems.find(i => i.pendingChallan?.notes || i.sale.remarks);
                            const notesText = firstWithNotes?.pendingChallan?.notes || firstWithNotes?.sale.remarks;
                            if (notesText) {
                              return (
                                <div className="text-[10px] text-orange-600 font-semibold mt-2 bg-orange-50 px-2 py-1 rounded border border-orange-100 w-fit">
                                  Narration: {notesText}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-1 text-right">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1.5 border-b border-slate-100 last:border-0 flex items-center justify-end min-h-[50px] font-semibold text-slate-700">
                              {item.sale.orderedQty}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-1 text-right">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1.5 border-b border-slate-100 last:border-0 flex items-center justify-end min-h-[50px] font-semibold text-green-600">
                              {item.sale.deliveredQty}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-1 text-right">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1.5 border-b border-slate-100 last:border-0 flex items-center justify-end min-h-[50px] font-black text-red-600 text-lg">
                              {item.displayPendingQty}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                          group.status === "Confirmed" ? "bg-blue-100 text-blue-800" :
                          group.status === "Partial"   ? "bg-amber-100 text-amber-800" :
                                                         "bg-red-100 text-red-800"
                        }`}>{group.status}</span>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-1 text-right align-middle">
                        {group.challanNo ? (
                          <div className="flex justify-end items-center min-h-[50px]">
                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-xs" onClick={() => handleConfirmChallan(group.salesItems[0].pendingChallan!)}>
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Confirm {group.challanNo}
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-0">
                            {group.salesItems.map((item, idx) => (
                              <div key={idx} className="py-1.5 border-b border-slate-100 last:border-0 flex items-center justify-end min-h-[50px]">
                                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-[10px] h-7 px-2" onClick={() => {
                                  setCurrentSale(item.sale);
                                  setChallanForm({ quantity: item.displayPendingQty, batchNo: item.sale.batchNo || "0", notes: "", stockCategory: item.sale.stockCategory || "Available" });
                                  setShowChallanDialog(true);
                                }}>
                                  <FilePlus2 className="mr-1 h-3 w-3" /> Generate
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Cancelled P-xxx Challans Section */}
      {cancelledPChallans.length > 0 && (
        <Card className="border-red-200">
          <CardContent className="p-0">
            <div className="px-4 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2">
              <span className="text-sm font-bold text-red-700">Cancelled Pending Orders</span>
              <span className="text-xs text-red-500">({cancelledPChallans.length}) — These were cancelled because the parent challan was cancelled</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Challan #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Cancelled At</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cancelledPChallans.map(ch => (
                    <TableRow key={ch.id} className="bg-red-50 border-l-4 border-l-red-400 opacity-80">
                      <TableCell className="font-mono text-xs font-bold text-red-700">{ch.challanNo}</TableCell>
                      <TableCell>{ch.customer}</TableCell>
                      <TableCell>{ch.product}</TableCell>
                      <TableCell className="text-right font-semibold">{ch.quantity}</TableCell>
                      <TableCell className="text-xs">
                        {formatLocalDate(ch.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-red-600 font-semibold italic">Cancelled</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDeleteCancelledP(ch.challanNo)}
                            title="Delete Cancelled Challan"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}


      <Dialog open={showChallanDialog} onOpenChange={setShowChallanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Pending Challan (P-xxxx)</DialogTitle>
            <DialogDescription>
              Creates a P-xxxx pending challan. After purchasing stock, click "Confirm Challan" to move it to the Delivery Challans page.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-xs font-bold">Qty</Label>
              <Input type="number" className="col-span-3" value={challanForm.quantity} onChange={e => setChallanForm({ ...challanForm, quantity: Number(e.target.value) })} max={currentSale ? getUnhandledPendingQty(currentSale) : 0} min={1} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-xs font-bold">Batch</Label>
              <div className="col-span-3">
                <Select value={challanForm.batchNo} onValueChange={v => setChallanForm({ ...challanForm, batchNo: v })}>
                  <SelectTrigger><SelectValue placeholder="Select Batch" /></SelectTrigger>
                  <SelectContent>
                    {currentBatchOptions.map(bNo => {
                      const bv = bNo || "0";
                      const mb = currentProductBatches.find(b => (b.batchNumber || "0") === bv);
                      const avail = mb ? (currentSale?.stockCategory === "Display" ? mb.displayQty : currentSale?.stockCategory === "Damage" ? mb.damageQty : mb.availableQty) : 0;
                      return <SelectItem key={bv} value={bv}>{bv} {mb ? `(Stock: ${avail})` : ""}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-xs font-bold">Category</Label>
              <div className="col-span-3">
                <Select value={challanForm.stockCategory} onValueChange={v => setChallanForm({ ...challanForm, stockCategory: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Available">Available</SelectItem>
                    <SelectItem value="Display">Display</SelectItem>
                    <SelectItem value="Damage">Damage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-xs font-bold">Notes</Label>
              <Input className="col-span-3" value={challanForm.notes} onChange={e => setChallanForm({ ...challanForm, notes: e.target.value })} placeholder="Notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChallanDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateChallan} className="bg-green-600 hover:bg-green-700">Create Pending Challan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
