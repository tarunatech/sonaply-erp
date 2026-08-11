import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  getChallans,
  getSales,
  getBatches,
  updateChallan,
  updateChallanGroup,
  deleteChallan,
  deleteChallanGroup,
  cancelChallanGroup,
  confirmChallanGroup,
  deliverChallanGroup,
  exportCSV,
  Challan,
  Sale,
  StockBatch,
} from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Download,
  Printer,
  Trash2,
  Pencil,
  CheckSquare,
  CheckCircle2,
  Ban,
  Truck,
  FileSpreadsheet,
  Search,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const renderCustomer = (customerName: string) => {
  const match = customerName.match(/(.*?)\s*\(([^)]+)\)$/);
  if (match) {
    return (
      <div className="flex flex-col gap-0.5 max-w-[200px]">
        <span className="font-bold text-slate-900 leading-snug text-sm break-words">{match[1]}</span>
        <span className="text-xs text-slate-500 font-medium leading-tight break-all">({match[2]})</span>
      </div>
    );
  }
  return <span className="font-bold text-slate-900 leading-snug text-sm break-words max-w-[200px] block">{customerName}</span>;
};

export default function ChallanPage() {
  const [challans, setChallans] = useState<Challan[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [filter, setFilter] = useState("");
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(-1);
  const suggestionContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const getSuggestionsList = useCallback((query: string) => {
    const q = query.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    const filtered = batches.filter(b => {
      if (!tokens.length) return true;
      const fullText = `${b.productName || ''} ${b.productCode || ''} ${b.category || ''} ${b.batchNumber || ''}`.toLowerCase();
      return tokens.every(token => fullText.includes(token));
    });

    const list: { batch: StockBatch; category: 'Available' | 'Display' | 'Damage'; label: string }[] = [];
    filtered.forEach(b => {
      const hasDisplay = (b.displayQty || 0) > 0;
      const hasDamage = (b.damageQty || 0) > 0;

      list.push({ batch: b, category: 'Available', label: 'Available' });

      if (hasDisplay) {
        list.push({ batch: b, category: 'Display', label: 'Display' });
      }
      if (hasDamage) {
        list.push({ batch: b, category: 'Damage', label: 'Damage' });
      }
    });
    return list;
  }, [batches]);

  useEffect(() => {
    if (selectedSuggestionIndex >= 0 && suggestionContainerRef.current) {
      const activeElement = suggestionContainerRef.current.children[selectedSuggestionIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, [selectedSuggestionIndex]);

  const refresh = useCallback(() => {
    Promise.all([getChallans(), getSales(), getBatches()]).then(([c, s, b]) => {
      setChallans(c);
      setSales(s);
      setBatches(b);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const groupedChallans = useMemo(() => {
    const groups: Record<string, Challan[]> = {};
    challans.forEach((c) => {
      if (!groups[c.challanNo]) groups[c.challanNo] = [];
      groups[c.challanNo].push(c);
    });
    return Object.entries(groups)
      .map(([challanNo, items]) => ({
        challanNo,
        customer: items[0].customer,
        createdAt: items[0].createdAt,
        items: items,
        isPrinted: items.every((i) => i.isPrinted),
        isBuilt: items.every((i) => i.isBuilt),
        isChallanGenerated: items.every((i) => i.isChallanGenerated),
        isCancelled: items.some((i) => i.isCancelled || i.status === "Cancelled"),
        status: items[0].status,
        salesId: items[0].salesId,
        id: items[0].id,
      }))
      .filter((g) => {
        if (g.status === "Delivered") return false;
        const isCH = g.challanNo.startsWith("CH-") || g.challanNo.startsWith("CH");
        const isP = g.challanNo.startsWith("P-");
        if (isCH) return true;
        if (isP) return g.status === "Confirmed";
        return true;
      })
      .sort((a, b) => {
        const saleA = sales.find(s => s.id === a.salesId);
        const saleB = sales.find(s => s.id === b.salesId);
        const dateA = saleA?.updatedAt || a.createdAt || "";
        const dateB = saleB?.updatedAt || b.createdAt || "";
        const dateCompare = dateB.localeCompare(dateA);
        if (dateCompare !== 0) return dateCompare;
        return b.challanNo.localeCompare(a.challanNo, undefined, { numeric: true, sensitivity: "base" });
      });
  }, [challans, sales]);

  const filteredGroupedChallans = useMemo(() => {
    if (!filter) return groupedChallans;
    const f = filter.toLowerCase();
    return groupedChallans.filter(g => {
      const orderNo = sales.find(s => s.id === g.salesId)?.orderNo || "";
      return g.challanNo.toLowerCase().includes(f) ||
             g.customer.toLowerCase().includes(f) ||
             orderNo.toLowerCase().includes(f) ||
             g.items.some(item => item.product.toLowerCase().includes(f));
    });
  }, [groupedChallans, filter, sales]);

  const filteredChallansForExport = useMemo(() => {
    if (!filter) return challans;
    const f = filter.toLowerCase();
    return challans.filter(c => {
      const sale = sales.find(s => s.id === c.salesId);
      const orderNo = sale?.orderNo || "";
      return c.customer.toLowerCase().includes(f) ||
             c.product.toLowerCase().includes(f) ||
             c.challanNo.toLowerCase().includes(f) ||
             orderNo.toLowerCase().includes(f);
    });
  }, [challans, sales, filter]);

  const openEditDialog = (group: any) => {
    setEditingGroup({
      challanNumber: group.challanNo,
      salesId: group.salesId,
      clientName: group.customer,
      clientPhone: group.items[0]?.clientPhone || "",
      date: group.createdAt ? new Date(group.createdAt).toISOString().slice(0, 10) : "",
      items: group.items.map((item: Challan) => {
        const itemSale = sales.find((s) => s.id === item.salesId);
        const totalOrderQty = itemSale ? itemSale.orderedQty : item.quantity;
        return {
          id: item.id,
          salesId: item.salesId,
          productName: item.product,
          quantity: totalOrderQty,
          fulfilledQty: item.quantity,
          batchNo: item.batchNo,
          notes: item.notes || "",
          stockCategory: item.stockCategory || "Available",
          isProductSelected: true,
        };
      }),
    });
  };

  const handleDelete = async (challanNo: string) => {
    const password = window.prompt(
      "Please enter admin password to delete entire challan:",
    );
    if (password !== "admin") {
      if (password !== null)
        toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (
      window.confirm(
        `Are you sure you want to delete challan ${challanNo} and all its items?`,
      )
    ) {
      try {
        await deleteChallanGroup(challanNo);
        refresh();
        toast({ title: "Challan deleted" });
      } catch (err: any) {
        toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      }
    }
  };

  const handleStatusChange = async (group: any, newStatus: string) => {
    if (newStatus === group.status) return;
    try {
      if (newStatus === "Confirmed") {
        await confirmChallanGroup(group.challanNo);
        toast({ title: "Challan Confirmed", description: `${group.challanNo} marked as Confirmed.` });
      } else if (newStatus === "Delivered") {
        const ok = window.confirm(`Deliver ${group.challanNo}?`);
        if (!ok) return;
        await deliverChallanGroup(group.challanNo);
        toast({ title: "Challan Delivered", description: `${group.challanNo} delivered successfully.` });
      }
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      refresh();
    } catch (err: any) {
      toast({ title: "Status Change Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleDeliver = async (group: any) => {
    const ok = window.confirm(`Deliver order ${group.challanNo}? This will mark it as Delivered.`);
    if (!ok) return;
    try {
      await deliverChallanGroup(group.challanNo);
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      refresh();
      toast({ title: "Challan Delivered", description: `${group.challanNo} delivered successfully.` });
    } catch (err: any) {
      toast({ title: "Delivery Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleEditSave = async () => {
    if (!editingGroup) return;
    try {
      await updateChallanGroup(editingGroup.challanNumber, editingGroup);
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      refresh();
      setEditingGroup(null);
      toast({ title: "Challan updated successfully" });
    } catch (err: any) {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleBuildToggle = async (group: any, nextBuilt: boolean) => {
    if (group.isCancelled) {
      toast({ title: "Cancelled challan", description: "Cancelled challans cannot be marked as built.", variant: "destructive" });
      return;
    }
    await Promise.all(group.items.map((item: Challan) => updateChallan(item.id, { isBuilt: nextBuilt })));
    refresh();
    toast({ title: nextBuilt ? "Challan marked as built" : "Built mark removed" });
  };

  const handleChallanGeneratedToggle = async (group: any, nextVal: boolean) => {
    if (group.isCancelled) {
      toast({ title: "Cancelled challan", description: "Cancelled challans cannot be edited.", variant: "destructive" });
      return;
    }
    await Promise.all(group.items.map((item: Challan) => updateChallan(item.id, { isChallanGenerated: nextVal })));
    refresh();
    toast({ title: nextVal ? "Challan marked as generated" : "Challan generation status removed" });
  };

  const handleCancel = async (challanNo: string) => {
    const ok = window.confirm(
      `Cancel challan ${challanNo}? Stock will be restored if delivered.`,
    );
    if (!ok) return;
    await cancelChallanGroup(challanNo);
    window.dispatchEvent(new CustomEvent("erp-stock-updated"));
    refresh();
    toast({ title: "Challan cancelled" });
  };

  const printChallan = async (group: any) => {
    // Mark as printed in the DB
    try {
      await Promise.all(group.items.map((item: any) => updateChallan(item.id, { isPrinted: true })));
      refresh();
    } catch (e) {
      console.error("Failed to mark as printed", e);
    }

    const content = `
      <html>
        <head>
          <title>Print Challan</title>
          <style>
            @media print {
              body { margin: 0; padding: 0; }
              @page { size: auto; margin: 0mm; }
            }
          </style>
        </head>
        <body style="margin: 0; padding: 10px; -webkit-print-color-adjust: exact;">
          <div style="width: 260px; border: 1px solid #000; padding: 10px; box-sizing: border-box; font-family: 'Courier New', Courier, monospace; font-size: 13px; line-height: 1.3; color: #000; margin: 0;">
            <div style="text-align: center; margin-bottom: 8px;">
              <span style="border: 1px solid #000; padding: 2px 6px; font-weight: bold; display: inline-block; font-size: 12px; letter-spacing: 0.5px;">DELIVERY SLIP</span>
            </div>
            
            <div style="border-top: 2px solid #000; border-bottom: 2px solid #000; text-align: center; padding: 4px 0; margin-bottom: 8px; font-weight: bold; font-size: 14px;">
              CLIENT: ${group.customer}
            </div>

            <div style="border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 8px;">
              <table style="width: 100%; font-family: inherit; font-size: inherit; border-collapse: collapse;">
                <tr>
                  <td style="text-align: left; padding: 1px 0;">Challan:</td>
                  <td style="text-align: right; padding: 1px 0; font-weight: bold;">${group.challanNo}</td>
                </tr>
                <tr>
                  <td style="text-align: left; padding: 1px 0;">Date:</td>
                  <td style="text-align: right; padding: 1px 0;">${group.createdAt ? format(new Date(group.createdAt), "dd-MM-yyyy") : ""}</td>
                </tr>
              </table>
            </div>

            <div style="border-top: 2px solid #000; padding-top: 8px;">
              ${group.items.map((item: any) => {
                const itemSale = sales.find((s: Sale) => s.id === item.salesId);
                const itemBatches = batches.filter((b: StockBatch) => b.productName === item.product);
                const currentBatch = item.batchNo
                  ? itemBatches.find((b: StockBatch) => b.batchNumber === item.batchNo)
                  : itemBatches[0];
                const productCategory = currentBatch?.category || itemBatches[0]?.category || "";
                const batch = item.batchNo || itemSale?.batchNo || "";
                const narration = item.notes || itemSale?.remarks || "";
                const description = item.description || itemSale?.description || currentBatch?.description || "";
                return `
                  <div style="text-align: center; margin-bottom: 10px; font-weight: bold; border-bottom: 1px dashed #ccc; padding-bottom: 6px;">
                    <div style="font-size: 14px;">${item.product}</div>
                    ${description ? `<div style="font-size: 12px; font-weight: bold; color: #222; margin-top: 2px;">Description: ${description}</div>` : ""}
                    ${productCategory ? `<div style="font-size: 12px; font-weight: normal; margin-top: 1px;">Category: ${productCategory}</div>` : ""}
                    <div style="font-size: 13px; margin-top: 1px;">QTY: ${item.quantity} [${item.stockCategory || "Available"}]</div>
                    ${batch ? `<div style="font-size: 12px; font-weight: normal; margin-top: 1px;">Batch: ${batch}</div>` : ""}
                    ${narration ? `<div style="font-size: 12px; font-weight: normal; margin-top: 2px; font-style: italic;">Narration: ${narration}</div>` : ""}
                  </div>
                `;
              }).join("")}
            </div>
            <div style="border-top: 2px solid #000; margin-top: 8px;"></div>
          </div>
        </body>
      </html>
    `;
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(content);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 250);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-primary">Delivery Challans</h1>
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
          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredChallansForExport as any, `challans-${new Date().toISOString().slice(0, 10)}.csv`)}>
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => printElement("delivery-challans-table")}>
            <Printer className="mr-1 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-hidden" id="delivery-challans-table">
          <div className="overflow-x-auto">
            <Table className="border-collapse border-2 border-slate-300 w-full">
              <TableHeader className="bg-slate-50/75">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Date</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Challan #</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Client</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Items / Quantities</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGroupedChallans.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="border-2 border-slate-300 text-center text-muted-foreground py-8"
                    >
                      No active challans in delivery workflow.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGroupedChallans.map((group) => {
                    const parentSale = sales.find((s) => s.id === group.salesId);
                    return (
                      <TableRow
                        key={group.challanNo}
                        className={group.isCancelled ? "bg-red-50/50 border-l-4 border-l-red-400 opacity-80" : "hover:bg-slate-50/40"}
                      >
                        <TableCell className="border-2 border-slate-300 px-4 py-3.5 text-sm text-slate-700 font-medium whitespace-nowrap align-top">
                          {group.createdAt
                            ? format(new Date(group.createdAt), "dd-MM-yyyy")
                            : ""}
                        </TableCell>
                        <TableCell className="border-2 border-slate-300 px-4 py-3.5 font-medium align-top">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-slate-900 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs">
                                {group.challanNo}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 items-center mt-0.5">
                              <label className={`inline-flex items-center gap-1.5 text-xs mr-1 cursor-pointer select-none ${group.isCancelled ? "text-muted-foreground/60 cursor-not-allowed" : "text-slate-700 font-medium"}`}>
                                <input
                                  type="checkbox"
                                  checked={group.isBuilt}
                                  disabled={group.isCancelled}
                                  onChange={(e) => handleBuildToggle(group, e.target.checked)}
                                  className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5"
                                />
                                <span>Billed</span>
                              </label>
                              {group.isPrinted && (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Printed
                                </span>
                              )}
                              {group.isBuilt && (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                  <CheckSquare className="h-3 w-3" />
                                  Billed
                                </span>
                              )}
                              {group.isChallanGenerated && (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Generated
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="border-2 border-slate-300 px-4 py-3.5 text-sm min-w-[150px] max-w-[200px] align-top">
                          <div className="font-semibold text-slate-900 leading-snug">
                            {renderCustomer(group.customer)}
                          </div>
                        </TableCell>
                        <TableCell className="border-2 border-slate-300 px-4 py-3.5 align-top">
                          <div className="text-sm space-y-2">
                            {group.items.map((item: any, idx: number) => {
                              const itemSale = sales.find((s) => s.id === item.salesId);
                              const itemBatch = batches.find((b) => b.productName === item.product);
                              const totalOrder = itemSale ? itemSale.orderedQty : item.quantity;
                              const alreadyDelivered = itemSale ? (itemSale.deliveredQty || 0) : 0;
                              const pendingQty = itemSale ? Math.max(0, itemSale.orderedQty - alreadyDelivered - item.quantity) : 0;
                              const description = item.description || itemSale?.description || itemBatch?.description || "";
                              return (
                                <div key={idx} className="p-2 rounded-md bg-slate-50/80 border border-slate-200/80 shadow-2xs space-y-1">
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-bold text-slate-900 text-sm">{item.product}</span>
                                      {item.batchNo && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-white text-slate-600 border border-slate-200 shadow-2xs">
                                          Batch: {item.batchNo}
                                        </span>
                                      )}
                                      {item.stockCategory && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                          item.stockCategory === "Display" ? "bg-amber-50 text-amber-800 border border-amber-200" :
                                          item.stockCategory === "Damage" ? "bg-red-50 text-red-800 border border-red-200" :
                                          "bg-blue-50 text-blue-800 border border-blue-200"
                                        }`}>
                                          {item.stockCategory}
                                        </span>
                                      )}
                                    </div>
 
                                    <div className="text-right flex items-center gap-2">
                                      {itemSale && (
                                        <div className="text-[11px] text-slate-500 font-semibold">
                                          Order: <span className="text-slate-800 font-bold">{totalOrder}</span>
                                          {pendingQty > 0 && (
                                            <span className="text-red-600 font-bold ml-1">
                                              (Pend: {pendingQty})
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <span className={`font-bold text-xs px-2 py-0.5 rounded border shadow-2xs ${
                                        item.quantity > 0 
                                          ? "text-emerald-800 bg-emerald-50 border-emerald-200" 
                                          : "text-amber-800 bg-amber-50 border-amber-200"
                                      }`}>
                                        {item.quantity > 0 ? `Fulfill: ${item.quantity}` : "Fulfill: 0 (Pending Stock)"}
                                      </span>
                                    </div>
                                  </div>
                                  {description && (
                                    <div className="text-xs text-slate-600 font-medium italic">
                                      Desc: {description}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {/* Show group-level narration one time only */}
                            {(() => {
                              const firstWithNotes = group.items.find(i => i.notes);
                              if (firstWithNotes && firstWithNotes.notes) {
                                return (
                                  <div className="text-[11px] text-orange-700 font-semibold mt-1 bg-orange-50 px-2 py-0.5 rounded border border-orange-200/80 w-fit flex items-center gap-1">
                                    <span>Narration:</span> <span className="font-normal text-slate-700">{firstWithNotes.notes}</span>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </TableCell>
 
                        <TableCell className="border-2 border-slate-300 px-3 py-3.5 text-right align-top shrink-0 w-auto whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5 shrink-0 whitespace-nowrap">
                            {/* When cancelled: show Cancelled icon and Delete button */}
                            {group.isCancelled ? (
                              <div className="inline-flex items-center gap-1.5">
                                <span className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-red-100 text-red-700 border border-red-200 shadow-2xs" title="Cancelled">
                                  <Ban className="h-4 w-4 text-red-600" />
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:bg-red-50 hover:text-red-700 rounded-md"
                                  onClick={() => handleDelete(group.challanNo)}
                                  title="Delete Cancelled Challan"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                            <>
                            {group.status !== "Delivered" ? (
                              <Button
                                size="icon"
                                className="h-8 w-8 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md shadow-2xs shrink-0"
                                onClick={() => handleDeliver(group)}
                                title="Deliver Order"
                              >
                                <Truck className="h-4 w-4" />
                              </Button>
                            ) : (
                              <span className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-green-100 text-green-800 border border-green-200 shadow-2xs shrink-0" title="Delivered">
                                <CheckCircle2 className="h-4 w-4 text-green-700" />
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md"
                              onClick={() => printChallan(group)}
                              title="Print Full Challan"
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-md"
                              onClick={() => handleChallanGeneratedToggle(group, !group.isChallanGenerated)}
                              title="Toggle Challan Generated"
                            >
                              <FileSpreadsheet className="h-4 w-4" />
                            </Button>
                            
                            {/* Edit Dialog - open with Total Order Qty prefilled */}
                            {group.status !== "Delivered" && !group.isCancelled && (
                              <Dialog
                                open={
                                  !!editingGroup &&
                                  editingGroup.challanNumber === group.challanNo
                                }
                                onOpenChange={(open) =>
                                  !open && setEditingGroup(null)
                                }
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-blue-600"
                                    onClick={() => openEditDialog(group)}
                                    title="Edit Total Order Qty"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                                   <DialogHeader>
                                     <DialogTitle>Edit Total Order Details</DialogTitle>
                                     <DialogDescription>
                                       Enter the total intended order quantity below. The system automatically fulfills available stock in this Delivery Challans page and puts any remaining quantity into Pending Deliveries.
                                     </DialogDescription>
                                   </DialogHeader>
                                   <div className="grid gap-4 py-4">
                                     <div className="grid gap-2">
                                       <Label>Customer Name</Label>
                                       <Input
                                         value={editingGroup?.clientName || ""}
                                         onChange={(e) =>
                                           setEditingGroup({
                                             ...editingGroup,
                                             clientName: e.target.value,
                                           })
                                         }
                                       />
                                     </div>
                                     <div className="grid gap-2">
                                       <Label>Client Phone</Label>
                                       <Input
                                         value={editingGroup?.clientPhone || ""}
                                         onChange={(e) =>
                                           setEditingGroup({
                                             ...editingGroup,
                                             clientPhone: e.target.value,
                                           })
                                         }
                                       />
                                     </div>
                                     <div className="grid gap-2">
                                       <Label>Challan Date</Label>
                                       <Input
                                         type="date"
                                         value={editingGroup?.date || ""}
                                         onChange={(e) =>
                                           setEditingGroup({
                                             ...editingGroup,
                                             date: e.target.value,
                                           })
                                         }
                                       />
                                     </div>
                                     <div className="space-y-3">
                                       <div className="flex items-center justify-between">
                                         <div className="font-semibold text-sm">Items & Order Quantities</div>
                                         <Button
                                           type="button"
                                           variant="outline"
                                           size="sm"
                                           onClick={() => {
                                             setEditingGroup({
                                               ...editingGroup,
                                               items: [
                                                 ...editingGroup.items,
                                                 {
                                                   productName: "",
                                                   quantity: 1,
                                                   fulfilledQty: 0,
                                                   stockCategory: "Available",
                                                   batchNo: "",
                                                   notes: "",
                                                   isProductSelected: false,
                                                 },
                                               ],
                                             });
                                           }}
                                           className="h-8 text-xs gap-1 border-blue-200 bg-blue-50/50 text-blue-700 hover:bg-blue-100"
                                         >
                                           <Plus className="h-3.5 w-3.5" /> Add Product
                                         </Button>
                                       </div>
                                       {editingGroup?.items?.map(
                                         (item: any, idx: number) => {
                                           const itemBatches = batches.filter(
                                             (b) => b.productName === (item.productName || item.product)
                                           );
                                           const currentBatch = item.batchNo
                                             ? itemBatches.find((b) => b.batchNumber === item.batchNo)
                                             : itemBatches[0];
                                           const productCat = currentBatch?.category || itemBatches[0]?.category || "";

                                           return (
                                             <div
                                               key={item.id || idx}
                                               className={`grid grid-cols-12 gap-3 items-start border p-3 rounded-lg bg-muted/20 relative ${
                                                 activeSuggestionIndex === idx ? "z-50" : "z-1"
                                               }`}
                                             >
                                               <div className="col-span-4 relative min-w-0">
                                                 <Label className="text-xs font-semibold">Product Name *</Label>
                                                 <Input
                                                   value={item.productName || item.product || ""}
                                                   placeholder="Search product..."
                                                   autoComplete="off"
                                                   className="w-full text-xs h-9"
                                                   onChange={(e) => {
                                                     const next = [...editingGroup.items];
                                                     next[idx] = {
                                                       ...next[idx],
                                                       productName: e.target.value,
                                                       batchNo: "",
                                                       isProductSelected: false,
                                                     };
                                                     setEditingGroup({
                                                       ...editingGroup,
                                                       items: next,
                                                     });
                                                     setActiveSuggestionIndex(idx);
                                                   }}
                                                   onFocus={() => {
                                                     setActiveSuggestionIndex(idx);
                                                     setSelectedSuggestionIndex(-1);
                                                   }}
                                                   onBlur={() =>
                                                     setTimeout(() => {
                                                       setActiveSuggestionIndex(null);
                                                       setSelectedSuggestionIndex(-1);
                                                     }, 200)
                                                   }
                                                   onKeyDown={(e) => {
                                                     const sugList = getSuggestionsList(
                                                       item.productName || item.product || ""
                                                     );
                                                     if (e.key === "ArrowDown") {
                                                       e.preventDefault();
                                                       setSelectedSuggestionIndex((prev) =>
                                                         prev < sugList.length - 1 ? prev + 1 : prev
                                                       );
                                                     } else if (e.key === "ArrowUp") {
                                                       e.preventDefault();
                                                       setSelectedSuggestionIndex((prev) =>
                                                         prev > 0 ? prev - 1 : prev
                                                       );
                                                     } else if (e.key === "Enter") {
                                                       if (
                                                         selectedSuggestionIndex >= 0 &&
                                                         selectedSuggestionIndex < sugList.length
                                                       ) {
                                                         e.preventDefault();
                                                         const sug = sugList[selectedSuggestionIndex];
                                                         const next = [...editingGroup.items];
                                                         next[idx] = {
                                                           ...next[idx],
                                                           productName: sug.batch.productName,
                                                           batchNo: sug.batch.batchNumber,
                                                           stockCategory: sug.category,
                                                           isProductSelected: true,
                                                         };
                                                         setEditingGroup({
                                                           ...editingGroup,
                                                           items: next,
                                                         });
                                                         setActiveSuggestionIndex(null);
                                                         setSelectedSuggestionIndex(-1);
                                                       } else {
                                                         e.currentTarget.blur();
                                                       }
                                                     } else if (e.key === "Tab") {
                                                       if (
                                                         activeSuggestionIndex === idx &&
                                                         selectedSuggestionIndex >= 0 &&
                                                         selectedSuggestionIndex < sugList.length
                                                       ) {
                                                         const sug = sugList[selectedSuggestionIndex];
                                                         const next = [...editingGroup.items];
                                                         next[idx] = {
                                                           ...next[idx],
                                                           productName: sug.batch.productName,
                                                           batchNo: sug.batch.batchNumber,
                                                           stockCategory: sug.category,
                                                           isProductSelected: true,
                                                         };
                                                         setEditingGroup({
                                                           ...editingGroup,
                                                           items: next,
                                                         });
                                                         setActiveSuggestionIndex(null);
                                                         setSelectedSuggestionIndex(-1);
                                                       }
                                                     } else if (e.key === "Escape") {
                                                       setActiveSuggestionIndex(null);
                                                       setSelectedSuggestionIndex(-1);
                                                     }
                                                   }}
                                                 />

                                                 {activeSuggestionIndex === idx && (
                                                   <div
                                                     ref={suggestionContainerRef}
                                                     className="absolute left-0 right-0 top-full z-[100] mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto min-w-[240px]"
                                                   >
                                                     {(() => {
                                                       const sugList = getSuggestionsList(
                                                         item.productName || item.product || ""
                                                       );
                                                       return (
                                                         <>
                                                           {sugList.map((sug, i) => {
                                                             const { batch: b, category, label } = sug;
                                                             return (
                                                               <div
                                                                 key={`${b.id}-${category}-${i}`}
                                                                 className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${
                                                                   selectedSuggestionIndex === i
                                                                     ? "bg-accent"
                                                                     : "hover:bg-accent"
                                                                 } ${
                                                                   b.isCancelled
                                                                     ? "bg-destructive/10 hover:bg-destructive/20"
                                                                     : ""
                                                                 }`}
                                                                 onMouseDown={(e) => {
                                                                   e.preventDefault();
                                                                   const next = [...editingGroup.items];
                                                                   next[idx] = {
                                                                     ...next[idx],
                                                                     productName: b.productName,
                                                                     batchNo: b.batchNumber,
                                                                     stockCategory: category,
                                                                     isProductSelected: true,
                                                                   };
                                                                   setEditingGroup({
                                                                     ...editingGroup,
                                                                     items: next,
                                                                   });
                                                                   setActiveSuggestionIndex(null);
                                                                   setSelectedSuggestionIndex(-1);
                                                                 }}
                                                               >
                                                                 <div className="flex items-center justify-between gap-1">
                                                                   <div className="font-semibold text-primary">
                                                                     {b.productName}
                                                                   </div>
                                                                   {b.category && (
                                                                     <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 shrink-0">
                                                                       {b.category}
                                                                     </span>
                                                                   )}
                                                                 </div>
                                                                 <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                                                                   Batch: {b.batchNumber} |{" "}
                                                                   <span className="text-blue-600 font-bold bg-blue-50 px-1 rounded">
                                                                     {label}
                                                                   </span>
                                                                 </div>
                                                                 <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-1 bg-muted/30 p-1 rounded">
                                                                   {category === "Available" && (
                                                                     <span>
                                                                       Avail:{" "}
                                                                       <span className="font-semibold text-foreground">
                                                                         {b.availableQty}
                                                                       </span>
                                                                     </span>
                                                                   )}
                                                                   {category === "Display" && (
                                                                     <span>
                                                                       Disp:{" "}
                                                                       <span className="font-semibold text-foreground">
                                                                         {b.displayQty || 0}
                                                                       </span>
                                                                     </span>
                                                                   )}
                                                                   {category === "Damage" && (
                                                                     <span>
                                                                       Dmg:{" "}
                                                                       <span className="font-semibold text-foreground">
                                                                         {b.damageQty || 0}
                                                                       </span>
                                                                     </span>
                                                                   )}
                                                                 </div>
                                                               </div>
                                                             );
                                                           })}
                                                           {sugList.length === 0 && (
                                                             <div className="px-3 py-2 text-sm text-muted-foreground text-center">
                                                               No matches
                                                             </div>
                                                           )}
                                                         </>
                                                       );
                                                     })()}
                                                   </div>
                                                 )}

                                                 {(item.isProductSelected || item.productName || item.product) && (
                                                   <div className="text-[10px] text-muted-foreground mt-1 flex justify-between items-center bg-blue-50/50 p-1.5 rounded-sm border border-blue-100/50">
                                                     {(() => {
                                                       const prodName = item.productName || item.product;
                                                       const pBatches = batches.filter(
                                                         (b) => b.productName === prodName
                                                       );
                                                       const batch = item.batchNo
                                                         ? pBatches.find((b) => b.batchNumber === item.batchNo)
                                                         : pBatches[0];
                                                       const categoryTag =
                                                         batch?.category || pBatches[0]?.category;

                                                       return (
                                                         <div className="flex items-center justify-between w-full font-semibold gap-2">
                                                           {categoryTag ? (
                                                             <span className="text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 shrink-0">
                                                               Cat: {categoryTag}
                                                             </span>
                                                           ) : (
                                                             <span />
                                                           )}
                                                           {batch ? (
                                                             <span className="text-blue-700 text-right">
                                                               Avail: {batch.availableQty} | Disp:{" "}
                                                               {batch.displayQty || 0} | Dmg: {batch.damageQty || 0}
                                                             </span>
                                                           ) : null}
                                                         </div>
                                                       );
                                                     })()}
                                                   </div>
                                                 )}
                                               </div>

                                               <div className="col-span-2 min-w-0">
                                                 <Label className="text-xs">Batch No</Label>
                                                 {(() => {
                                                   const prodName = item.productName || item.product;
                                                   const pBatches = batches.filter(
                                                     (b) => b.productName === prodName
                                                   );
                                                   if (pBatches.length > 1) {
                                                     return (
                                                       <Select
                                                         value={item.batchNo || pBatches[0]?.batchNumber || ""}
                                                         onValueChange={(v) => {
                                                           const next = [...editingGroup.items];
                                                           next[idx] = { ...next[idx], batchNo: v };
                                                           setEditingGroup({ ...editingGroup, items: next });
                                                         }}
                                                       >
                                                         <SelectTrigger className="w-full text-xs h-9">
                                                           <SelectValue placeholder="Select Batch" />
                                                         </SelectTrigger>
                                                         <SelectContent>
                                                           {pBatches.map((b) => (
                                                             <SelectItem key={b.id} value={b.batchNumber}>
                                                               {b.batchNumber} (Avail: {b.availableQty})
                                                             </SelectItem>
                                                           ))}
                                                         </SelectContent>
                                                       </Select>
                                                     );
                                                   }
                                                   return (
                                                     <Input
                                                       value={item.batchNo || ""}
                                                       placeholder="Batch No"
                                                       className="text-xs h-9"
                                                       onChange={(e) => {
                                                         const next = [...editingGroup.items];
                                                         next[idx] = { ...next[idx], batchNo: e.target.value };
                                                         setEditingGroup({ ...editingGroup, items: next });
                                                       }}
                                                     />
                                                   );
                                                 })()}
                                               </div>

                                               <div className="col-span-2">
                                                 <Label className="text-xs font-bold text-blue-700">
                                                   Total Order Qty
                                                 </Label>
                                                 <Input
                                                   type="number"
                                                   className="font-bold border-blue-300 bg-blue-50/50 text-xs h-9"
                                                   value={item.quantity}
                                                   onChange={(e) => {
                                                     const next = [...editingGroup.items];
                                                     next[idx] = {
                                                       ...next[idx],
                                                       quantity: +e.target.value,
                                                     };
                                                     setEditingGroup({
                                                       ...editingGroup,
                                                       items: next,
                                                     });
                                                   }}
                                                 />
                                                 <div className="text-[10px] text-muted-foreground mt-1 font-semibold">
                                                   Fulfilled:{" "}
                                                   <span className="text-green-700 font-bold">
                                                     {item.fulfilledQty || 0}
                                                   </span>
                                                 </div>
                                               </div>

                                               <div className="col-span-3">
                                                 <Label className="text-xs">Stock Category</Label>
                                                 <Select
                                                   value={item.stockCategory || "Available"}
                                                   onValueChange={(v) => {
                                                     const next = [...editingGroup.items];
                                                     next[idx] = {
                                                       ...next[idx],
                                                       stockCategory: v,
                                                     };
                                                     setEditingGroup({
                                                       ...editingGroup,
                                                       items: next,
                                                     });
                                                   }}
                                                 >
                                                   <SelectTrigger className="w-full text-xs h-9">
                                                     <SelectValue placeholder="Select Category" />
                                                   </SelectTrigger>
                                                   <SelectContent>
                                                     <SelectItem value="Available">Available</SelectItem>
                                                     <SelectItem value="Display">Display</SelectItem>
                                                     <SelectItem value="Damage">Damage</SelectItem>
                                                   </SelectContent>
                                                 </Select>
                                               </div>

                                               <div className="col-span-1 flex items-center justify-center pt-5">
                                                 {editingGroup.items.length > 1 && (
                                                   <Button
                                                     type="button"
                                                     variant="ghost"
                                                     size="icon"
                                                     className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                                     onClick={() => {
                                                       const next = editingGroup.items.filter(
                                                         (_: any, i: number) => i !== idx
                                                       );
                                                       setEditingGroup({
                                                         ...editingGroup,
                                                         items: next,
                                                       });
                                                     }}
                                                     title="Remove Product"
                                                   >
                                                     <Trash2 className="h-4 w-4" />
                                                   </Button>
                                                 )}
                                               </div>
                                             </div>
                                           );
                                         }
                                       )}
                                     </div>
                                   </div>
                                   <DialogFooter>
                                     <Button
                                       variant="outline"
                                       onClick={() => setEditingGroup(null)}
                                     >
                                       Cancel
                                     </Button>
                                     <Button onClick={handleEditSave} className="bg-blue-600 hover:bg-blue-700">
                                       Save Order Changes
                                     </Button>
                                   </DialogFooter>
                                 </DialogContent>
                              </Dialog>
                            )}

                            {/* Cancel Button */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600 hover:text-red-700"
                              onClick={() => handleCancel(group.challanNo)}
                              title="Cancel Challan"
                            >
                              <Ban className="h-4 w-4" />
                            </Button>

                            {/* Delete Button */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDelete(group.challanNo)}
                              title="Delete Challan"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
