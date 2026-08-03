import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getChallans,
  getSales,
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
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold text-slate-900 leading-tight">{match[1]}</span>
        <span className="text-[11px] text-slate-500 font-medium leading-none mt-0.5">({match[2]})</span>
      </div>
    );
  }
  return <span className="font-semibold text-slate-900 leading-tight">{customerName}</span>;
};

export default function ChallanPage() {
  const [challans, setChallans] = useState<Challan[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [filter, setFilter] = useState("");
  const { toast } = useToast();

  const refresh = useCallback(() => {
    Promise.all([getChallans(), getSales()]).then(([c, s]) => {
      setChallans(c);
      setSales(s);
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
              ${group.items.map((item: any) => `
                <div style="text-align: center; margin-bottom: 10px; font-weight: bold;">
                  <div style="font-size: 14px;">${item.product}</div>
                  <div style="font-size: 13px; margin-top: 1px;">QTY: ${item.quantity} [${item.stockCategory || "Available"}]</div>
                </div>
              `).join("")}
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
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Status</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGroupedChallans.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
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
                        <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700 font-medium whitespace-nowrap">
                          {group.createdAt
                            ? format(new Date(group.createdAt), "dd-MM-yyyy")
                            : ""}
                        </TableCell>
                        <TableCell className="border-2 border-slate-300 px-4 py-3 font-medium">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-slate-950">{group.challanNo}</span>
                              {parentSale && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-slate-100 text-slate-600 border border-slate-200">
                                  {parentSale.orderNo}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1 items-center mt-0.5">
                              <label className={`inline-flex items-center gap-1.5 text-xs mr-2 cursor-pointer ${group.isCancelled ? "text-muted-foreground/60 cursor-not-allowed" : "text-slate-600 font-medium"}`}>
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
                        <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm min-w-[150px] max-w-[220px] break-words">
                          {renderCustomer(group.customer)}
                        </TableCell>
                        <TableCell className="border-2 border-slate-300 px-4 py-3">
                          <div className="text-sm space-y-2">
                            {group.items.map((item: any, idx: number) => {
                              const itemSale = sales.find((s) => s.id === item.salesId);
                              const totalOrder = itemSale ? itemSale.orderedQty : item.quantity;
                              const alreadyDelivered = itemSale ? (itemSale.deliveredQty || 0) : 0;
                              const pendingQty = itemSale ? Math.max(0, itemSale.orderedQty - alreadyDelivered - item.quantity) : 0;
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
                                          item.stockCategory === "Display" ? "bg-amber-50 text-amber-800 border border-amber-200" :
                                          item.stockCategory === "Damage" ? "bg-red-50 text-red-800 border border-red-200" :
                                          "bg-blue-50 text-blue-800 border border-blue-200"
                                        }`}>
                                          {item.stockCategory}
                                        </span>
                                      )}
                                    </div>
 
                                    <div className="text-right flex items-center gap-3">
                                      {itemSale && (
                                        <div className="text-[10px] text-muted-foreground font-semibold">
                                          Order: {totalOrder}
                                          {pendingQty > 0 && (
                                            <span className="text-red-600 font-bold ml-1">
                                              (Pend: {pendingQty})
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <span className="font-bold text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200">
                                        Fulfill: {item.quantity}
                                      </span>
                                    </div>
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

                        {/* Status Dropdown Column */}
                        <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle">
                          {group.isCancelled ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                              Cancelled
                            </span>
                          ) : (
                            <Select
                              value={group.status}
                              onValueChange={(val) => handleStatusChange(group, val)}
                              disabled={group.isCancelled}
                            >
                              <SelectTrigger
                                className={`h-8 w-32 text-xs font-semibold border ${
                                  group.status === "Confirmed"
                                    ? "bg-blue-50 border-blue-300 text-blue-700"
                                    : group.status === "Delivered"
                                    ? "bg-green-50 border-green-300 text-green-700"
                                    : "bg-yellow-50 border-yellow-300 text-yellow-700"
                                }`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Pending" disabled={group.status !== "Pending"}>
                                  Pending
                                </SelectItem>
                                <SelectItem value="Confirmed" disabled={group.status === "Delivered"}>
                                  ✓ Confirmed
                                </SelectItem>
                                <SelectItem value="Delivered">
                                  🚚 Delivered
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="border-2 border-slate-300 px-4 py-3 text-right align-middle">
                          <div className="flex items-center justify-end gap-1">
                            {/* When cancelled: show only Delete button */}
                            {group.isCancelled ? (
                              <>
                                <span className="text-xs text-red-600 font-semibold mr-2 italic">Order Cancelled</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  onClick={() => handleDelete(group.challanNo)}
                                  title="Delete Cancelled Challan"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                            <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => printChallan(group)}
                              title="Print Full Challan"
                            >
                              <Printer className="h-4 w-4 text-primary" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
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
                                <DialogContent className="max-w-2xl">
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
                                      <div className="font-semibold text-sm">Items & Order Quantities</div>
                                      {editingGroup?.items?.map(
                                        (item: any, idx: number) => (
                                          <div
                                            key={item.id || idx}
                                            className="grid grid-cols-12 gap-2 items-end border p-3 rounded-lg bg-muted/20"
                                          >
                                            <div className="col-span-4">
                                              <Label className="text-xs">Product</Label>
                                              <Input
                                                value={item.productName}
                                                onChange={(e) => {
                                                  const next = [...editingGroup.items];
                                                  next[idx] = {
                                                    ...next[idx],
                                                    productName: e.target.value,
                                                  };
                                                  setEditingGroup({
                                                    ...editingGroup,
                                                    items: next,
                                                  });
                                                }}
                                              />
                                            </div>
                                            <div className="col-span-4">
                                              <Label className="text-xs font-bold text-blue-700">
                                                Total Order Qty
                                              </Label>
                                              <Input
                                                type="number"
                                                className="font-bold border-blue-300 bg-blue-50/50"
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
                                                Current Fulfilled: <span className="text-green-700 font-bold">{item.fulfilledQty}</span>
                                              </div>
                                            </div>
                                            <div className="col-span-4">
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
                                                <SelectTrigger className="w-full">
                                                  <SelectValue placeholder="Select Category" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="Available">Available</SelectItem>
                                                  <SelectItem value="Display">Display</SelectItem>
                                                  <SelectItem value="Damage">Damage</SelectItem>
                                                </SelectContent>
                                              </Select>
                                            </div>
                                          </div>
                                        )
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
