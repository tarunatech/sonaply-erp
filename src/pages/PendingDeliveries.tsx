import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getSales, getChallans, exportCSV, addChallan, classifyPendingOrder, getBatches, getProducts, getClients, confirmChallanGroup, deleteChallanGroup, updateSale, cancelPendingDeliveryGroup, Sale, StockBatch, Challan, Product, Client, formatLocalDate, getLocalDateString } from "@/lib/store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Printer, Search, FilePlus2, CheckCircle2, Trash2, CalendarIcon, X, Pencil, User, Package, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

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
  const navigate = useNavigate();
  const location = useLocation();
  const [sales, setSales] = useState<Sale[]>([]);
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [challans, setChallans] = useState<Challan[]>([]);
  const [cancelledPChallans, setCancelledPChallans] = useState<Challan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [filter, setFilter] = useState(() => (location.state as any)?.search || "");
  const [selectedEstDate, setSelectedEstDate] = useState<string | null>(null);

  useEffect(() => {
    if ((location.state as any)?.search) {
      setFilter((location.state as any).search);
    }
  }, [location.state]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { toast } = useToast();
  const [showChallanDialog, setShowChallanDialog] = useState(false);
  const [currentSale, setCurrentSale] = useState<Sale | null>(null);
  const [challanForm, setChallanForm] = useState({ quantity: 0, batchNo: "", notes: "", stockCategory: "Available" });
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [orderClassifiedRows, setOrderClassifiedRows] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("erp_pending_order_classified");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const handleEditPendingOrder = (group: any) => {
    const firstSale = group.salesItems[0]?.sale;
    const orderNotes =
      group.salesItems.find((si: any) => si.pendingChallan?.notes)?.pendingChallan?.notes ||
      firstSale?.remarks ||
      "";
    const targetOrderNo = group.orderNo || firstSale?.orderNo || group.challanNo;
    const orderDateStr =
      typeof group.orderDate === "string" && group.orderDate.length >= 10
        ? group.orderDate.slice(0, 10)
        : firstSale?.orderDate
          ? typeof firstSale.orderDate === "string"
            ? firstSale.orderDate.slice(0, 10)
            : new Date(firstSale.orderDate).toISOString().slice(0, 10)
          : getLocalDateString();

    const orderSalesMap = new Map<string, Sale>();
    const orderNo = group.orderNo || firstSale?.orderNo;
    const isValidOrderNo = orderNo && !orderNo.startsWith("ORDER-");

    if (isValidOrderNo) {
      allSales
        .filter((s) => s.orderNo === orderNo && s.status !== "Cancelled")
        .forEach((s) => orderSalesMap.set(s.id, s));
    }

    const saleIdsInGroup = group.salesItems.map((si: any) => si.sale?.id).filter(Boolean);
    const relatedChallanNos = new Set(
      challans
        .filter((c) => saleIdsInGroup.includes(c.salesId) && !c.isCancelled)
        .map((c) => c.challanNo)
    );
    if (group.challanNo) relatedChallanNos.add(group.challanNo);

    if (relatedChallanNos.size > 0) {
      const siblingSaleIds = new Set(
        challans
          .filter((c) => relatedChallanNos.has(c.challanNo) && !c.isCancelled)
          .map((c) => c.salesId)
      );
      allSales
        .filter((s) => siblingSaleIds.has(s.id) && s.status !== "Cancelled")
        .forEach((s) => orderSalesMap.set(s.id, s));
    }

    // Always ensure all sales from group.salesItems are present
    group.salesItems.forEach((si: any) => {
      if (si.sale && si.sale.status !== "Cancelled") {
        orderSalesMap.set(si.sale.id, si.sale);
      }
    });

    const orderSales = Array.from(orderSalesMap.values());
    const itemsToEdit = orderSales.length > 0 ? orderSales : group.salesItems.map((si: any) => si.sale);

    navigate("/sales", {
      state: {
        editOrder: {
          orderNo: targetOrderNo,
          salesId: firstSale?.id,
          customer: group.customer,
          clientPhone: group.clientPhone || firstSale?.clientPhone || "",
          orderDate: orderDateStr,
          category: firstSale?.category || "Regular",
          notes: orderNotes,
          returnTo: "/pending-orders",
          items: itemsToEdit.map((itemSale: Sale) => {
            const si = group.salesItems.find((x: any) => x.sale?.id === itemSale.id);
            const itemChallan =
              si?.pendingChallan ||
              challans.find((c) => c.salesId === itemSale.id && !c.isCancelled);
            return {
              id: itemSale.id,
              salesId: itemSale.id,
              productName: itemSale.product,
              quantity: itemSale.orderedQty,
              fulfilledQty: itemSale.deliveredQty || 0,
              batchNo: itemSale.batchNo || itemChallan?.batchNo || "",
              notes: itemChallan?.notes || itemSale.remarks || "",
              stockCategory:
                itemSale.stockCategory || itemChallan?.stockCategory || "Available",
              isProductSelected: true,
            };
          }),
        },
      },
    });
  };

  const refresh = useCallback(async () => {
    const [s, b, c, prod, cl] = await Promise.all([getSales(), getBatches(), getChallans(), getProducts(), getClients()]);
    setBatches(b);
    setChallans(c);
    setProducts(prod);
    setClients(cl);
    setAllSales(s);

    // Pre-index active challans by salesId to optimize filtering from O(N*M) to O(N)
    const activeChallansBySalesId = new Map<string, Challan[]>();
    for (let i = 0; i < c.length; i++) {
      const ch = c[i];
      if (ch.isCancelled || !ch.salesId) continue;
      let list = activeChallansBySalesId.get(ch.salesId);
      if (!list) {
        list = [];
        activeChallansBySalesId.set(ch.salesId, list);
      }
      list.push(ch);
    }

    // Filter sales to ONLY show those with unhandled pending quantities or pending P-xxxx draft challans
    const pendingSales = s.filter(sale => {
      if (sale.status === "Cancelled") return false;

      const salePendingQty = Math.max(0, (sale.orderedQty || 0) - (sale.deliveredQty || 0));
      if (salePendingQty <= 0 && (!sale.pendingQty || sale.pendingQty <= 0)) return false;

      const saleChallans = activeChallansBySalesId.get(sale.id) || [];

      // Check if there is a P-xxxx challan waiting in Pending state
      const hasPendingPChallan = saleChallans.some(
        ch => ch.challanNo.startsWith("P-") && ch.status === "Pending"
      );
      if (hasPendingPChallan) return true;

      // Calculate quantity already covered by active non-delivered CH-xxxx challans or Confirmed P-xxxx challans
      const coveredQty = saleChallans.reduce((sum, ch) => {
        if (ch.status === "Delivered") return sum;
        const isCH = ch.challanNo.startsWith("CH-") || ch.challanNo.startsWith("CH");
        const isConfirmed = ch.status === "Confirmed";
        if (isCH || isConfirmed) {
          return sum + Number(ch.quantity || 0);
        }
        return sum;
      }, 0);

      const unhandledPendingQty = Math.max(0, (sale.pendingQty || salePendingQty) - coveredQty);
      return unhandledPendingQty > 0;
    });

    setSales(pendingSales);

    // Track cancelled P-xxx challans so admin can see and delete them
    const cancelledP = c.filter(ch =>
      ch.challanNo.startsWith("P-") && ch.isCancelled
    );
    setCancelledPChallans(cancelledP);
  }, []);

  useEffect(() => {
    refresh();
    const handleStockUpdate = () => refresh();
    window.addEventListener("erp-stock-updated", handleStockUpdate);
    return () => window.removeEventListener("erp-stock-updated", handleStockUpdate);
  }, [refresh]);

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
      if (ch.status === "Delivered") return sum;
      const isCH = ch.challanNo.startsWith("CH-") || ch.challanNo.startsWith("CH");
      const isConfirmed = ch.status === "Confirmed";
      if (isCH || isConfirmed) {
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

  const handleCancelPendingGroup = async (group: any) => {
    const targetKey = group.challanNo || group.orderNo;
    const ok = window.confirm(
      `Cancel pending delivery for ${group.customer} (${targetKey})? Any previously delivered items will remain delivered, and pending quantities will be cancelled and restored to stock.`
    );
    if (!ok) return;
    try {
      await cancelPendingDeliveryGroup(targetKey);
      toast({ title: "Pending Order Cancelled", description: `Pending items for ${group.customer} cancelled and stock updated.` });
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      refresh();
    } catch (err: any) {
      toast({ title: "Failed to cancel pending order", description: err.message, variant: "destructive" });
    }
  };

  const handleUpdateEstimatedDate = async (group: any, newDateStr: string) => {
    try {
      await Promise.all(
        group.salesItems.map((item: any) =>
          updateSale(item.sale.id, { estimatedDeliveryDate: newDateStr })
        )
      );
      toast({
        title: "Estimated Delivery Date Saved",
        description: `Set estimated delivery date to ${format(parseLocalDate(newDateStr), "dd-MM-yyyy")}`,
      });
      refresh();
    } catch (err: any) {
      toast({
        title: "Update Failed",
        description: err.message || "Could not save estimated delivery date.",
        variant: "destructive",
      });
    }
  };

  const handleToggleClassifyOrder = async (group: any, checked: boolean) => {
    const saleIds = group.salesItems.map((si: any) => si.sale.id);

    // Optimistic UI updates
    setSales(prev => prev.map(s => {
      if (saleIds.includes(s.id) || (group.orderNo && s.orderNo === group.orderNo)) {
        return { ...s, isOrder: checked };
      }
      return s;
    }));
    setAllSales(prev => prev.map(s => {
      if (saleIds.includes(s.id) || (group.orderNo && s.orderNo === group.orderNo)) {
        return { ...s, isOrder: checked };
      }
      return s;
    }));
    setChallans(prev => prev.map(c => {
      if ((group.challanNo && c.challanNo === group.challanNo) || saleIds.includes(c.salesId)) {
        return { ...c, isOrder: checked };
      }
      return c;
    }));

    setOrderClassifiedRows(prev => {
      const next = { ...prev };
      if (group.groupKey) next[group.groupKey] = checked;
      if (group.orderNo) next[group.orderNo] = checked;
      if (group.challanNo) next[group.challanNo] = checked;
      try {
        localStorage.setItem("erp_pending_order_classified", JSON.stringify(next));
      } catch {}
      return next;
    });

    try {
      await classifyPendingOrder({
        orderNo: group.orderNo,
        challanNo: group.challanNo || undefined,
        salesIds: saleIds,
        isOrder: checked,
      });
      toast({
        title: checked ? "Marked as Order" : "Unmarked as Order",
        description: `${group.challanNo || group.orderNo} is ${checked ? "now marked as Order" : "no longer marked as Order"}.`,
      });
    } catch (err: any) {
      toast({
        title: "Update Failed",
        description: err.message || "Could not save order classification.",
        variant: "destructive",
      });
      refresh();
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
    let base = sales;
    if (selectedEstDate) {
      base = base.filter(s => s.estimatedDeliveryDate === selectedEstDate);
    }
    if (filter) {
      const f = filter.toLowerCase().trim();
      base = base.filter(s => {
        const pendingChallan = getPendingChallanForSale(s.id);
        return (
          (s.customer || '').toLowerCase().includes(f) ||
          (s.product || '').toLowerCase().includes(f) ||
          (s.orderNo || '').toLowerCase().includes(f) ||
          (pendingChallan?.challanNo || '').toLowerCase().includes(f)
        );
      });
    }
    return base.sort((a, b) => {
      const dateA = a.updatedAt || a.createdAt || a.orderDate || "";
      const dateB = b.updatedAt || b.createdAt || b.orderDate || "";
      const dateCompare = dateB.localeCompare(dateA);
      if (dateCompare !== 0) return dateCompare;
      return (b.orderNo || '').localeCompare(a.orderNo || '', undefined, { numeric: true, sensitivity: "base" });
    });
  }, [sales, filter, selectedEstDate, challans]);

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
      // Group by pending draft challan number first, then orderNo, then unique fallback
      const groupKey = (pendingChallan && pendingChallan.challanNo) || s.orderNo || `ORDER-${s.id}`;

      const displayPendingQty = getUnhandledPendingQty(s);

      const totalStock = batches
        .filter(b => {
          const nameMatches = b.productName.trim().toLowerCase() === s.product.trim().toLowerCase();
          if (!nameMatches) return false;
          if (s.batchNo && s.batchNo !== "0" && s.batchNo.trim() !== "") {
            return (b.batchNumber || "").trim().toLowerCase() === s.batchNo.trim().toLowerCase();
          }
          return true;
        })
        .reduce((acc, curr) => {
          const col = s.stockCategory === "Display" ? curr.displayQty : s.stockCategory === "Damage" ? curr.damageQty : curr.availableQty;
          return acc + Number(col || 0);
        }, 0);

      if (!groups[groupKey]) {
        groups[groupKey] = {
          groupKey: groupKey,
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

      if (pendingChallan && (!groups[groupKey].challanNo || !groups[groupKey].challanNo.startsWith("P-"))) {
        groups[groupKey].challanNo = pendingChallan.challanNo;
        groups[groupKey].createdAt = pendingChallan.createdAt || groups[groupKey].createdAt;
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

  useEffect(() => {
    setPage(1);
  }, [filter, selectedEstDate, pageSize]);

  const totalPages = Math.max(1, Math.ceil(groupedPendingDeliveries.length / pageSize));

  const paginatedPendingDeliveries = useMemo(() => {
    const start = (page - 1) * pageSize;
    return groupedPendingDeliveries.slice(start, start + pageSize);
  }, [groupedPendingDeliveries, page, pageSize]);



  // Migrate any previous localStorage order-classified records to database
  useEffect(() => {
    if (sales.length > 0 && Object.keys(orderClassifiedRows).length > 0) {
      const unmigratedGroups = groupedPendingDeliveries.filter(g => {
        const isDb = g.salesItems.some(i => i.sale.isOrder || i.pendingChallan?.isOrder);
        const isLocal = !!(orderClassifiedRows[g.groupKey] || (g.challanNo && orderClassifiedRows[g.challanNo]) || (g.orderNo && orderClassifiedRows[g.orderNo]));
        return isLocal && !isDb;
      });
      if (unmigratedGroups.length > 0) {
        unmigratedGroups.forEach(g => {
          classifyPendingOrder({
            orderNo: g.orderNo,
            challanNo: g.challanNo || undefined,
            salesIds: g.salesItems.map(si => si.sale.id),
            isOrder: true,
          }).catch(() => {});
        });
      }
    }
  }, [sales, groupedPendingDeliveries, orderClassifiedRows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-red-600">Pending Deliveries</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customer, product or order..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-9 pr-8 h-9"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-9 px-3 gap-1.5 transition-all ${selectedEstDate
                    ? "border-blue-500 bg-blue-50 text-blue-950 font-semibold hover:bg-blue-100"
                    : "text-slate-700 hover:bg-slate-100"
                    }`}
                >
                  <CalendarIcon className="h-4 w-4 text-blue-600 shrink-0" />
                  {selectedEstDate
                    ? `Est: ${format(parseLocalDate(selectedEstDate), "dd-MM-yyyy")}`
                    : "Filter by Est. Date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedEstDate ? parseLocalDate(selectedEstDate) : undefined}
                  onSelect={(date) => {
                    if (date) {
                      setSelectedEstDate(getLocalDateString(date));
                    } else {
                      setSelectedEstDate(null);
                    }
                  }}
                  initialFocus
                />
                {selectedEstDate && (
                  <div className="p-2 border-t border-slate-100 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setSelectedEstDate(null)}
                    >
                      Clear Date Filter
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
            {selectedEstDate && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs text-slate-500 hover:text-slate-900"
                onClick={() => setSelectedEstDate(null)}
                title="Clear date filter"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredSales as any, `pending-${new Date().toISOString().slice(0, 10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
          <Button variant="outline" size="sm" onClick={() => printElement("pending-table")}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0" id="pending-table">
          <Table className="border-collapse border-2 border-slate-300 w-full" wrapperClassName="max-h-[calc(100vh-210px)] overflow-x-auto">
            <TableHeader className="sticky top-0 bg-slate-100 z-10 shadow-2xs border-b-2 border-slate-300">
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-2.5 py-2.5 whitespace-nowrap">Date</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-2.5 py-2.5 whitespace-nowrap">Challan #</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-2.5 py-2.5 whitespace-nowrap">Client</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-2.5 py-2.5">Product</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-2 py-2.5 text-right whitespace-nowrap">Ordered</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-green-600 px-2 py-2.5 text-right whitespace-nowrap">Delivered</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-red-600 px-2 py-2.5 text-right whitespace-nowrap">Pending Qty</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-2 py-2.5 whitespace-nowrap">Status</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-2.5 py-2.5 text-right whitespace-nowrap">Action</TableHead>
              </TableRow>
            </TableHeader>
              <TableBody>
                {paginatedPendingDeliveries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="border-2 border-slate-300 text-center text-muted-foreground py-8">
                      {selectedEstDate || filter
                        ? `No pending deliveries found${selectedEstDate ? ` for estimated date ${format(parseLocalDate(selectedEstDate), "dd-MM-yyyy")}` : ""}${filter ? ` matching "${filter}"` : ""}.`
                        : "No pending deliveries!"}
                    </TableCell>
                  </TableRow>
                ) : paginatedPendingDeliveries.map(group => {
                  const estDate = group.salesItems.find(i => i.sale.estimatedDeliveryDate)?.sale.estimatedDeliveryDate || null;
                  const isRawOrderNo = group.orderNo.startsWith("ORD-");
                  const displayChallanNo = group.challanNo || group.orderNo;
                  const isDbClassified = group.salesItems.some(i => i.sale.isOrder || i.pendingChallan?.isOrder);
                  const isLocalClassified = !!(
                    orderClassifiedRows[group.groupKey] ||
                    (group.challanNo && orderClassifiedRows[group.challanNo]) ||
                    (group.orderNo && orderClassifiedRows[group.orderNo])
                  );
                  const isOrderClassified = isDbClassified || isLocalClassified;

                  return (
                    <TableRow key={group.groupKey} className="hover:bg-slate-50/40">
                      <TableCell className="border-2 border-slate-300 px-2.5 py-2 text-sm text-slate-700 font-medium whitespace-nowrap">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id={`order-chk-${group.groupKey}`}
                            checked={isOrderClassified}
                            onCheckedChange={(checked) => handleToggleClassifyOrder(group, !!checked)}
                            className="h-4 w-4 rounded border-slate-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 mt-0.5 shrink-0"
                            title="Classify as Order (reference purpose)"
                          />
                          <div>
                            <div className="font-semibold text-slate-900">{formatLocalDate(group.createdAt || group.orderDate)}</div>
                            {isOrderClassified && (
                              <div className="mt-0.5">
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                                  Order
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-1.5">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className={`h-6 text-[11px] px-1.5 gap-1 border-dashed transition-all ${estDate
                                  ? "border-blue-500 bg-blue-50 text-blue-950 font-bold hover:bg-blue-100"
                                  : "border-slate-300 bg-background text-slate-500 hover:text-slate-900 hover:border-slate-400"
                                  }`}
                              >
                                <CalendarIcon className="h-3 w-3 shrink-0 text-blue-600" />
                                {estDate
                                  ? `Est: ${format(parseLocalDate(estDate), "dd-MM-yyyy")}`
                                  : "Est. Delivery"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={estDate ? parseLocalDate(estDate) : undefined}
                                onSelect={(date) => {
                                  if (date) {
                                    handleUpdateEstimatedDate(group, getLocalDateString(date));
                                  }
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-2.5 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">
                        <div className="text-sm font-extrabold text-orange-600 bg-orange-50/90 border border-orange-200 px-2 py-0.5 rounded w-fit shadow-2xs whitespace-nowrap">
                          {displayChallanNo}
                        </div>
                        {!isRawOrderNo && group.orderNo !== displayChallanNo && (
                          <div className="text-[11px] text-slate-500 mt-1 font-medium whitespace-nowrap">{group.orderNo}</div>
                        )}
                        {(() => {
                          const groupSaleIds = group.salesItems.map((si) => si.sale.id);
                          const linkedCH = Array.from(new Set(
                            challans
                              .filter((c) => {
                                if (c.isCancelled || c.status === "Delivered") return false;
                                const isCH = c.challanNo.startsWith("CH-") || c.challanNo.startsWith("CH");
                                if (!isCH) return false;
                                const matchesSale = groupSaleIds.includes(c.salesId);
                                const matchesOrder = group.orderNo && !group.orderNo.startsWith("ORD-") && allSales.find((s) => s.id === c.salesId)?.orderNo === group.orderNo;
                                return matchesSale || matchesOrder;
                              })
                              .map((c) => c.challanNo)
                          ));
                          if (linkedCH.length === 0) return null;
                          return (
                            <div className="flex flex-wrap gap-1 items-center mt-1">
                              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Delivery:</span>
                              {linkedCH.map((cn) => (
                                <button
                                  key={cn}
                                  type="button"
                                  onClick={() => navigate("/challans", { state: { search: cn } })}
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs cursor-pointer transition-colors"
                                  title={`Click to view delivery challan ${cn}`}
                                >
                                  🔗 {cn}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-2.5 py-2 text-sm min-w-[120px] max-w-[180px] break-words">
                        {renderCustomer(group.customer)}
                        <div className="text-[10px] text-muted-foreground mt-0.5">{group.clientPhone}</div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-2.5 py-1">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1 border-b border-slate-100 last:border-0 flex flex-col justify-center min-h-[44px]">
                              <div className="font-semibold text-slate-900 text-xs sm:text-sm">{item.sale.product}</div>
                              <div className="flex flex-wrap gap-1 items-center mt-0.5">
                                {(() => {
                                  const prodCat = products.find(p => p.name.trim().toLowerCase() === item.sale.product.trim().toLowerCase())?.category || batches.find(b => b.productName.trim().toLowerCase() === item.sale.product.trim().toLowerCase())?.category || item.sale.category || "";
                                  return prodCat && prodCat !== "Regular" ? (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                      Cat: {prodCat}
                                    </span>
                                  ) : null;
                                })()}
                                {item.sale.batchNo && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                    Batch: {item.sale.batchNo}
                                  </span>
                                )}
                                {item.totalStock >= 0 ? (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-green-50 text-green-800 border border-green-200">
                                    Stock: Ready ({item.totalStock} extra)
                                  </span>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-red-50 text-red-800 border border-red-200">
                                    Stock: Shortage ({Math.abs(item.totalStock)})
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
                                <div className="text-[10px] text-orange-600 font-semibold mt-1 bg-orange-50 px-2 py-0.5 rounded border border-orange-100 w-fit">
                                  Narration: {notesText}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-2 py-1 text-right">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1 border-b border-slate-100 last:border-0 flex items-center justify-end min-h-[44px] font-semibold text-slate-700 text-xs sm:text-sm">
                              {item.sale.orderedQty}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-2 py-1 text-right">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1 border-b border-slate-100 last:border-0 flex items-center justify-end min-h-[44px] font-semibold text-green-600 text-xs sm:text-sm">
                              {item.sale.deliveredQty}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-2 py-1 text-right">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1 border-b border-slate-100 last:border-0 flex items-center justify-end min-h-[44px] font-black text-red-600 text-base sm:text-lg">
                              {item.displayPendingQty}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-2 py-2 align-middle">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${group.status === "Confirmed" ? "bg-blue-100 text-blue-800" :
                          group.status === "Partial" ? "bg-amber-100 text-amber-800" :
                            "bg-red-100 text-red-800"
                          }`}>{group.status}</span>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-2 py-1 text-right align-middle">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1 border-b border-slate-100 last:border-0 flex items-center justify-end gap-1 min-h-[44px] flex-nowrap">
                              {group.challanNo ? (
                                idx === 0 && (
                                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-xs h-7 px-2.5 font-semibold shadow-2xs" onClick={() => handleConfirmChallan(group.salesItems[0]?.pendingChallan || ({ challanNo: group.challanNo } as any))}>
                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Confirm
                                  </Button>
                                )
                              ) : (
                                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-xs h-7 px-2 font-semibold shadow-2xs" onClick={() => {
                                  setCurrentSale(item.sale);
                                  setChallanForm({ quantity: item.displayPendingQty, batchNo: item.sale.batchNo || "0", notes: "", stockCategory: item.sale.stockCategory || "Available" });
                                  setShowChallanDialog(true);
                                }}>
                                  <FilePlus2 className="mr-1 h-3.5 w-3.5" /> Generate
                                </Button>
                              )}
                              {idx === 0 && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-medium shrink-0"
                                    onClick={() => handleEditPendingOrder(group)}
                                    title="Edit Order in Sales Module"
                                  >
                                    <Pencil className="h-3.5 w-3.5 mr-1 text-slate-600" /> Edit
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 font-medium shrink-0"
                                    onClick={() => handleCancelPendingGroup(group)}
                                    title="Cancel Remaining Pending Quantity"
                                  >
                                    <X className="h-3.5 w-3.5 mr-1 text-red-600" /> Cancel
                                  </Button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {groupedPendingDeliveries.length > 0 && (
              <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between p-3 border-t bg-slate-50 text-xs gap-3 no-print shadow-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-muted-foreground">
                    Showing <strong>{(page - 1) * pageSize + 1}</strong> to{" "}
                    <strong>{Math.min(page * pageSize, groupedPendingDeliveries.length)}</strong> of{" "}
                    <strong>{groupedPendingDeliveries.length}</strong> pending orders
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Per page:</span>
                    <Select value={String(pageSize)} onValueChange={(val) => { setPageSize(Number(val)); setPage(1); }}>
                      <SelectTrigger className="h-7 w-[68px] text-xs bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <span className="font-semibold text-slate-700 min-w-[75px] text-center">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
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
