import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { addSale, addOrder, getBatches, getProducts, getSales, updateSale, deleteSale, exportCSV, generateWhatsAppLink, getClients, StockBatch, Sale, Client } from "@/lib/store";

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

const PRICE_CATEGORIES = ['0-10000', '10000-20000', '20000-50000', '50000-100000', 'Above 100000'];

interface SaleItem {
  productName: string;
  quantity: number;
  batchNo?: string;
  isProductSelected?: boolean;
}

const defaultItem: SaleItem = { productName: '', quantity: 0, isProductSelected: false };

export default function SalesPage() {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [priceCategory, setPriceCategory] = useState('0-10000');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<SaleItem[]>([{ ...defaultItem }]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(-1);
  const [sales, setSales] = useState<Sale[]>([]);
  const [allBatches, setAllBatches] = useState<StockBatch[]>([]);
  const [editingSale, setEditingSale] = useState<any>(null);
  const [productFilter, setProductFilter] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [selectedClientIndex, setSelectedClientIndex] = useState(-1);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const clientContainerRef = useRef<HTMLDivElement>(null);
  const suggestionContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

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

  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      const f = productFilter.toLowerCase();
      return s.clientName.toLowerCase().includes(f) || 
             s.productName.toLowerCase().includes(f) ||
             s.category.toLowerCase().includes(f);
    }).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
  }, [sales, productFilter]);

  const scrollToSelected = (containerRef: React.RefObject<HTMLDivElement>, index: number) => {
    if (index >= 0 && containerRef.current) {
      const activeElement = containerRef.current.children[index] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  useEffect(() => scrollToSelected(clientContainerRef, selectedClientIndex), [selectedClientIndex]);
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
        totalPrice: total,
        orderDate,
        valueCategory,
        batchNo: item.batchNo,
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
      });
    }

    toast({ title: "Sale recorded!", description: "Orders created automatically." });
    
    // Reset form
    setClientName('');
    setClientPhone('');
    setItems([{ ...defaultItem }]);
    refreshSales();
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
                    const filtered = uniqueClients.filter(c => !clientName || c.name.toLowerCase().includes(clientName.toLowerCase()));
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
                    {uniqueClients
                      .filter(c => !clientName || c.name.toLowerCase().includes(clientName.toLowerCase()))
                      .map((c, i) => (
                        <div 
                          key={c.name} 
                          className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedClientIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setClientName(c.name);
                            setClientPhone(c.phone);
                            if (c.priceCategory) setPriceCategory(c.priceCategory);
                            setShowClientSuggestions(false);
                          }}
                        >
                          <div className="font-medium">{c.name}</div>
                          {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                        </div>
                    ))}
                    {uniqueClients.filter(c => !clientName || c.name.toLowerCase().includes(clientName.toLowerCase())).length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground text-center">No matching clients</div>
                    )}
                  </div>
                )}
              </div>
              <div><Label>Client Phone</Label><Input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="919876543210" /></div>
              <div><Label>Price Category</Label>
                <Select value={priceCategory} onValueChange={setPriceCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRICE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Order Date</Label><Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} /></div>
            </div>

            <div className="space-y-4 pb-48">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold">Products</h3>
                <Button variant="outline" size="sm" onClick={addItem}><Plus className="mr-1 h-4 w-4" /> Add Product</Button>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-4 px-2 py-1 font-medium text-sm text-muted-foreground border-b">
                  <div className="col-span-8">Product *</div>
                  <div className="col-span-3">Quantity *</div>
                  <div className="col-span-1"></div>
                </div>
                {items.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-4 items-start relative overflow-visible px-2 py-2 border-b last:border-0">
                    <div className="col-span-8 relative">
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
                            setSelectedSuggestionIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSelectedSuggestionIndex(prev => (prev > 0 ? prev - 1 : prev));
                          } else if (e.key === 'Enter') {
                            if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < filtered.length) {
                              e.preventDefault();
                              const b = filtered[selectedSuggestionIndex];
                              updateItem(index, { 
                                productName: b.productName, 
                                batchNo: b.batchNumber,
                                isProductSelected: true
                              });
                              setActiveSuggestionIndex(null);
                              setSelectedSuggestionIndex(-1);
                            } else {
                              e.currentTarget.blur();
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
                          className="absolute left-0 right-0 top-full z-[100] mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto min-w-[250px]"
                        >
                          {(() => {
                            const filteredBatches = allBatches.filter(b => !item.productName || b.productName.toLowerCase().includes(item.productName.toLowerCase()) || (b.productCode && b.productCode.toLowerCase().includes(item.productName.toLowerCase())));
                            
                            return (
                              <>
                                {filteredBatches.map((b, i) => (
                                  <div 
                                    key={b.id + i} 
                                    className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedSuggestionIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      updateItem(index, { 
                                        productName: b.productName, 
                                        batchNo: b.batchNumber,
                                        isProductSelected: true
                                      });
                                      setActiveSuggestionIndex(null);
                                      setSelectedSuggestionIndex(-1);
                                    }}
                                  >
                                    <div className="font-medium">{b.productName}</div>
                                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                      <span>Batch: {b.batchNumber}</span>
                                      <span>Available: {b.availableQty}</span>
                                    </div>
                                  </div>
                                ))}
                                {filteredBatches.length === 0 && (
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
                              <span className="text-blue-700 font-bold">Stock Available: {batch.availableQty}</span>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="col-span-3">
                      <Input type="number" value={item.quantity || ''} onChange={e => updateItem(index, { quantity: +e.target.value })} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} placeholder="Qty" />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => removeItem(index)} disabled={items.length === 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button className="w-full mt-4" onClick={handleSubmit}><Plus className="mr-2 h-4 w-4" />Record Sale & Save</Button>
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
                placeholder="Filter by product or client..." 
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
                    <TableCell>{s.productName}</TableCell>
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
