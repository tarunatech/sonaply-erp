import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { addSale, addOrder, addClient, getBatches, getClients, getSales, addHold, updateSale, deleteSale, exportCSV, Sale, Client, StockBatch, generateWhatsAppLink } from "@/lib/store";
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
import { Download, Printer, MessageCircle, Plus, Trash2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";


const PRICE_CATEGORIES = ['Regular', 'Premium', 'Only Cash'];

interface SaleItem {
  productName: string;
  quantity: number;
  stockCategory: 'Available' | 'Display' | 'Damage';
  batchNo?: string;
  isProductSelected?: boolean;
}

const defaultItem: SaleItem = { productName: '', quantity: 0, stockCategory: 'Available', isProductSelected: false };

export default function SalesPage() {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [priceCategory, setPriceCategory] = useState('Regular');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState('');
  const [items, setItems] = useState<SaleItem[]>([{ ...defaultItem }]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(-1);
  const [sales, setSales] = useState<Sale[]>([]);
  const [allBatches, setAllBatches] = useState<StockBatch[]>([]);
  const [editingSale, setEditingSale] = useState<any>(null);
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
    refreshSales();
    refreshBatches();
    refreshClients();
  }, [refreshSales, refreshBatches, refreshClients]);

  const uniqueClients = useMemo(() => {
    return allClients.sort((a, b) => a.name.localeCompare(b.name));
  }, [allClients]);

  const filteredClients = useMemo(() => {
    const q = clientName.toLowerCase().trim();
    if (!q) return uniqueClients;
    return uniqueClients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.priceCategory || '').toLowerCase().includes(q)
    );
  }, [uniqueClients, clientName]);

  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      const f = productFilter.toLowerCase();
      const productBatch = allBatches.find(b => b.productName === s.productName);
      const productCategoryMatch = productBatch ? (productBatch.category || '').toLowerCase().includes(f) : false;
      return s.clientName.toLowerCase().includes(f) || 
             s.productName.toLowerCase().includes(f) ||
             (s.category || '').toLowerCase().includes(f) ||
             productCategoryMatch;
    }).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
  }, [sales, productFilter, allBatches]);

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

  const getSelectedBatch = (item: SaleItem) => {
    if (!item.productName) return undefined;
    return allBatches.find(b =>
      b.productName === item.productName &&
      (item.batchNo ? b.batchNumber === item.batchNo : true)
    );
  };

  const getSuggestionsList = useCallback((query: string) => {
    const q = query.toLowerCase().trim();
    const filtered = allBatches.filter(b =>
      !q ||
      b.productName.toLowerCase().includes(q) ||
      (b.productCode && b.productCode.toLowerCase().includes(q))
    );

    const list: { batch: StockBatch; category: 'Available' | 'Display' | 'Damage'; label: string }[] = [];
    filtered.forEach(b => {
      const hasAvailable = b.availableQty > 0;
      const hasDisplay = (b.displayQty || 0) > 0;
      const hasDamage = (b.damageQty || 0) > 0;

      if (hasAvailable || (!hasDisplay && !hasDamage)) {
        list.push({ batch: b, category: 'Available', label: 'Available' });
      }
      if (hasDisplay) {
        list.push({ batch: b, category: 'Display', label: 'Display' });
      }
      if (hasDamage) {
        list.push({ batch: b, category: 'Damage', label: 'Damage' });
      }
    });
    return list;
  }, [allBatches]);

  const handleDelete = async (id: string) => {
    const password = window.prompt("Please enter admin password to delete:");
    if (password !== 'admin') {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (window.confirm("Delete this sale record?")) {
      await deleteSale(id);
      refreshSales();
      toast({ title: "Sale record deleted" });
    }
  };

  const handleEditSave = async () => {
    if (!editingSale) return;
    await updateSale(editingSale.id, editingSale);
    refreshSales();
    setEditingSale(null);
    toast({ title: "Sale record updated" });
  };


  const handleSubmit = async () => {
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

    const total = 0; // Removed total amount field
    const valueCategory = 'Standard';

    const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;
    for (const item of validItems) {
      const sale = await addSale({
        clientName,
        clientPhone,
        productName: item.productName,
        category: priceCategory,
        quantity: item.quantity,
        damageQty: item.stockCategory === 'Damage' ? item.quantity : 0,
        totalPrice: total,
        orderDate,
        valueCategory,
        batchNo: item.batchNo,
        narration,
        stockCategory: item.stockCategory
      });

      await addOrder({
        orderNumber: orderNum,
        clientName,
        clientPhone,
        productName: item.productName,
        quantity: item.quantity,
        totalAmount: total,
        orderDate,
        status: 'Pending',
        batchNo: sale.batchNo || item.batchNo,
        pendingQty: sale.pendingQty,
        fulfilledQty: sale.fulfilledQty,
        narration,
        stockCategory: item.stockCategory
      });
    }

    toast({ title: "Sale recorded!", description: "Orders created automatically." });
    window.dispatchEvent(new CustomEvent("erp-stock-updated"));
    
    // Reset form
    setClientName('');
    setClientPhone('');
    setItems([{ ...defaultItem }]);
    setNarration('');
    setSelectedClientId(null);
    refreshSales();
    refreshClients();
  };

  const handleHold = async () => {
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
  };


  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sales Module</h1>
      <Tabs defaultValue="new">
        <TabsList><TabsTrigger value="new">New Sale</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
        <TabsContent value="new">
          <Card><CardContent className="space-y-6 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-4 border-b">
              <div className="relative">
                <Label>Client Name *</Label>
                <Input 
                  value={clientName} 
                  onChange={e => {
                    setClientName(e.target.value);
                    setShowClientSuggestions(true);
                    setSelectedClientId(null);
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
                      setSelectedClientIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedClientIndex(prev => (prev > 0 ? prev - 1 : prev));
                    } else if (e.key === 'Enter') {
                      if (selectedClientIndex >= 0 && selectedClientIndex < filtered.length) {
                        e.preventDefault();
                        const c = filtered[selectedClientIndex];
                        setClientName(c.name);
                        setClientPhone(c.phone);
                        if (c.priceCategory) setPriceCategory(c.priceCategory);
                        setSelectedClientId(c.id);
                        setShowClientSuggestions(false);
                        setSelectedClientIndex(-1);
                      }
                    } else if (e.key === 'Tab') {
                      if (showClientSuggestions && selectedClientIndex >= 0 && selectedClientIndex < filtered.length) {
                        const c = filtered[selectedClientIndex];
                        setClientName(c.name);
                        setClientPhone(c.phone);
                        if (c.priceCategory) setPriceCategory(c.priceCategory);
                        setSelectedClientId(c.id);
                        setShowClientSuggestions(false);
                        setSelectedClientIndex(-1);
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
              <div><Label>Client Phone</Label><Input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="919876543210" /></div>
              <div><Label>Price Category</Label>
                <Select value={PRICE_CATEGORIES.includes(priceCategory) ? priceCategory : 'custom'} onValueChange={v => {
                  if (v === 'custom') return;
                  setPriceCategory(v);
                }}>
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
                  onChange={e => setPriceCategory(e.target.value)}
                />
              </div>
              <div><Label>Order Date</Label><Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} /></div>
            </div>

            <div className="space-y-4 pb-48">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold">Products</h3>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-3 px-2 py-1 font-medium text-sm text-muted-foreground border-b">
                  <div className="col-span-4">Product *</div>
                  <div className="col-span-3">Quantity *</div>
                  <div className="col-span-3">Damaged *</div>
                  <div className="col-span-2"></div>
                </div>
                {items.map((item, index) => (
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
                          const filtered = allBatches.filter(b => !item.productName || b.productName.toLowerCase().includes(item.productName.toLowerCase()) || (b.productCode && b.productCode.toLowerCase().includes(item.productName.toLowerCase())));
                          
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const sugList = getSuggestionsList(item.productName);
                            setSelectedSuggestionIndex(prev => (prev < sugList.length - 1 ? prev + 1 : prev));
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSelectedSuggestionIndex(prev => (prev > 0 ? prev - 1 : prev));
                          } else if (e.key === 'Enter') {
                            const sugList = getSuggestionsList(item.productName);
                            if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < sugList.length) {
                              e.preventDefault();
                              const sug = sugList[selectedSuggestionIndex];
                              updateItem(index, { 
                                productName: sug.batch.productName, 
                                batchNo: sug.batch.batchNumber,
                                stockCategory: sug.category,
                                isProductSelected: true
                              });
                              setActiveSuggestionIndex(null);
                              setSelectedSuggestionIndex(-1);
                            } else {
                              e.currentTarget.blur();
                            }
                          } else if (e.key === 'Tab') {
                            const sugList = getSuggestionsList(item.productName);
                            if (activeSuggestionIndex === index && selectedSuggestionIndex >= 0 && selectedSuggestionIndex < sugList.length) {
                              const sug = sugList[selectedSuggestionIndex];
                              updateItem(index, { 
                                productName: sug.batch.productName, 
                                batchNo: sug.batch.batchNumber,
                                stockCategory: sug.category,
                                isProductSelected: true
                              });
                              setActiveSuggestionIndex(null);
                              setSelectedSuggestionIndex(-1);
                            }
                          } else if (e.key === 'Escape') {
                            setActiveSuggestionIndex(null);
                            setSelectedSuggestionIndex(-1);
                          }
                        }}
                        placeholder="Search product..."
                        autoComplete="off"
                        className="w-full"
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
                                      className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedSuggestionIndex === i ? 'bg-accent' : 'hover:bg-accent'} ${b.isCancelled ? 'bg-destructive/10 hover:bg-destructive/20' : ''} ${b.isNil ? 'bg-blue-500/10 hover:bg-blue-500/20' : ''}`}
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
                                      }}
                                    >
                                      <div className="font-semibold text-primary">{b.productName}</div>
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
                                      {b.description && (
                                        <div className="text-[11px] text-blue-600 italic mt-1 bg-blue-50/50 px-1.5 py-0.5 rounded border border-blue-100/50">
                                          {b.description}
                                        </div>
                                      )}
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
                        <div className="text-xs text-muted-foreground mt-1 ml-1 flex justify-end items-center bg-blue-50/50 p-1.5 rounded-sm border border-blue-100/50">
                          {(() => {
                            const batch = allBatches.find(b => 
                              b.productName === item.productName && 
                              (item.batchNo ? b.batchNumber === item.batchNo : true)
                            );
                            return batch ? (
                              <div className="flex flex-col items-end text-right w-full">
                                <span className="text-blue-700 font-bold text-[11px]">
                                  Stock Available: {batch.availableQty} | Display: {batch.displayQty || 0} | Damaged: {batch.damageQty}
                                </span>
                                <span className="text-[11px] text-muted-foreground mt-0.5">
                                  Category selected: <span className="font-bold text-primary">{item.stockCategory || 'Available'}</span>
                                </span>
                                {batch.description && (
                                  <span className="text-blue-600 italic text-[11px] mt-0.5">Note: {batch.description}</span>
                                )}
                              </div>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="col-span-3 min-w-0">
                      <Label className="text-xs text-muted-foreground mb-1 block">Total Qty to sell</Label>
                      <Input
                        type="number"
                        value={item.quantity || ''}
                        onChange={e => updateItem(index, { quantity: +e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                        placeholder="Enter total quantity"
                      />
                    </div>
                    <div className="col-span-3 min-w-0">
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Category selected
                      </Label>
                      <Input
                        value={item.stockCategory || 'Available'}
                        disabled
                        className="bg-muted text-foreground font-semibold"
                      />
                    </div>
                    <div className="col-span-2 flex justify-end gap-2 items-center pt-7">
                      {index === items.length - 1 && (
                        <Button variant="outline" size="sm" onClick={addItem} className="shrink-0 whitespace-nowrap">
                          <Plus className="mr-1 h-4 w-4" /> Add
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0" onClick={() => removeItem(index)} disabled={items.length === 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 border-t pt-4">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200">
                    <MessageCircle className="mr-2 h-4 w-4" /> Narration
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Narration / Notes</DialogTitle>
                  </DialogHeader>
                  <div className="py-4">
                    <Label>Notes</Label>
                    <Input 
                      placeholder="Enter narration here..." 
                      value={narration} 
                      onChange={(e) => setNarration(e.target.value)} 
                    />
                  </div>
                </DialogContent>
              </Dialog>
              <Button variant="outline" className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200" onClick={handleHold}>
                <Hand className="mr-2 h-4 w-4" /> Hold
              </Button>
              <Button onClick={handleSubmit}>
                <Plus className="mr-2 h-4 w-4" /> Record Sale & Save
              </Button>
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
                placeholder="Filter by client, product or category..." 
                value={productFilter} 
                onChange={e => setProductFilter(e.target.value)} 
                className="h-9"
              />
            </div>
          </div>

          <Card><CardContent className="p-0" id="sales-table"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Client</TableHead><TableHead>Phone</TableHead><TableHead>Product</TableHead><TableHead>Price Category</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredSales.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No sales records found</TableCell></TableRow>
                : filteredSales.map(s => (

                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.clientName}</TableCell>
                    <TableCell className="text-muted-foreground">{s.clientPhone || '-'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{s.productName}</span>
                        {s.stockCategory && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            s.stockCategory === 'Display' ? 'bg-amber-100 text-amber-800' :
                            s.stockCategory === 'Damage' ? 'bg-red-100 text-red-800' :
                            'bg-blue-100 text-blue-800'
                          }`}>
                            {s.stockCategory}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{s.category}</TableCell><TableCell className="text-right">{s.quantity}</TableCell>
                    <TableCell>{s.orderDate}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Dialog open={!!editingSale && editingSale.id === s.id} onOpenChange={(open) => !open && setEditingSale(null)}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => setEditingSale({...s})} title="Edit Sale">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Edit Sale Record</DialogTitle></DialogHeader>
                            <div className="grid gap-4 py-4">
                              <div className="grid gap-2">
                                <Label>Client Name</Label>
                                <Input value={editingSale?.clientName || ''} onChange={e => setEditingSale({...editingSale, clientName: e.target.value})} />
                              </div>
                              <div className="grid gap-2">
                                <Label>Client Phone</Label>
                                <Input value={editingSale?.clientPhone || ''} onChange={e => setEditingSale({...editingSale, clientPhone: e.target.value})} />
                              </div>
                              <div className="grid gap-2">
                                <Label>Product Name</Label>
                                <Input value={editingSale?.productName || ''} onChange={e => setEditingSale({...editingSale, productName: e.target.value})} />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                  <Label>Quantity</Label>
                                  <Input type="number" value={editingSale?.quantity || ''} onChange={e => setEditingSale({...editingSale, quantity: +e.target.value})} />
                                </div>
                                <div className="grid gap-2">
                                  <Label>Damaged Quantity</Label>
                                  <Input type="number" value={editingSale?.damageQty || 0} onChange={e => setEditingSale({...editingSale, damageQty: +e.target.value})} />
                                </div>
                                <div className="grid gap-2">
                                  <Label>Price Category</Label>
                                  <Select value={editingSale?.category || ''} onValueChange={v => setEditingSale({...editingSale, category: v})}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{PRICE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>
                            <DialogFooter><Button onClick={handleEditSave}>Save Changes</Button></DialogFooter>
                          </DialogContent>
                        </Dialog>

                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50" 
                          onClick={() => {
                            const msg = `Hello ${s.clientName}, regarding your order of ${s.productName} (Qty: ${s.quantity}) on ${s.orderDate}...`;
                            window.open(generateWhatsAppLink(s.clientPhone || '', msg), '_blank');
                          }}
                          title="Send WhatsApp"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(s.id)} title="Delete Sale">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
