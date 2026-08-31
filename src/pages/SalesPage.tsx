import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addSale, addSaleBulk, addClient, getBatches, getClients, getSales, addHold, updateSale, deleteSale, exportCSV, confirmSale, deliverSale, updateChallanGroup, Sale, Client, StockBatch, generateWhatsAppLink, getLocalDateString } from "@/lib/store";
import { Hand } from "lucide-react";

import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

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
import { Download, Printer, MessageCircle, Plus, Trash2, Pencil, CheckCircle2, Truck, Calendar as CalendarIcon, X, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

const PRICE_CATEGORIES = ['Regular', 'Premium', 'Only Cash'];

interface SaleItem {
  id?: string;
  salesId?: string;
  productName: string;
  quantity: number;
  stockCategory: 'Available' | 'Display' | 'Damage';
  batchNo?: string;
  isProductSelected?: boolean;
}

const defaultItem: SaleItem = { productName: '', quantity: 0, stockCategory: 'Available', isProductSelected: false };

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return new Date();
  return new Date(year, month - 1, day);
};

export default function SalesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('new');
  const [editingChallanNumber, setEditingChallanNumber] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [priceCategory, setPriceCategory] = useState('Regular');
  const [orderDate, setOrderDate] = useState(getLocalDateString());
  const [narration, setNarration] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const status = 'Pending';
  const [items, setItems] = useState<SaleItem[]>([{ ...defaultItem }]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(-1);
  const [sales, setSales] = useState<Sale[]>([]);
  const [allBatches, setAllBatches] = useState<StockBatch[]>([]);
  const [editingSale, setEditingSale] = useState<any>(null);
  const productInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const orderDateRef = useRef<HTMLButtonElement>(null);
  const clientInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (items.length > 1) {
      const lastIndex = items.length - 1;
      const lastInput = productInputsRef.current[lastIndex];
      if (lastInput && !lastInput.value) {
        lastInput.focus();
      }
    }
  }, [items.length]);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [productFilter, setProductFilter] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const suggestionContainerRef = useRef<HTMLDivElement>(null);
  const [selectedClientIndex, setSelectedClientIndex] = useState<number>(-1);
  const { toast } = useToast();
  const clientContainerRef = useRef<HTMLDivElement>(null);

  const scrollToSelected = (containerRef: React.RefObject<HTMLDivElement>, index: number) => {
    if (index >= 0 && containerRef.current) {
      const activeElement = containerRef.current.children[index] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  useEffect(() => scrollToSelected(clientContainerRef, selectedClientIndex), [selectedClientIndex]);

  const refreshSales = useCallback(() => getSales().then(setSales), []);
  const refreshBatches = useCallback(() => getBatches().then(setAllBatches), []);
  const refreshClients = useCallback(() => getClients().then(setAllClients), []);

  useEffect(() => {
    if (location.state?.editChallan) {
      const { editChallan } = location.state;
      setClientName(editChallan.customer || '');
      setClientPhone(editChallan.clientPhone || '');
      setPriceCategory(editChallan.category || 'Regular');
      setOrderDate(editChallan.orderDate || getLocalDateString());
      setNarration(editChallan.notes || '');
      if (editChallan.items && editChallan.items.length > 0) {
        setItems(
          editChallan.items.map((it: any) => ({
            id: it.id,
            salesId: it.salesId,
            productName: it.productName || it.product || '',
            quantity: Number(it.quantity || 0),
            stockCategory: it.stockCategory || 'Available',
            batchNo: it.batchNo || '',
            isProductSelected: true,
          }))
        );
      }
      setEditingChallanNumber(editChallan.challanNumber);
      setReturnTo(editChallan.returnTo || '/challans');
      setActiveTab('new');

      if (allClients.length > 0 && editChallan.customer) {
        const matching = allClients.find(
          (c) => c.name.toLowerCase().trim() === editChallan.customer.toLowerCase().trim()
        );
        if (matching) setSelectedClientId(matching.id);
      }

      window.history.replaceState({}, document.title);

      setTimeout(() => {
        if (clientInputRef.current) {
          clientInputRef.current.focus();
          clientInputRef.current.select();
        }
      }, 100);
    }
  }, [location.state, allClients]);

  useEffect(() => {
    if (clientName && !selectedClientId && allClients.length > 0) {
      const matching = allClients.find(
        (c) => c.name.toLowerCase().trim() === clientName.toLowerCase().trim()
      );
      if (matching) setSelectedClientId(matching.id);
    }
  }, [allClients, clientName, selectedClientId]);
 
  useEffect(() => {
    refreshSales();
    refreshBatches();
    refreshClients();

    const handleStockUpdate = () => {
      refreshSales();
      refreshBatches();
      refreshClients();
    };

    window.addEventListener("erp-stock-updated", handleStockUpdate);
    return () => window.removeEventListener("erp-stock-updated", handleStockUpdate);
  }, [refreshSales, refreshBatches, refreshClients]);

  const uniqueClients = useMemo(() => {
    return allClients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [allClients]);

  const filteredClients = useMemo(() => {
    const q = clientName.toLowerCase().trim();
    if (!q) return uniqueClients;
    return uniqueClients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.priceCategory || '').toLowerCase().includes(q)
    );
  }, [uniqueClients, clientName]);

  const productCategoryMap = useMemo(() => {
    const map = new Map<string, string>();
    allBatches.forEach(b => {
      if (b.productName && b.category) {
        map.set(b.productName.toLowerCase(), b.category);
      }
    });
    return map;
  }, [allBatches]);

  const batchesByProductMap = useMemo(() => {
    const map = new Map<string, StockBatch[]>();
    allBatches.forEach(b => {
      const key = (b.productName || '').trim();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(b);
    });
    return map;
  }, [allBatches]);

  const filteredSales = useMemo(() => {
    const f = productFilter.toLowerCase().trim();
    if (!f) {
      return [...sales].sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
    }
    return sales.filter(s => {
      const prodCat = productCategoryMap.get((s.product || '').toLowerCase()) || '';
      return (
        (s.customer || '').toLowerCase().includes(f) || 
        (s.product || '').toLowerCase().includes(f) ||
        (s.category || '').toLowerCase().includes(f) ||
        (s.orderNo || '').toLowerCase().includes(f) ||
        prodCat.toLowerCase().includes(f)
      );
    }).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
  }, [sales, productFilter, productCategoryMap]);

  const groupedSales = useMemo(() => {
    const groups: Record<string, Sale[]> = {};
    filteredSales.forEach(s => {
      if (!groups[s.orderNo]) groups[s.orderNo] = [];
      groups[s.orderNo].push(s);
    });
    return Object.entries(groups)
      .map(([orderNo, items]) => {
        return {
          orderNo,
          customer: items[0].customer,
          clientPhone: items[0].clientPhone,
          orderDate: items[0].orderDate,
          status: items[0].status,
          id: items[0].id,
          items,
        };
      })
      .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
  }, [filteredSales]);

  useEffect(() => scrollToSelected(suggestionContainerRef, selectedSuggestionIndex), [selectedSuggestionIndex]);
  
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

  const addItem = useCallback(() => setItems(prev => [...prev, { ...defaultItem }]), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        addItem();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addItem]);

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, updates: Partial<SaleItem>) => {
    setItems(prevItems => {
      const newItems = [...prevItems];
      newItems[index] = { ...newItems[index], ...updates };
      return newItems;
    });
  };

  const getSuggestionsList = useCallback((query: string) => {
    const q = query.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    let filtered = allBatches;
    if (tokens.length > 0) {
      filtered = allBatches.filter(b => {
        const fullText = `${b.productName || ''} ${b.productCode || ''} ${b.category || ''} ${b.batchNumber || ''}`.toLowerCase();
        return tokens.every(token => fullText.includes(token));
      });
    }

    const sorted = [...filtered].sort((a, b) => (b.availableQty || 0) - (a.availableQty || 0));

    const list: { batch: StockBatch; category: 'Available' | 'Display' | 'Damage'; label: string }[] = [];
    for (const b of sorted) {
      if ((b.availableQty || 0) > 0 || list.length < 10) {
        list.push({ batch: b, category: 'Available', label: 'Available' });
      }
      if ((b.displayQty || 0) > 0) {
        list.push({ batch: b, category: 'Display', label: 'Display' });
      }
      if ((b.damageQty || 0) > 0) {
        list.push({ batch: b, category: 'Damage', label: 'Damage' });
      }
      if (list.length >= 30) break;
    }
    return list;
  }, [allBatches]);

  const handleDelete = async (group: any) => {
    const password = window.prompt("Please enter admin password to delete entire order:");
    if (password !== 'admin') {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (window.confirm(`Delete order ${group.orderNo}? Associated items and challans will also be deleted.`)) {
      try {
        await Promise.all(group.items.map((item: any) => deleteSale(item.id)));
        refreshSales();
        toast({ title: "Order deleted successfully" });
      } catch (err: any) {
        toast({ title: "Failed to delete order", description: err.message, variant: "destructive" });
      }
    }
  };

  const handleEditSave = async () => {
    if (!editingSale) return;
    try {
      await Promise.all(editingSale.items.map((item: any) => {
        return updateSale(item.id, {
          customer: editingSale.customer,
          clientPhone: editingSale.clientPhone,
          orderedQty: item.orderedQty,
          status: editingSale.status,
          remarks: item.remarks,
        });
      }));
      refreshSales();
      window.dispatchEvent(new CustomEvent('erp-stock-updated'));
      setEditingSale(null);
      toast({ title: "Order updated successfully" });
    } catch (err: any) {
      toast({ title: "Update Failed", description: err.message || "Failed to update order", variant: "destructive" });
    }
  };

  const handleConfirmSale = async (group: any) => {
    if (!window.confirm(`Mark order ${group.orderNo} as Confirmed?`)) return;
    try {
      await Promise.all(group.items.map((item: any) => confirmSale(item.id)));
      refreshSales();
      window.dispatchEvent(new CustomEvent('erp-stock-updated'));
      toast({ title: 'Order Confirmed', description: 'All items and associated challans confirmed.' });
    } catch (err: any) {
      toast({ title: 'Failed to confirm order', description: err.message, variant: 'destructive' });
    }
  };

  const handleDeliverSale = async (group: any) => {
    if (!window.confirm(`Deliver order ${group.orderNo}?`)) return;
    try {
      await Promise.all(group.items.map((item: any) => deliverSale(item.id)));
      refreshSales();
      window.dispatchEvent(new CustomEvent('erp-stock-updated'));
      toast({ title: 'Order Delivered', description: 'Order moved to Delivered Orders.' });
    } catch (err: any) {
      toast({ title: 'Delivery Failed', description: err.message, variant: 'destructive' });
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!clientName) {
      toast({ title: "Please enter client name", variant: "destructive" }); return;
    }

    const selectedClient = selectedClientId
      ? uniqueClients.find(c => c.id === selectedClientId)
      : filteredClients.find(c => c.name === clientName);
    if (!selectedClient) {
      toast({ title: "Please select an existing client from the suggestions", variant: "destructive" }); return;
    }

    const validItems = items.filter(item => item.productName && item.quantity > 0);
    if (validItems.length === 0) {
      toast({ title: "Please add at least one valid product", variant: "destructive" }); return;
    }

    const itemsWithoutBatch = validItems.filter(item => !item.batchNo);
    if (itemsWithoutBatch.length > 0) {
      toast({ title: "Please select a batch for all products", variant: "destructive" }); return;
    }

    const valueCategory = 'Standard';

    setIsSubmitting(true);
    try {
      await addSaleBulk({
        customer: clientName,
        clientPhone,
        orderDate,
        status,
        remarks: narration,
        category: priceCategory,
        items: validItems.map(item => ({
          productName: item.productName,
          quantity: item.quantity,
          batchNo: item.batchNo,
          stockCategory: item.stockCategory,
          damageQty: item.stockCategory === 'Damage' ? item.quantity : 0,
        }))
      });

      toast({ title: "Sale recorded!", description: "Stock deducted and/or pending order created." });
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      
      // Reset form
      setClientName('');
      setClientPhone('');
      setItems([{ ...defaultItem }]);
      setNarration('');
      setSelectedClientId(null);
      refreshSales();
      refreshClients();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to record sale", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHold = async () => {
    if (isSubmitting) return;
    if (!clientName) {
      toast({ title: "Please enter client name", variant: "destructive" }); return;
    }

    const selectedClient = selectedClientId
      ? uniqueClients.find(c => c.id === selectedClientId)
      : filteredClients.find(c => c.name === clientName);
    if (!selectedClient) {
      toast({ title: "Please select an existing client from the suggestions", variant: "destructive" }); return;
    }

    const validItems = items.filter(item => item.productName && item.quantity > 0);
    if (validItems.length === 0) {
      toast({ title: "Please add at least one valid product", variant: "destructive" }); return;
    }

    const itemsWithoutBatch = validItems.filter(item => !item.batchNo);
    if (itemsWithoutBatch.length > 0) {
      toast({ title: "Please select a batch for all products", variant: "destructive" }); return;
    }

    setIsSubmitting(true);
    try {
      for (const item of validItems) {
        await addHold({
          clientName,
          clientPhone,
          productName: item.productName,
          category: priceCategory,
          quantity: item.quantity,
          batchNo: item.batchNo || '',
          holdDate: orderDate
        });
      }

      toast({ title: "Products put on hold!" });
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      
      // Reset form
      setClientName('');
      setClientPhone('');
      setItems([{ ...defaultItem }]);
      setSelectedClientId(null);
      refreshSales(); // To refresh batches
      refreshClients();
    } catch (err: any) {
      toast({ title: "Hold Failed", description: err.message || "Failed to put on hold", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveChallanEdit = async () => {
    if (isSubmitting) return;
    if (!clientName) {
      toast({ title: "Please enter client name", variant: "destructive" });
      return;
    }

    const selectedClient = selectedClientId
      ? uniqueClients.find((c) => c.id === selectedClientId)
      : filteredClients.find(
          (c) => c.name.toLowerCase().trim() === clientName.toLowerCase().trim()
        );
    if (!selectedClient) {
      toast({
        title: "Please select an existing client from the suggestions",
        variant: "destructive",
      });
      return;
    }

    const validItems = items.filter(
      (item) => item.productName && item.quantity > 0
    );
    if (validItems.length === 0) {
      toast({
        title: "Please add at least one valid product with quantity > 0",
        variant: "destructive",
      });
      return;
    }

    const itemsWithoutBatch = validItems.filter((item) => !item.batchNo);
    if (itemsWithoutBatch.length > 0) {
      toast({
        title: "Please select a batch for all products",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await updateChallanGroup(editingChallanNumber!, {
        challanNumber: editingChallanNumber!,
        clientName,
        clientPhone,
        date: orderDate,
        items: validItems.map((item) => ({
          id: item.id,
          salesId: item.salesId,
          productName: item.productName,
          quantity: item.quantity,
          batchNo: item.batchNo,
          notes: narration,
          stockCategory: item.stockCategory || "Available",
        })),
      });

      toast({
        title: "Order & Challan updated!",
        description: `Changes saved for ${editingChallanNumber}.`,
      });
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));

      // Reset form
      setClientName("");
      setClientPhone("");
      setItems([{ ...defaultItem }]);
      setNarration("");
      setSelectedClientId(null);
      setEditingChallanNumber(null);

      const dest = returnTo || "/challans";
      setReturnTo(null);
      navigate(dest);
    } catch (err: any) {
      toast({
        title: "Update Failed",
        description: err.message || "Failed to update order",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEdit = () => {
    setClientName("");
    setClientPhone("");
    setItems([{ ...defaultItem }]);
    setNarration("");
    setSelectedClientId(null);
    setEditingChallanNumber(null);
    const dest = returnTo || "/challans";
    setReturnTo(null);
    navigate(dest);
  };

  const handleEditFromHistory = (group: any) => {
    setClientName(group.customer || "");
    setClientPhone(group.clientPhone || "");
    setOrderDate(group.orderDate || getLocalDateString());
    const firstItem = group.items[0];
    setPriceCategory(firstItem?.category || "Regular");
    setNarration(group.items.find((i: any) => i.remarks)?.remarks || "");
    setItems(
      group.items.map((i: any) => ({
        id: i.id,
        salesId: i.id,
        productName: i.product,
        quantity: i.orderedQty,
        batchNo: i.batchNo,
        stockCategory: i.stockCategory || "Available",
        isProductSelected: true,
      }))
    );
    setEditingChallanNumber(group.orderNo);
    setReturnTo("/sales");
    setActiveTab("new");
    setTimeout(() => {
      if (clientInputRef.current) {
        clientInputRef.current.focus();
        clientInputRef.current.select();
      }
    }, 100);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sales Module</h1>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList><TabsTrigger value="new">New Sale</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
        <TabsContent value="new">
          <Card><CardContent className="space-y-6 pt-6">
            {editingChallanNumber && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3.5 flex items-center justify-between shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold shrink-0">
                    <Pencil className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-bold text-blue-950 text-sm flex items-center gap-2">
                      <span>Editing Order / Challan:</span>
                      <span className="font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs">
                        {editingChallanNumber}
                      </span>
                    </div>
                    <div className="text-xs text-blue-700 mt-0.5">
                      Client: <span className="font-medium">{clientName || "N/A"}</span>
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs text-blue-700 border-blue-300 hover:bg-blue-100 h-8 gap-1.5"
                  onClick={handleCancelEdit}
                >
                  <X className="h-3.5 w-3.5" /> Cancel Edit
                </Button>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-4 border-b">
              <div className="relative">
                <Label>Client Name *</Label>
                <Input 
                  ref={clientInputRef}
                  value={clientName} 
                  onChange={e => {
                    const value = e.target.value;
                    setClientName(value);
                    setShowClientSuggestions(true);
                    setSelectedClientId(null);
                    if (!value) {
                      setClientPhone('');
                      setPriceCategory('Regular');
                    }
                  }} 
                  onFocus={() => {
                    setShowClientSuggestions(true);
                    setSelectedClientIndex(-1);
                  }}
                  onBlur={() => setTimeout(() => {
                    setShowClientSuggestions(false);
                    setSelectedClientIndex(-1);
                  }, 200)}
                  onKeyDown={e => {
                    const filtered = filteredClients;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedClientIndex(prev => (prev < filtered.length - 1 ? prev + 1 : 0));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedClientIndex(prev => (prev > 0 ? prev - 1 : filtered.length - 1));
                    } else if (e.key === 'Enter' || e.key === 'Tab') {
                      if (showClientSuggestions && filtered.length > 0) {
                        e.preventDefault();
                        const pickIdx = selectedClientIndex >= 0 && selectedClientIndex < filtered.length ? selectedClientIndex : 0;
                        const c = filtered[pickIdx];
                        if (c) {
                          setClientName(c.name);
                          setClientPhone(c.phone);
                          if (c.priceCategory) setPriceCategory(c.priceCategory);
                          setSelectedClientId(c.id);
                          setShowClientSuggestions(false);
                          setSelectedClientIndex(-1);
                          setTimeout(() => {
                            orderDateRef.current?.focus();
                          }, 50);
                        }
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        setShowClientSuggestions(false);
                        setSelectedClientIndex(-1);
                        setTimeout(() => {
                          orderDateRef.current?.focus();
                        }, 50);
                      }
                    } else if (e.key === 'Escape') {
                      setShowClientSuggestions(false);
                      setSelectedClientIndex(-1);
                    }
                  }}
                  placeholder="Client Name" 
                  autoComplete="off"
                />
                {showClientSuggestions && (
                  <div ref={clientContainerRef} className="absolute z-[110] w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {filteredClients
                      .map((c, i) => (
                        <div 
                           key={c.id} 
                          className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedClientIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setClientName(c.name);
                            setClientPhone(c.phone);
                            if (c.priceCategory) setPriceCategory(c.priceCategory);
                            setSelectedClientId(c.id);
                            setShowClientSuggestions(false);
                            setTimeout(() => {
                              orderDateRef.current?.focus();
                            }, 50);
                          }}
                        >
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                            <span>{c.phone || 'No phone'}</span>
                            <span>{c.priceCategory || 'No price category'}</span>
                          </div>
                        </div>
                      ))}
                    {filteredClients.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground text-center">No matching clients</div>
                    )}
                  </div>
                )}
              </div>
              <div><Label>Client Phone</Label><Input value={clientPhone} placeholder="919876543210" disabled /></div>
              <div><Label>Price Category</Label>
                <Select value={PRICE_CATEGORIES.includes(priceCategory) ? priceCategory : 'custom'} disabled>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRICE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    <SelectItem value="custom">Custom value</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  className="mt-2"
                  placeholder="Or type a custom price category"
                  value={PRICE_CATEGORIES.includes(priceCategory) ? '' : priceCategory}
                  disabled
                />
              </div>
              <div>
                <Label>Order Date</Label>
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      ref={orderDateRef}
                      variant="outline"
                      className={`w-full justify-start text-left font-normal h-9 text-xs bg-background border-input ${!orderDate ? 'text-slate-400' : 'text-slate-900 font-medium'}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          productInputsRef.current[0]?.focus();
                        }
                      }}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 text-slate-500 shrink-0" />
                      {orderDate ? format(parseLocalDate(orderDate), "dd-MM-yyyy") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={orderDate ? parseLocalDate(orderDate) : undefined}
                      onSelect={(date) => {
                        if (date) {
                          setOrderDate(getLocalDateString(date));
                          setIsCalendarOpen(false);
                          setTimeout(() => {
                            productInputsRef.current[0]?.focus();
                          }, 50);
                        }
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-4 pb-48">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold">Products</h3>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-3 px-2 py-1 font-medium text-sm text-muted-foreground border-b">
                  <div className="col-span-4">Product *</div>
                  <div className="col-span-2">Batch No</div>
                  <div className="col-span-2">Quantity *</div>
                  <div className="col-span-3">Category</div>
                  <div className="col-span-1"></div>
                </div>
                {items.map((item, index) => {
                  const productBatches = batchesByProductMap.get(item.productName) || [];

                  return (
                    <div key={index} className="grid grid-cols-12 gap-3 items-start relative overflow-visible px-2 py-2 border-b last:border-0">
                      <div className="col-span-4 relative min-w-0">
                        <Input
                          value={item.productName}
                          onChange={e => {
                            updateItem(index, { productName: e.target.value, batchNo: '', isProductSelected: false });
                            setActiveSuggestionIndex(index);
                          }}
                          onFocus={() => {
                            setActiveSuggestionIndex(index);
                            setSelectedSuggestionIndex(-1);
                          }}
                          onBlur={() => setTimeout(() => {
                            setActiveSuggestionIndex(null);
                            setSelectedSuggestionIndex(-1);
                          }, 200)}
                          onKeyDown={e => {
                            const sugList = getSuggestionsList(item.productName);
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              setSelectedSuggestionIndex(prev => (prev < sugList.length - 1 ? prev + 1 : 0));
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              setSelectedSuggestionIndex(prev => (prev > 0 ? prev - 1 : sugList.length - 1));
                            } else if (e.key === 'Enter' || e.key === 'Tab') {
                              if (activeSuggestionIndex === index && sugList.length > 0) {
                                e.preventDefault();
                                const pickIdx = selectedSuggestionIndex >= 0 && selectedSuggestionIndex < sugList.length ? selectedSuggestionIndex : 0;
                                const sug = sugList[pickIdx];
                                updateItem(index, { 
                                  productName: sug.batch.productName, 
                                  batchNo: sug.batch.batchNumber,
                                  stockCategory: sug.category,
                                  isProductSelected: true
                                });
                                setActiveSuggestionIndex(null);
                                setSelectedSuggestionIndex(-1);
                                setTimeout(() => {
                                  const qtyInput = document.getElementById(`quantity-input-${index}`);
                                  if (qtyInput) {
                                    qtyInput.focus();
                                  }
                                }, 50);
                              }
                            } else if (e.key === 'Escape') {
                              setActiveSuggestionIndex(null);
                              setSelectedSuggestionIndex(-1);
                            }
                          }}
                          ref={el => { productInputsRef.current[index] = el; }}
                          placeholder="Search product..."
                          autoComplete="off"
                          className="w-full text-xs h-9"
                        />
                        {activeSuggestionIndex === index && (
                          <div 
                            ref={suggestionContainerRef}
                            className="absolute left-0 right-0 top-full z-[100] mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto min-w-[220px]"
                          >
                            {(() => {
                              const sugList = getSuggestionsList(item.productName);
                              return (
                                <>
                                  {sugList.map((sug, i) => {
                                    const { batch: b, category, label } = sug;
                                    return (
                                      <div 
                                        key={`${b.id}-${category}-${i}`} 
                                        className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedSuggestionIndex === i ? 'bg-accent' : 'hover:bg-accent'} ${b.isCancelled ? 'bg-destructive/10 hover:bg-destructive/20' : ''}`}
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          updateItem(index, { 
                                            productName: b.productName, 
                                            batchNo: b.batchNumber,
                                            stockCategory: category,
                                            isProductSelected: true
                                          });
                                          setActiveSuggestionIndex(null);
                                          setSelectedSuggestionIndex(-1);
                                          setTimeout(() => {
                                            const qtyInput = document.getElementById(`quantity-input-${index}`);
                                            if (qtyInput) {
                                              qtyInput.focus();
                                            }
                                          }, 50);
                                        }}
                                      >
                                        <div className="flex items-center justify-between gap-1">
                                          <div className="font-semibold text-primary">{b.productName}</div>
                                          {b.category && (
                                            <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 shrink-0">
                                              {b.category}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                                          Batch: {b.batchNumber} | <span className="text-blue-600 font-bold bg-blue-50 px-1 rounded">{label}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-1 bg-muted/30 p-1 rounded">
                                          {category === 'Available' && (
                                            <span>Avail: <span className="font-semibold text-foreground">{b.availableQty}</span></span>
                                          )}
                                          {category === 'Display' && (
                                            <span>Disp: <span className="font-semibold text-foreground">{b.displayQty || 0}</span></span>
                                          )}
                                          {category === 'Damage' && (
                                            <span>Dmg: <span className="font-semibold text-foreground">{b.damageQty || 0}</span></span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {sugList.length === 0 && (
                                    <div className="px-3 py-2 text-sm text-muted-foreground text-center">No matches</div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}
                        {item.isProductSelected && item.productName && (
                          <div className="text-[10px] text-muted-foreground mt-1 ml-1 flex flex-col gap-1 bg-blue-50/50 p-1.5 rounded-sm border border-blue-100/50">
                            {(() => {
                              const batch = item.batchNo ? productBatches.find(b => b.batchNumber === item.batchNo) : productBatches[0];
                              const productCat = batch?.category || (item.productName ? productCategoryMap.get(item.productName.toLowerCase()) : undefined);
                              return (
                                <>
                                  <div className="flex items-center justify-between w-full font-semibold gap-2">
                                    {productCat ? (
                                      <span className="text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 shrink-0">
                                        Cat: {productCat}
                                      </span>
                                    ) : <span />}
                                    {batch ? (
                                      <span className="text-blue-700 text-right">
                                        Avail: {batch.availableQty} | Disp: {batch.displayQty || 0} | Dmg: {batch.damageQty}
                                      </span>
                                    ) : null}
                                  </div>
                                  {batch?.description && (
                                    <div className="text-[11px] text-slate-700 font-medium italic bg-white px-2 py-0.5 rounded border border-slate-200 text-left">
                                      Desc: {batch.description}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                      <div className="col-span-2 min-w-0">
                        <Select
                          value={item.batchNo || ""}
                          onValueChange={v => {
                            updateItem(index, { batchNo: v });
                          }}
                          disabled
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Batch" />
                          </SelectTrigger>
                          <SelectContent>
                            {productBatches.map(b => {
                              const batchVal = b.batchNumber || "0";
                              return (
                                <SelectItem key={b.id} value={batchVal}>
                                  {batchVal} (Avail: {b.availableQty})
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2 min-w-0">
                        <Input
                          id={`quantity-input-${index}`}
                          type="number"
                          value={item.quantity || ''}
                          onChange={e => updateItem(index, { quantity: +e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (index === items.length - 1) {
                                addItem();
                              } else {
                                const nextInput = productInputsRef.current[index + 1];
                                if (nextInput) {
                                  nextInput.focus();
                                }
                              }
                            }
                          }}
                          placeholder="Qty"
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="col-span-3 min-w-0">
                        <Select
                          value={item.stockCategory || 'Available'}
                          onValueChange={v => {
                            updateItem(index, { stockCategory: v as any });
                          }}
                        >
                          <SelectTrigger className="h-9 text-xs font-semibold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Available">Available</SelectItem>
                            <SelectItem value="Display">Display</SelectItem>
                            <SelectItem value="Damage">Damage</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-1 flex justify-end gap-1 items-center">
                        {index === items.length - 1 && (
                          <Button variant="outline" size="sm" onClick={addItem} className="h-9 px-2 shrink-0">
                            <Plus className="h-3 w-3" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0 h-9 w-9" onClick={() => removeItem(index)} disabled={items.length === 1}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-4 mt-6 border-t pt-4">
              <div className="w-full sm:max-w-md space-y-1.5">
                <Label htmlFor="sales-narration" className="text-xs font-semibold text-slate-700">Narration / Notes</Label>
                <div className="flex items-center gap-2">
                  <Input 
                    id="sales-narration"
                    placeholder="Enter narration / notes..." 
                    value={narration} 
                    onChange={(e) => setNarration(e.target.value)} 
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (narration.trim()) {
                          toast({ title: "Narration saved", description: "Narration attached to this order." });
                        }
                      }
                    }}
                    className="h-10"
                  />
                  <Button 
                    type="button"
                    variant="outline"
                    className="h-10 px-4 shrink-0 text-blue-600 border-blue-200 hover:bg-blue-50 font-semibold"
                    onClick={() => {
                      if (narration.trim()) {
                        toast({ title: "Narration saved", description: "Narration attached to this order." });
                      } else {
                        toast({ title: "Please enter narration first", variant: "destructive" });
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
              {editingChallanNumber ? (
                <div className="flex justify-end gap-3 shrink-0">
                  <Button type="button" variant="outline" onClick={handleCancelEdit} disabled={isSubmitting}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleSaveChallanEdit} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving Changes...
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 h-4 w-4" /> Save Changes & Return
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end gap-3 shrink-0">
                  <Button type="button" variant="outline" className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200" onClick={handleHold} disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Putting on Hold...
                      </>
                    ) : (
                      <>
                        <Hand className="mr-2 h-4 w-4" /> Hold
                      </>
                    )}
                  </Button>
                  <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" /> Record Sale & Save
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="history">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => exportCSV(filteredSales as any, `sales-${new Date().toISOString().slice(0,10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
              <Button variant="outline" size="sm" onClick={() => printElement('sales-table')}><Printer className="mr-1 h-4 w-4" />Print</Button>
            </div>
            <div className="w-full sm:w-72">
              <Input 
                placeholder="Filter by customer, product or category..." 
                value={productFilter} 
                onChange={e => setProductFilter(e.target.value)} 
                className="h-9"
              />
            </div>
          </div>

          <Card><CardContent className="p-0" id="sales-table">
            <Table className="border-collapse border-2 border-slate-300 w-full" wrapperClassName="max-h-[calc(100vh-250px)]">
              <TableHeader className="sticky top-0 bg-slate-100 z-10 shadow-2xs border-b-2 border-slate-300">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Date</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Order #</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Customer</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Product</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Ordered</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-green-600 px-4 py-3 text-right">Delivered</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-red-600 px-4 py-3 text-right">Pending</TableHead>
                  <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="border-2 border-slate-300 text-center text-muted-foreground py-8">No sales records found</TableCell>
                  </TableRow>
                ) : groupedSales.map(group => (
                  <TableRow key={group.orderNo} className="hover:bg-slate-50/40">
                    <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700 font-medium whitespace-nowrap">
                      {group.orderDate ? format(new Date(group.orderDate), "dd-MM-yyyy") : ""}
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 font-mono text-xs font-bold text-slate-900">{group.orderNo}</TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm min-w-[150px] max-w-[220px] break-words">
                      {renderCustomer(group.customer)}
                      <div className="text-[10px] text-muted-foreground mt-1">{group.clientPhone || '-'}</div>
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3">
                      <div className="space-y-1">
                        {group.items.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 flex-wrap border-b border-slate-100 last:border-0 pb-1 h-7">
                            <span className="font-semibold text-slate-900">{item.product}</span>
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
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 text-right">
                      <div className="space-y-1">
                        {group.items.map((item, idx) => (
                          <div key={idx} className="border-b border-slate-100 last:border-0 pb-1 h-7 flex justify-end items-center font-semibold text-slate-700">
                            {item.orderedQty}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 text-right font-semibold text-green-600">
                      <div className="space-y-1">
                        {group.items.map((item, idx) => (
                          <div key={idx} className="border-b border-slate-100 last:border-0 pb-1 h-7 flex justify-end items-center font-semibold">
                            {item.deliveredQty}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 text-right font-semibold text-red-600">
                      <div className="space-y-1">
                        {group.items.map((item, idx) => (
                          <div key={idx} className="border-b border-slate-100 last:border-0 pb-1 h-7 flex justify-end items-center font-semibold">
                            {item.pendingQty}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle text-right">
                      <div className="flex flex-col gap-2">
                        {/* Status Badge & Actions row */}
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            group.status === 'Delivered' ? 'bg-green-100 text-green-800' :
                            group.status === 'Confirmed' ? 'bg-blue-100 text-blue-800' :
                            group.status === 'Partial'   ? 'bg-amber-100 text-amber-800' :
                            group.status === 'Cancelled' ? 'bg-red-100 text-red-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {group.status}
                          </span>

                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-blue-600 hover:bg-blue-50" 
                            onClick={() => handleEditFromHistory(group)} 
                            title="Edit Order in Sales Form"
                            disabled={group.status === 'Delivered'}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>

                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50" 
                            onClick={() => {
                              const productsList = group.items.map((i: any) => `${i.product} (Qty: ${i.orderedQty})`).join(", ");
                              const msg = `Hello ${group.customer}, regarding your order ${group.orderNo} of: ${productsList} on ${group.orderDate}...`;
                              window.open(generateWhatsAppLink(group.clientPhone || '', msg), '_blank');
                            }}
                            title="Send WhatsApp"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-red-50" onClick={() => handleDelete(group)} title="Delete Sale Order">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* Transition Buttons (Confirm / Deliver) */}
                        {group.status === 'Pending' && (
                          <div className="flex gap-1 justify-end mt-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px] text-blue-600 border-blue-200 hover:bg-blue-50"
                              onClick={() => handleConfirmSale(group)}
                              title="Mark order as Confirmed"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px] text-green-600 border-green-200 hover:bg-green-50"
                              onClick={() => handleDeliverSale(group)}
                              title="Mark order as Delivered"
                            >
                              <Truck className="h-3.5 w-3.5 mr-1" />Deliver
                            </Button>
                          </div>
                        )}
                        {group.status === 'Confirmed' && (
                          <div className="flex justify-end mt-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px] text-green-600 border-green-200 hover:bg-green-50 w-fit"
                              onClick={() => handleDeliverSale(group)}
                              title="Mark order as Delivered"
                            >
                              <Truck className="h-3.5 w-3.5 mr-1" />Deliver
                            </Button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
