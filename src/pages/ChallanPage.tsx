import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getChallans,
  getSales,
  getBatches,
  getClients,
  updateChallan,
  updateChallanGroupBillNo,
  deleteChallanGroup,
  cancelChallanGroup,
  deliverChallanGroup,
  exportCSV,
  getChallanNotes,
  addChallanNote,
  updateChallanNoteStatus,
  deleteChallanNote,
  getCurrentUser,
  Challan,
  Sale,
  StockBatch,
  Client,
  ChallanNote,
} from "@/lib/store";
import { printElement } from "@/lib/print";
import { transliterateToGujarati } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  CheckCircle2,
  Ban,
  Truck,
  FileSpreadsheet,
  Search,
  Plus,
  User,
  Bell,
  Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  const navigate = useNavigate();
  const [challans, setChallans] = useState<Challan[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [challanNotes, setChallanNotes] = useState<ChallanNote[]>([]);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isUpdatingNote, setIsUpdatingNote] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [billInputs, setBillInputs] = useState<Record<string, string>>({});
  const [confirmDeliverGroup, setConfirmDeliverGroup] = useState<any | null>(null);
  const [isDelivering, setIsDelivering] = useState(false);
  const { toast } = useToast();

  const refresh = useCallback(() => {
    Promise.all([
      getChallans(),
      getSales(),
      getBatches(),
      getClients(),
      getChallanNotes(),
    ]).then(([c, s, b, cl, cn]) => {
      setChallans(c);
      setSales(s);
      setBatches(b);
      setClients(cl);
      setChallanNotes(cn);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pendingNotes = useMemo(() => {
    return challanNotes.filter((n) => n.status === "Pending");
  }, [challanNotes]);

  const pendingNotesCount = pendingNotes.length;

  const handleAddNote = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newNoteText.trim()) return;
    setIsAddingNote(true);
    try {
      const user = getCurrentUser();
      const created = await addChallanNote(newNoteText.trim(), user?.name || "Admin");
      setChallanNotes((prev) => [created, ...prev]);
      setNewNoteText("");
      toast({ title: "Note Added", description: "New note saved in Pending status." });
    } catch (err: any) {
      toast({ title: "Failed to add note", description: err.message, variant: "destructive" });
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleCompleteNote = async (id: string) => {
    setIsUpdatingNote(id);
    try {
      const updated = await updateChallanNoteStatus(id, "Completed");
      setChallanNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      toast({ title: "Note Completed", description: "Note marked as completed and removed from modal." });
    } catch (err: any) {
      toast({ title: "Failed to update note", description: err.message, variant: "destructive" });
    } finally {
      setIsUpdatingNote(null);
    }
  };

  const handleDeleteNote = async (id: string) => {
    try {
      await deleteChallanNote(id);
      setChallanNotes((prev) => prev.filter((n) => n.id !== id));
      toast({ title: "Note Deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete note", description: err.message, variant: "destructive" });
    }
  };

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
        billNo: items.find((i) => i.billNo)?.billNo || "",
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
        const getGroupLatestTime = (group: typeof a) => {
          let maxTime = 0;
          for (const item of group.items) {
            if (item.updatedAt) {
              const t = new Date(item.updatedAt).getTime();
              if (!isNaN(t) && t > maxTime) maxTime = t;
            }
            if (item.createdAt) {
              const t = new Date(item.createdAt).getTime();
              if (!isNaN(t) && t > maxTime) maxTime = t;
            }
            const sale = sales.find((s) => s.id === item.salesId);
            if (sale?.updatedAt) {
              const t = new Date(sale.updatedAt).getTime();
              if (!isNaN(t) && t > maxTime) maxTime = t;
            }
            if (sale?.createdAt) {
              const t = new Date(sale.createdAt).getTime();
              if (!isNaN(t) && t > maxTime) maxTime = t;
            }
          }
          return maxTime;
        };

        const timeA = getGroupLatestTime(a);
        const timeB = getGroupLatestTime(b);
        if (timeA !== timeB) return timeB - timeA;
        return b.challanNo.localeCompare(a.challanNo, undefined, { numeric: true, sensitivity: "base" });
      });
  }, [challans, sales]);

  const filteredGroupedChallans = useMemo(() => {
    if (!filter) return groupedChallans;
    const f = filter.toLowerCase();
    return groupedChallans.filter(g => {
      const orderNo = sales.find(s => s.id === g.salesId)?.orderNo || "";
      const currentBill = (billInputs[g.challanNo] ?? g.billNo ?? "").toLowerCase();
      return (g.challanNo || '').toLowerCase().includes(f) ||
             (g.customer || '').toLowerCase().includes(f) ||
             orderNo.toLowerCase().includes(f) ||
             currentBill.includes(f) ||
             g.items.some(item => (item.product || '').toLowerCase().includes(f));
    });
  }, [groupedChallans, filter, sales, billInputs]);

  const filteredChallansForExport = useMemo(() => {
    if (!filter) return challans;
    const f = filter.toLowerCase();
    return challans.filter(c => {
      const sale = sales.find(s => s.id === c.salesId);
      const orderNo = sale?.orderNo || "";
      return (c.customer || '').toLowerCase().includes(f) ||
             (c.product || '').toLowerCase().includes(f) ||
             (c.challanNo || '').toLowerCase().includes(f) ||
             (c.billNo || '').toLowerCase().includes(f) ||
             orderNo.toLowerCase().includes(f);
    });
  }, [challans, sales, filter]);

  const handleBillNoSave = async (challanNo: string, val: string) => {
    try {
      const targetGroup = groupedChallans.find((g) => g.challanNo === challanNo);
      if (targetGroup && targetGroup.items.length > 0) {
        await Promise.all(targetGroup.items.map((item) => updateChallan(item.id, { billNo: val })));
      } else {
        await updateChallanGroupBillNo(challanNo, val);
      }
      refresh();
      if (val) {
        toast({ title: "Bill No Saved", description: `${challanNo}: ${val}` });
      }
    } catch (err: any) {
      toast({ title: "Failed to save Bill No", description: err.message, variant: "destructive" });
    }
  };

  const handleEditChallan = (group: any) => {
    const firstSale = sales.find((s) => s.id === group.salesId);
    const orderNotes = group.items.find((i: any) => i.notes)?.notes || firstSale?.remarks || "";
    navigate("/sales", {
      state: {
        editChallan: {
          challanNumber: group.challanNo,
          salesId: group.salesId,
          customer: group.customer,
          clientPhone: group.items[0]?.clientPhone || group.clientPhone || "",
          orderDate: group.createdAt ? new Date(group.createdAt).toISOString().slice(0, 10) : "",
          category: firstSale?.category || "Regular",
          notes: orderNotes,
          returnTo: "/challans",
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
        },
      },
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

  const handleDeliverClick = (group: any) => {
    const currentBill = (billInputs[group.challanNo] !== undefined ? billInputs[group.challanNo] : (group.billNo || "")).trim();
    if (!currentBill) {
      toast({
        title: "Bill No Required",
        description: `Please enter Bill No for challan ${group.challanNo} before delivering.`,
        variant: "destructive",
      });
      return;
    }
    setConfirmDeliverGroup({ ...group, currentBillNo: currentBill });
  };

  const executeDeliver = async () => {
    if (!confirmDeliverGroup) return;
    setIsDelivering(true);
    try {
      if (confirmDeliverGroup.items && confirmDeliverGroup.items.length > 0) {
        await Promise.all(
          confirmDeliverGroup.items.map((item: any) =>
            updateChallan(item.id, { billNo: confirmDeliverGroup.currentBillNo })
          )
        );
      }
      await deliverChallanGroup(confirmDeliverGroup.challanNo);
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      refresh();
      toast({
        title: "Challan Delivered",
        description: `${confirmDeliverGroup.challanNo} (Bill: ${confirmDeliverGroup.currentBillNo}) delivered successfully.`,
      });
      setConfirmDeliverGroup(null);
    } catch (err: any) {
      toast({
        title: "Delivery Failed",
        description: err.message || "Failed to deliver challan",
        variant: "destructive",
      });
    } finally {
      setIsDelivering(false);
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

    const normGroupCustomer = (group.customer || "").trim().toLowerCase();
    const groupPhone = (group.clientPhone || "").trim();
    const matchingClient = clients.find(c => {
      if (c.name && c.name.trim().toLowerCase() === normGroupCustomer) return true;
      if (groupPhone && c.phone && c.phone.trim() === groupPhone) return true;
      return false;
    });

    const printableClientName = (matchingClient?.nameGujarati && matchingClient.nameGujarati.trim())
      ? matchingClient.nameGujarati.trim()
      : group.customer;

    const formattedDate = group.createdAt
      ? format(new Date(group.createdAt), "dd-MM-yyyy")
      : (group.items[0]?.createdAt ? format(new Date(group.items[0].createdAt), "dd-MM-yyyy") : "");

    const currentBillNo = group.billNo || billInputs[group.challanNo] || "";
    const totalQty = group.items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);

    const allNotes = Array.from(new Set(group.items.map((i: any) => {
      const is = sales.find((s: Sale) => s.id === i.salesId);
      return (i.notes || is?.remarks || "").trim();
    }).filter(Boolean))).join(", ");

    let printableNarration = allNotes;
    if (allNotes) {
      try {
        const gujaratiNotes = await transliterateToGujarati(allNotes);
        if (gujaratiNotes) {
          printableNarration = gujaratiNotes;
        }
      } catch (err) {
        console.error("Failed to convert narration to Gujarati:", err);
      }
    }

    const itemsHtml = group.items.map((item: any) => {
      const itemSale = sales.find((s: Sale) => s.id === item.salesId);
      const itemBatches = batches.filter((b: StockBatch) => b.productName === item.product);
      const currentBatch = item.batchNo
        ? itemBatches.find((b: StockBatch) => b.batchNumber === item.batchNo)
        : itemBatches[0];
      const productCategory = currentBatch?.category || itemBatches[0]?.category || itemSale?.category || "-";
      const batch = item.batchNo || itemSale?.batchNo || "";
      const description = item.description || itemSale?.description || currentBatch?.description || "";

      return `
        <div class="item">
          <div class="row-data">
            <div class="c-cat">${productCategory}</div>
            <div class="c-prod">
              <div>${item.product}</div>
              ${batch ? `<div class="sub-batch">Batch: ${batch}</div>` : ""}
              ${description ? `<div class="sub-desc">Desc: ${description}</div>` : ""}
              ${item.stockCategory && item.stockCategory !== 'Available' ? `<div class="sub-desc">[${item.stockCategory}]</div>` : ""}
            </div>
            <div class="c-qty">${item.quantity}</div>
          </div>
        </div>
      `;
    }).join("");

    const content = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Challan - ${group.challanNo}</title>
<style>
  :root{ --paper-width: 80mm; --side-margin: 2.5mm; }
  @page{ size: var(--paper-width) auto; margin: 0; }
  *{ box-sizing: border-box; }
  html,body{ margin:0; padding:0; background:#e9e9e9; }
  .receipt{ width: var(--paper-width); margin: 0 auto; padding: 3mm var(--side-margin) 4mm; background:#fff; font-family: Arial, sans-serif; color:#000; font-size: 15.5px; font-weight: 700; line-height: 1.45; }
  .center{ text-align:center; }
  .bold{ font-weight:700; }
  .dashed{ border-top: 1.5px dashed #000; margin: 3mm 0; }
  .dashed-light{ border-top: 1.2px dashed #000; margin: 2.5mm 0; }
  .meta div{ margin:3px 0; font-size: 15.5px; font-weight: 700; line-height: 1.4; }
  .meta .label{ display:inline-block; width: 28mm; font-weight:700; font-size: 15.5px; }
  .meta .client-name{ font-size: 18px; font-weight: 700; }
  .col-head{ display: grid; grid-template-columns: 24mm 1fr 12mm; gap: 4.5mm; align-items: flex-end; font-weight: 700; font-size: 16px; border-bottom: 2px solid #000; padding-bottom: 1.5mm; margin-bottom: 2.5mm; }
  .item{ padding-bottom: 2.5mm; margin-bottom: 2.5mm; border-bottom: 1px dashed #666; }
  .item:last-child{ border-bottom: none; margin-bottom: 0; }
  .item .row-data{ display: grid; grid-template-columns: 24mm 1fr 12mm; gap: 4.5mm; align-items: flex-start; }
  .item .c-cat{ font-size: 14.5px; font-weight: 700; }
  .item .c-prod{ font-size: 15.5px; font-weight: 700; }
  .item .c-qty{ text-align: right; font-size: 16px; font-weight: 700; }
  .item .sub-batch{ font-size: 13.5px; font-weight: 700; color: #111; margin-top: 1px; }
  .item .sub-desc{ font-size: 14px; font-weight: 500; color: #222; margin-top: 2px; }
  .totals .row{ font-size: 16px; font-weight: 700; margin: 1mm 0; }
  .totals .grand{ font-weight:700; font-size: 18px; }
  .narration-text{ font-size: 15.5px; font-weight: 700; }
  @media print{ body{ background:#fff; } .print-btn-wrap{ display:none; } }
</style>
</head>
<body>
<div class="receipt">
  <div class="meta">
    <div class="client-row"><span class="label">Client</span>: <span class="bold client-name">${printableClientName}</span></div>
    <div><span class="label">Challan No</span>: <span class="bold">${group.challanNo}</span></div>
    ${currentBillNo ? `<div><span class="label">Bill No</span>: <span class="bold">${currentBillNo}</span></div>` : ''}
    <div><span class="label">Date</span>: ${formattedDate}</div>
  </div>
  <div class="dashed"></div>
  <div class="col-head">
    <span class="c-cat">Category</span>
    <span class="c-prod">Product</span>
    <span class="c-qty">Qty</span>
  </div>
  <div id="items">${itemsHtml}</div>
  <div class="dashed"></div>
  <div class="totals">
    <div class="row grand bold"><span>Total Qty</span><span>${totalQty}</span></div>
  </div>
  ${printableNarration ? `
    <div class="dashed-light"></div>
    <div class="narration-section">
      <div class="bold" style="font-size: 15px; margin-bottom: 2px;">વિગત / Narration:</div>
      <div class="narration-text">${printableNarration}</div>
    </div>
  ` : ''}
</div>
</body>
</html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(content);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 300);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-primary">Delivery Challans</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setNotesModalOpen(true)}
            className="relative h-9 w-9 border-slate-300 hover:bg-slate-100 shadow-2xs shrink-0"
            title="Challan Notes & Notifications"
          >
            <Bell className="h-4 w-4 text-slate-700" />
            {pendingNotesCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center px-1 py-0.5 text-[10px] font-bold leading-none text-white bg-red-600 rounded-full animate-pulse shadow-xs min-w-[18px] h-[18px] text-center border-2 border-white">
                {pendingNotesCount}
              </span>
            )}
          </Button>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customer, product, challan or bill #..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredChallansForExport as any, `delivery-challans-${new Date().toISOString().slice(0, 10)}.csv`)}>
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => printElement("challans-table")}>
            <Printer className="mr-1 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0" id="challans-table">
          <Table className="border-collapse border-2 border-slate-300 w-full" wrapperClassName="max-h-[calc(100vh-130px)]">
            <TableHeader className="sticky top-0 bg-slate-100 z-10 shadow-2xs border-b-2 border-slate-300">
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Date</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Challan / Bill No</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Customer</TableHead>
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
                    const currentBillValue = billInputs[group.challanNo] !== undefined
                      ? billInputs[group.challanNo]
                      : (group.billNo || "");
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
                            <div className="flex flex-col gap-1 mt-0.5">
                              <div className="flex items-center gap-1.5">
                                <Input
                                  type="text"
                                  value={currentBillValue}
                                  onChange={(e) => {
                                    const val = e.target.value.toUpperCase();
                                    setBillInputs((prev) => ({ ...prev, [group.challanNo]: val }));
                                  }}
                                  onBlur={(e) => {
                                    const val = e.target.value.toUpperCase().trim();
                                    handleBillNoSave(group.challanNo, val);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      const val = (e.target as HTMLInputElement).value.toUpperCase().trim();
                                      handleBillNoSave(group.challanNo, val);
                                    }
                                  }}
                                  disabled={group.isCancelled}
                                  placeholder="BILL NO"
                                  className="h-7 w-32 text-xs uppercase font-mono font-bold bg-white border-slate-300 focus-visible:ring-1 focus-visible:ring-primary px-2"
                                />
                              </div>
                              <div className="flex flex-wrap gap-1.5 items-center mt-0.5">
                                {group.isPrinted && (
                                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Printed
                                  </span>
                                )}
                                {group.billNo && (
                                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                    <CheckCircle2 className="h-3 w-3" />
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
                                onClick={() => handleDeliverClick(group)}
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
                            {group.status !== "Delivered" && !group.isCancelled && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-blue-600 hover:bg-blue-50 rounded-md"
                                onClick={() => handleEditChallan(group)}
                                title="Edit Order in Sales Module"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600 hover:text-red-700"
                              onClick={() => handleCancel(group.challanNo)}
                              title="Cancel Challan"
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
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
        </CardContent>
      </Card>
      <Dialog open={confirmDeliverGroup !== null} onOpenChange={(open) => !open && !isDelivering && setConfirmDeliverGroup(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Truck className="h-5 w-5 text-emerald-600" />
              Confirm Order Delivery
            </DialogTitle>
            <DialogDescription className="text-slate-600 text-sm">
              Please confirm delivery for this challan. Stock will be deducted and the order will move to Delivered Orders.
            </DialogDescription>
          </DialogHeader>
          {confirmDeliverGroup && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2.5 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Challan No:</span>
                <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {confirmDeliverGroup.challanNo}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Customer:</span>
                <span className="font-bold text-slate-900">{confirmDeliverGroup.customer}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Bill No:</span>
                <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 uppercase">
                  {confirmDeliverGroup.currentBillNo}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Items to Deliver:</span>
                <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto pr-1">
                  {confirmDeliverGroup.items?.map((it: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center py-0.5 border-b border-slate-100 last:border-0 text-slate-800">
                      <span>{it.product} {it.batchNo ? `(Batch: ${it.batchNo})` : ''}</span>
                      <span className="font-bold text-emerald-700 shrink-0 ml-2">{it.quantity} Qty</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeliverGroup(null)}
              disabled={isDelivering}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              onClick={executeDeliver}
              disabled={isDelivering}
            >
              {isDelivering ? "Delivering..." : "Yes, Deliver Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Challan Notes & Notifications Modal */}
      <Dialog open={notesModalOpen} onOpenChange={setNotesModalOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 text-slate-900 pr-6">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <Bell className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <div className="text-lg font-bold">Challan Notes</div>
                  <DialogDescription className="text-xs text-slate-500">
                    Write admin notes & manage pending tasks for delivery challans.
                  </DialogDescription>
                </div>
              </div>
              {pendingNotesCount > 0 ? (
                <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 font-bold px-2.5 py-0.5">
                  {pendingNotesCount} Pending
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold px-2.5 py-0.5">
                  All Caught Up
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Add Note Form */}
          <form onSubmit={handleAddNote} className="space-y-2 mt-2">
            <div className="flex gap-2">
              <Input
                placeholder="Write a note (e.g., Check driver delivery for CH-102)..."
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                className="flex-1 text-sm bg-white"
                disabled={isAddingNote}
                autoFocus
              />
              <Button
                type="submit"
                disabled={!newNoteText.trim() || isAddingNote}
                className="bg-primary hover:bg-primary/90 text-white font-semibold shrink-0"
              >
                <Plus className="h-4 w-4 mr-1" />
                {isAddingNote ? "Adding..." : "Add Note"}
              </Button>
            </div>
          </form>

          {/* Pending Notes List */}
          <div className="flex-1 overflow-y-auto mt-4 space-y-2.5 pr-1 max-h-[50vh]">
            <div className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center justify-between">
              <span>Pending Notes ({pendingNotes.length})</span>
            </div>

            {pendingNotes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50">
                <CheckCircle2 className="h-10 w-10 text-emerald-500/80 mb-2" />
                <p className="text-sm font-semibold text-slate-700">No pending notes</p>
                <p className="text-xs text-slate-500 mt-0.5">Write a new note above to track pending items.</p>
              </div>
            ) : (
              pendingNotes.map((n) => (
                <div
                  key={n.id}
                  className="p-3.5 rounded-lg border border-amber-200/80 bg-amber-50/40 hover:bg-amber-50/70 transition-colors shadow-2xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900 break-words flex-1 whitespace-pre-wrap">
                      {n.note}
                    </p>
                    <Badge className="bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100 font-semibold text-[11px] shrink-0">
                      Pending
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-amber-200/50 text-[11px] text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-slate-400" />
                      <span>{n.createdAt ? format(new Date(n.createdAt), "dd MMM yyyy, hh:mm a") : ""}</span>
                      {n.createdBy && <span className="text-slate-400 font-normal">by {n.createdBy}</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 font-semibold px-2 gap-1 rounded"
                        onClick={() => handleCompleteNote(n.id)}
                        disabled={isUpdatingNote === n.id}
                        title="Mark as Completed"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        {isUpdatingNote === n.id ? "Completing..." : "Complete"}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-slate-400 hover:text-destructive hover:bg-red-50 rounded"
                        onClick={() => handleDeleteNote(n.id)}
                        title="Delete Note"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <DialogFooter className="mt-4 pt-3 border-t border-slate-200 flex justify-between items-center sm:justify-between">
            <span className="text-xs text-slate-500">
              Completed notes are automatically removed from this pending list.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNotesModalOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
