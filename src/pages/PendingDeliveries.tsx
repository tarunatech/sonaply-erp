import { useState, useMemo, useEffect, useCallback } from "react";
import { getSales, getChallans, exportCSV, addChallan, generatePendingGroupChallan, getBatches, getProducts, getClients, confirmChallanGroup, deleteChallanGroup, updateChallanGroup, updateSale, Sale, StockBatch, Challan, Product, Client, formatLocalDate, getLocalDateString } from "@/lib/store";
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
  const [sales, setSales] = useState<Sale[]>([]);
  const [challans, setChallans] = useState<Challan[]>([]);
  const [cancelledPChallans, setCancelledPChallans] = useState<Challan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedEstDate, setSelectedEstDate] = useState<string | null>(null);
  const { toast } = useToast();
  const [showChallanDialog, setShowChallanDialog] = useState(false);
  const [currentSale, setCurrentSale] = useState<Sale | null>(null);
  const [challanForm, setChallanForm] = useState({ quantity: 0, batchNo: "", notes: "", stockCategory: "Available" });
  const [batches, setBatches] = useState<StockBatch[]>([]);

  // Edit dialog state
  interface EditItemForm {
    id?: number;          // challan id
    salesId?: number;     // sale id
    product: string;
    orderedQty: number;
    deliveredQty: number;
    batchNo: string;
    stockCategory: "Available" | "Display" | "Damage";
    remarks: string;
  }

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [showClientSearch, setShowClientSearch] = useState(false);
  const [selectedClientIndexForEdit, setSelectedClientIndexForEdit] = useState<number>(-1);
  const [activeProductSearchIndex, setActiveProductSearchIndex] = useState<number | null>(null);
  const [selectedProductIndexForEdit, setSelectedProductIndexForEdit] = useState<number>(-1);
  const [editForm, setEditForm] = useState<{
    challanNo: string | null;
    orderNo: string;
    customer: string;
    clientPhone: string;
    estimatedDeliveryDate: string;
    items: EditItemForm[];
  }>({
    challanNo: null,
    orderNo: "",
    customer: "",
    clientPhone: "",
    estimatedDeliveryDate: "",
    items: [],
  });

  const refresh = useCallback(async () => {
    const [s, b, c, prod, cl] = await Promise.all([getSales(), getBatches(), getChallans(), getProducts(), getClients()]);
    setBatches(b);
    setChallans(c);
    setProducts(prod);
    setClients(cl);

    // Filter sales to ONLY show those with unhandled pending quantities or pending P-xxxx draft challans
    const pendingSales = s.filter(sale => {
      if (sale.status === "Cancelled") return false;

      const salePendingQty = Math.max(0, (sale.orderedQty || 0) - (sale.deliveredQty || 0));
      if (salePendingQty <= 0 && (!sale.pendingQty || sale.pendingQty <= 0)) return false;

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

  const handleOpenEditGroupModal = async (group: any) => {
    await refresh();
    setEditingGroup(group);
    setEditForm({
      challanNo: group.challanNo,
      orderNo: group.orderNo,
      customer: group.customer || "",
      clientPhone: group.clientPhone || "",
      estimatedDeliveryDate: group.salesItems[0]?.sale.estimatedDeliveryDate || "",
      items: group.salesItems.map((si: any) => ({
        id: si.pendingChallan ? si.pendingChallan.id : undefined,
        salesId: si.sale.id,
        product: si.sale.product || "",
        orderedQty: si.sale.orderedQty || 1,
        deliveredQty: si.sale.deliveredQty || 0,
        batchNo: si.sale.batchNo || "0",
        stockCategory: si.sale.stockCategory || "Available",
        remarks: si.pendingChallan?.notes || si.sale.remarks || "",
      })),
    });
    setShowEditDialog(true);
  };

  const handleAddProductItem = () => {
    setEditForm(prev => ({
      ...prev,
      items: [
        {
          product: "",
          orderedQty: 1,
          deliveredQty: 0,
          batchNo: "0",
          stockCategory: "Available",
          remarks: "",
        },
        ...prev.items,
      ],
    }));
  };

  const handleRemoveProductItem = (index: number) => {
    setEditForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const handleUpdateItemRow = (index: number, field: string, value: any) => {
    setEditForm(prev => {
      const nextItems = [...prev.items];
      nextItems[index] = { ...nextItems[index], [field]: value };
      return { ...prev, items: nextItems };
    });
  };

  const handleSaveGroupEdit = async () => {
    if (!editingGroup) return;
    if (!editForm.customer.trim()) {
      toast({ title: "Validation Error", description: "Customer name is required.", variant: "destructive" });
      return;
    }
    if (editForm.items.length === 0) {
      toast({ title: "Validation Error", description: "At least one product item is required.", variant: "destructive" });
      return;
    }
    for (let i = 0; i < editForm.items.length; i++) {
      const item = editForm.items[i];
      if (!item.product.trim()) {
        toast({ title: "Validation Error", description: `Product name is required for item #${i + 1}.`, variant: "destructive" });
        return;
      }
      if (item.orderedQty <= 0) {
        toast({ title: "Validation Error", description: `Ordered quantity must be greater than 0 for item #${i + 1}.`, variant: "destructive" });
        return;
      }
    }

    try {
      const groupKey = editForm.challanNo || editForm.orderNo;
      await updateChallanGroup(groupKey, {
        customer: editForm.customer,
        client_phone: editForm.clientPhone,
        date: editForm.estimatedDeliveryDate || undefined,
        items: editForm.items.map(item => ({
          id: item.id,
          salesId: item.salesId,
          productName: item.product,
          quantity: item.orderedQty,
          batchNo: item.batchNo || "0",
          stockCategory: item.stockCategory || "Available",
          notes: item.remarks || "",
        })),
      });

      toast({
        title: "Pending Delivery Order Updated",
        description: `Updated order details with ${editForm.items.length} product(s).`,
      });

      setShowEditDialog(false);
      setEditingGroup(null);
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      refresh();
    } catch (err: any) {
      toast({
        title: "Update Failed",
        description: err.message || "Could not update pending delivery order.",
        variant: "destructive",
      });
    }
  };

  const filteredSales = useMemo(() => {
    let base = sales;
    if (selectedEstDate) {
      base = base.filter(s => s.estimatedDeliveryDate === selectedEstDate);
    }
    if (filter) {
      const f = filter.toLowerCase();
      base = base.filter(s =>
        (s.customer || '').toLowerCase().includes(f) ||
        (s.product || '').toLowerCase().includes(f) ||
        (s.orderNo || '').toLowerCase().includes(f)
      );
    }
    return base.sort((a, b) => {
      const dateA = a.updatedAt || a.createdAt || a.orderDate || "";
      const dateB = b.updatedAt || b.createdAt || b.orderDate || "";
      const dateCompare = dateB.localeCompare(dateA);
      if (dateCompare !== 0) return dateCompare;
      return (b.orderNo || '').localeCompare(a.orderNo || '', undefined, { numeric: true, sensitivity: "base" });
    });
  }, [sales, filter, selectedEstDate]);

  const currentProductBatches = useMemo(() => currentSale ? batches.filter(b => b.productName === currentSale.product) : [], [currentSale, batches]);

  const currentBatchOptions = useMemo(() => {
    const list = new Set<string>();
    if (currentSale?.batchNo) list.add(currentSale.batchNo);
    currentProductBatches.forEach(b => { if (b.batchNumber) list.add(b.batchNumber); });
    return Array.from(list);
  }, [currentSale, currentProductBatches]);

  const filteredClientsForEdit = useMemo(() => {
    const q = editForm.customer.toLowerCase().trim();
    if (!q) return clients;
    return clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q)
    );
  }, [clients, editForm.customer]);

  const allProductNames = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (p.name && p.name.trim()) set.add(p.name.trim());
    });
    batches.forEach(b => {
      if (b.productName && b.productName.trim()) set.add(b.productName.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [products, batches]);

  const filteredProductsForEdit = useMemo(() => {
    const activeItem = activeProductSearchIndex !== null ? editForm.items[activeProductSearchIndex] : null;
    const q = (activeItem?.product || "").toLowerCase().trim();
    if (!q) return allProductNames;
    return allProductNames.filter(name =>
      name.toLowerCase().includes(q)
    );
  }, [allProductNames, editForm.items, activeProductSearchIndex]);

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
      const orderKey = s.orderNo || `ORDER-${s.id}`;

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

      if (!groups[orderKey]) {
        groups[orderKey] = {
          groupKey: pendingChallan ? pendingChallan.challanNo : orderKey,
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

      if (pendingChallan && (!groups[orderKey].challanNo || !groups[orderKey].challanNo.startsWith("P-"))) {
        groups[orderKey].challanNo = pendingChallan.challanNo;
        groups[orderKey].groupKey = pendingChallan.challanNo;
        groups[orderKey].createdAt = pendingChallan.createdAt || groups[orderKey].createdAt;
      }

      groups[orderKey].salesItems.push({
        sale: s,
        pendingChallan,
        displayPendingQty,
        totalStock
      });
    });

    return Object.values(groups);
  }, [filteredSales, challans, batches]);

  useEffect(() => {
    if (groupedPendingDeliveries.length > 0) {
      const missingChallans = groupedPendingDeliveries.filter(g => !g.challanNo && g.salesItems.length > 0);
      if (missingChallans.length > 0) {
        Promise.all(
          missingChallans.map(g =>
            generatePendingGroupChallan(g.orderNo, g.salesItems.map(si => si.sale.id))
          )
        ).then(results => {
          if (results.some(res => res && res.length > 0)) {
            refresh();
          }
        }).catch(err => {
          console.error("Auto-generate pending challans error:", err);
        });
      }
    }
  }, [groupedPendingDeliveries, refresh]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-red-600">Pending Deliveries</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search customer, product or order..." value={filter} onChange={e => setFilter(e.target.value)} className="pl-9 h-9" />
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
          <Table className="border-collapse border-2 border-slate-300 w-full" wrapperClassName="max-h-[calc(100vh-130px)]">
            <TableHeader className="sticky top-0 bg-slate-100 z-10 shadow-2xs border-b-2 border-slate-300">
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 whitespace-nowrap">Date</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 whitespace-nowrap">Challan #</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 whitespace-nowrap">Client</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 whitespace-nowrap">Product</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right whitespace-nowrap">Ordered</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-green-600 px-4 py-3 text-right whitespace-nowrap">Delivered</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-red-600 px-4 py-3 text-right whitespace-nowrap">Pending Qty</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 whitespace-nowrap">Status</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right whitespace-nowrap">Action</TableHead>
              </TableRow>
            </TableHeader>
              <TableBody>
                {groupedPendingDeliveries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="border-2 border-slate-300 text-center text-muted-foreground py-8">
                      {selectedEstDate || filter
                        ? `No pending deliveries found${selectedEstDate ? ` for estimated date ${format(parseLocalDate(selectedEstDate), "dd-MM-yyyy")}` : ""}${filter ? ` matching "${filter}"` : ""}.`
                        : "No pending deliveries!"}
                    </TableCell>
                  </TableRow>
                ) : groupedPendingDeliveries.map(group => {
                  const estDate = group.salesItems.find(i => i.sale.estimatedDeliveryDate)?.sale.estimatedDeliveryDate || null;
                  const isRawOrderNo = group.orderNo.startsWith("ORD-");
                  const displayChallanNo = group.challanNo || (isRawOrderNo ? "P--" : group.orderNo);

                  return (
                    <TableRow key={group.groupKey} className="hover:bg-slate-50/40">
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700 font-medium whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{formatLocalDate(group.createdAt || group.orderDate)}</div>
                        <div className="mt-1.5">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className={`h-7 text-xs px-2 gap-1.5 border-dashed transition-all ${estDate
                                  ? "border-blue-500 bg-blue-50 text-blue-950 font-bold hover:bg-blue-100"
                                  : "border-slate-300 bg-background text-slate-500 hover:text-slate-900 hover:border-slate-400"
                                  }`}
                              >
                                <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-blue-600" />
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
                      <TableCell className="border-2 border-slate-300 px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                        <div className="text-base font-extrabold text-orange-600 bg-orange-50/90 border border-orange-200 px-2 py-1 rounded w-fit shadow-2xs whitespace-nowrap">
                          {displayChallanNo}
                        </div>
                        {!isRawOrderNo && group.orderNo !== displayChallanNo && (
                          <div className="text-[11px] text-slate-500 mt-1 font-medium whitespace-nowrap">{group.orderNo}</div>
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
                                {(() => {
                                  const prodCat = products.find(p => p.name.trim().toLowerCase() === item.sale.product.trim().toLowerCase())?.category || batches.find(b => b.productName.trim().toLowerCase() === item.sale.product.trim().toLowerCase())?.category || item.sale.category || "";
                                  return prodCat && prodCat !== "Regular" ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                      Cat: {prodCat}
                                    </span>
                                  ) : null;
                                })()}
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
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${group.status === "Confirmed" ? "bg-blue-100 text-blue-800" :
                          group.status === "Partial" ? "bg-amber-100 text-amber-800" :
                            "bg-red-100 text-red-800"
                          }`}>{group.status}</span>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-1 text-right align-middle">
                        <div className="space-y-0">
                          {group.salesItems.map((item, idx) => (
                            <div key={idx} className="py-1.5 border-b border-slate-100 last:border-0 flex items-center justify-end gap-1.5 min-h-[50px]">
                              {group.challanNo ? (
                                idx === 0 && (
                                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-xs" onClick={() => handleConfirmChallan(group.salesItems[0].pendingChallan!)}>
                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Confirm {group.challanNo}
                                  </Button>
                                )
                              ) : (
                                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-[10px] h-7 px-2" onClick={() => {
                                  setCurrentSale(item.sale);
                                  setChallanForm({ quantity: item.displayPendingQty, batchNo: item.sale.batchNo || "0", notes: "", stockCategory: item.sale.stockCategory || "Available" });
                                  setShowChallanDialog(true);
                                }}>
                                  <FilePlus2 className="mr-1 h-3 w-3" /> Generate
                                </Button>
                              )}
                              {idx === 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                                  onClick={() => handleOpenEditGroupModal(group)}
                                  title="Edit Order / Pending Delivery Details"
                                >
                                  <Pencil className="h-3.5 w-3.5 mr-1 text-slate-600" /> Edit Order
                                </Button>
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

      {/* Edit Pending Delivery Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Pending Delivery Details {editForm.challanNo ? `(${editForm.challanNo})` : editForm.orderNo ? `(${editForm.orderNo})` : ""}</DialogTitle>
            <DialogDescription>
              Modify customer details, delivery date, products, quantities, batches, or add new products to this pending order.
            </DialogDescription>
          </DialogHeader>

          {editingGroup && (
            <div className="space-y-4 py-2 text-sm">
              {/* Order Header Fields */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
                {/* Client Name with Auto-Search */}
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Client Name</Label>
                  <div className="relative">
                    <Input
                      className="h-9 pr-8 bg-white"
                      value={editForm.customer}
                      onChange={e => {
                        const val = e.target.value;
                        setEditForm(prev => ({ ...prev, customer: val }));
                        setShowClientSearch(true);
                        setSelectedClientIndexForEdit(-1);
                      }}
                      onFocus={() => {
                        setShowClientSearch(true);
                        setSelectedClientIndexForEdit(-1);
                      }}
                      onBlur={() => setTimeout(() => {
                        setShowClientSearch(false);
                        setSelectedClientIndexForEdit(-1);
                      }, 200)}
                      onKeyDown={e => {
                        if (!showClientSearch || filteredClientsForEdit.length === 0) return;
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSelectedClientIndexForEdit(prev => (prev < filteredClientsForEdit.length - 1 ? prev + 1 : 0));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSelectedClientIndexForEdit(prev => (prev > 0 ? prev - 1 : filteredClientsForEdit.length - 1));
                        } else if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          const idxToPick = selectedClientIndexForEdit >= 0 ? selectedClientIndexForEdit : 0;
                          const c = filteredClientsForEdit[idxToPick];
                          if (c) {
                            setEditForm(prev => ({
                              ...prev,
                              customer: c.name,
                              clientPhone: c.phone || prev.clientPhone,
                            }));
                            setShowClientSearch(false);
                            setSelectedClientIndexForEdit(-1);
                          }
                        } else if (e.key === 'Escape') {
                          setShowClientSearch(false);
                          setSelectedClientIndexForEdit(-1);
                        }
                      }}
                      placeholder="Search client..."
                      autoComplete="off"
                    />
                    <User className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />

                    {showClientSearch && filteredClientsForEdit.length > 0 && (
                      <div className="absolute z-[120] left-0 right-0 mt-1 bg-popover border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {filteredClientsForEdit.map((c, i) => (
                          <div
                            key={c.id}
                            className={`px-3 py-2 cursor-pointer text-xs flex items-center justify-between border-b border-slate-100 last:border-0 ${selectedClientIndexForEdit === i ? 'bg-blue-50 text-blue-900 font-semibold' : 'hover:bg-slate-100'}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setEditForm(prev => ({
                                ...prev,
                                customer: c.name,
                                clientPhone: c.phone || prev.clientPhone,
                              }));
                              setShowClientSearch(false);
                              setSelectedClientIndexForEdit(-1);
                            }}
                          >
                            <span className="font-semibold text-slate-900">{c.name}</span>
                            <span className="text-[11px] text-slate-500 font-mono">{c.phone || "No phone"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Phone Number */}
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-slate-700">Phone Number</Label>
                  <Input
                    className="h-9 bg-white"
                    value={editForm.clientPhone}
                    onChange={e => setEditForm({ ...editForm, clientPhone: e.target.value })}
                    placeholder="Phone number"
                  />
                </div>

                {/* Estimated Delivery Date */}
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label className="text-xs font-bold text-slate-700">Est. Delivery Date</Label>
                  <Input
                    type="date"
                    className="h-9 bg-white"
                    value={editForm.estimatedDeliveryDate}
                    onChange={e => setEditForm({ ...editForm, estimatedDeliveryDate: e.target.value })}
                  />
                </div>
              </div>

              {/* Products Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                    <Package className="h-4 w-4 text-blue-600" /> Products & Order Items
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                    onClick={handleAddProductItem}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Product
                  </Button>
                </div>

                {editForm.items.map((item, idx) => {
                  const allProductBatches = batches.filter(b => b.productName.trim().toLowerCase() === item.product.trim().toLowerCase());
                  const matchingBatches = batches.filter(b => {
                    const nameMatches = b.productName.trim().toLowerCase() === item.product.trim().toLowerCase();
                    if (!nameMatches) return false;
                    if (item.batchNo && item.batchNo !== "0" && item.batchNo.trim() !== "") {
                      return (b.batchNumber || "").trim().toLowerCase() === item.batchNo.trim().toLowerCase();
                    }
                    return true;
                  });
                  const itemTotalStock = matchingBatches.reduce((acc, curr) => {
                    const col = item.stockCategory === "Display" ? curr.displayQty : item.stockCategory === "Damage" ? curr.damageQty : curr.availableQty;
                    return acc + Number(col || 0);
                  }, 0);

                  const prodCategory = products.find(p => p.name.trim().toLowerCase() === item.product.trim().toLowerCase())?.category || allProductBatches.find(b => b.productName.trim().toLowerCase() === item.product.trim().toLowerCase())?.category || "";

                  const batchOptionsSet = new Set<string>();
                  if (item.batchNo) batchOptionsSet.add(item.batchNo);
                  batchOptionsSet.add("0");
                  allProductBatches.forEach(b => { if (b.batchNumber) batchOptionsSet.add(b.batchNumber); });
                  const batchOptionsList = Array.from(batchOptionsSet);

                  return (
                    <div key={idx} className="p-3 border border-slate-200 rounded-lg bg-white shadow-sm space-y-3 relative">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700 border-b pb-1">
                        <div className="flex items-center gap-2">
                          <span>Item #{idx + 1}</span>
                          {prodCategory && (
                            <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                              Category: {prodCategory}
                            </span>
                          )}
                        </div>
                        {editForm.items.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleRemoveProductItem(idx)}
                            title="Remove product item"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* Product Search */}
                        <div className="space-y-1 relative sm:col-span-2">
                          <Label className="text-[11px] font-semibold text-slate-600">Product Name</Label>
                          <div className="relative">
                            <Input
                              className="h-8 text-xs pr-7"
                              value={item.product}
                              onChange={e => {
                                handleUpdateItemRow(idx, "product", e.target.value);
                                handleUpdateItemRow(idx, "batchNo", "0");
                                setActiveProductSearchIndex(idx);
                                setSelectedProductIndexForEdit(-1);
                              }}
                              onFocus={() => {
                                setActiveProductSearchIndex(idx);
                                setSelectedProductIndexForEdit(-1);
                              }}
                              onBlur={() => setTimeout(() => {
                                if (activeProductSearchIndex === idx) {
                                  setActiveProductSearchIndex(null);
                                  setSelectedProductIndexForEdit(-1);
                                }
                              }, 200)}
                              onKeyDown={e => {
                                if (activeProductSearchIndex !== idx || filteredProductsForEdit.length === 0) return;
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setSelectedProductIndexForEdit(prev => (prev < filteredProductsForEdit.length - 1 ? prev + 1 : 0));
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setSelectedProductIndexForEdit(prev => (prev > 0 ? prev - 1 : filteredProductsForEdit.length - 1));
                                } else if (e.key === 'Enter' || e.key === 'Tab') {
                                  e.preventDefault();
                                  const idxToPick = selectedProductIndexForEdit >= 0 ? selectedProductIndexForEdit : 0;
                                  const name = filteredProductsForEdit[idxToPick];
                                  if (name) {
                                    handleUpdateItemRow(idx, "product", name);
                                    handleUpdateItemRow(idx, "batchNo", "0");
                                    setActiveProductSearchIndex(null);
                                    setSelectedProductIndexForEdit(-1);
                                  }
                                } else if (e.key === 'Escape') {
                                  setActiveProductSearchIndex(null);
                                  setSelectedProductIndexForEdit(-1);
                                }
                              }}
                              placeholder="Search product..."
                              autoComplete="off"
                            />
                            <Package className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                          </div>

                          {activeProductSearchIndex === idx && filteredProductsForEdit.length > 0 && (
                            <div className="absolute z-[120] left-0 right-0 mt-1 bg-popover border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                              {filteredProductsForEdit.map((name, i) => {
                                const prodObj = products.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
                                const category = prodObj?.category || batches.find(b => b.productName.trim().toLowerCase() === name.toLowerCase())?.category || "";
                                return (
                                  <div
                                    key={name}
                                    className={`px-3 py-1.5 cursor-pointer text-xs flex items-center justify-between border-b border-slate-100 last:border-0 ${selectedProductIndexForEdit === i ? 'bg-blue-50 text-blue-900 font-semibold' : 'hover:bg-slate-100'}`}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleUpdateItemRow(idx, "product", name);
                                      handleUpdateItemRow(idx, "batchNo", "0");
                                      setActiveProductSearchIndex(null);
                                      setSelectedProductIndexForEdit(-1);
                                    }}
                                  >
                                    <span className="font-semibold text-slate-900">{name}</span>
                                    {category && (
                                      <span className="text-[10px] text-slate-500 px-1 py-0.5 bg-slate-100 rounded">{category}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Stock Category */}
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-600">Stock Category</Label>
                          <Select value={item.stockCategory} onValueChange={v => handleUpdateItemRow(idx, "stockCategory", v)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Available">Available</SelectItem>
                              <SelectItem value="Display">Display</SelectItem>
                              <SelectItem value="Damage">Damage</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* Batch */}
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-600">Batch</Label>
                          <Select value={item.batchNo} onValueChange={v => handleUpdateItemRow(idx, "batchNo", v)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select Batch" />
                            </SelectTrigger>
                            <SelectContent>
                              {batchOptionsList.map(bNo => {
                                const bv = bNo || "0";
                                const mb = allProductBatches.find(b => (b.batchNumber || "0") === bv);
                                const avail = mb ? (item.stockCategory === "Display" ? mb.displayQty : item.stockCategory === "Damage" ? mb.damageQty : mb.availableQty) : 0;
                                return (
                                  <SelectItem key={bv} value={bv}>
                                    {bv} {mb ? `(Stock: ${avail})` : "(Default)"}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Ordered Qty */}
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-600">Ordered Qty</Label>
                          <Input
                            type="number"
                            min={1}
                            className="h-8 text-xs font-semibold"
                            value={item.orderedQty}
                            onChange={e => handleUpdateItemRow(idx, "orderedQty", Number(e.target.value))}
                          />
                          {item.deliveredQty > 0 && (
                            <div className="text-[10px] text-slate-500">
                              Delivered: <span className="text-green-600 font-bold">{item.deliveredQty}</span> | Pending: <span className="text-red-600 font-bold">{Math.max(0, item.orderedQty - item.deliveredQty)}</span>
                            </div>
                          )}
                        </div>

                        {/* Stock Status Badge */}
                        <div className="space-y-1 flex flex-col justify-end">
                          {item.product && (
                            <div className="text-[11px] font-medium pb-1">
                              {itemTotalStock >= 0 ? (
                                <span className="text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200 inline-block text-[11px]">
                                  Stock Ready ({itemTotalStock} extra)
                                </span>
                              ) : (
                                <span className="text-red-700 bg-red-50 px-2 py-1 rounded border border-red-200 inline-block text-[11px]">
                                  Stock Shortage (Need {Math.abs(itemTotalStock)})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Remarks */}
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-600">Narration / Notes</Label>
                        <Input
                          className="h-8 text-xs"
                          value={item.remarks}
                          onChange={e => handleUpdateItemRow(idx, "remarks", e.target.value)}
                          placeholder="Narration / notes..."
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveGroupEdit} className="bg-blue-600 hover:bg-blue-700">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
