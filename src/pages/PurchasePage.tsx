import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { addPurchase, addBatch, getPurchases, updatePurchase, deletePurchase, exportCSV, Purchase } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Download, Printer, Plus, Trash2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

interface PurchaseItem {
  productName: string;
  category: string;
  quantity: number;
  batchNumber: string;
}

const PURCHASE_CATEGORIES = ["FINBOLE", "REAL PLUS", "KALAA", "FINE TOUCH LIGHT"];
const defaultItem: PurchaseItem = { productName: '', category: '', quantity: 0, batchNumber: '' };

export default function PurchasePage() {
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<PurchaseItem[]>([{ ...defaultItem }]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [editingPurchase, setEditingPurchase] = useState<any>(null);
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);
  const [selectedSupplierIndex, setSelectedSupplierIndex] = useState(-1);
  const supplierContainerRef = useRef<HTMLDivElement>(null);
  const [purchaseFilter, setPurchaseFilter] = useState('');
  const [activeCategoryIndex, setActiveCategoryIndex] = useState<number | null>(null);
  const [activeProductIndex, setActiveProductIndex] = useState<number | null>(null);
  const [selectedCategorySuggestionIndex, setSelectedCategorySuggestionIndex] = useState<number>(-1);
  const [selectedProductSuggestionIndex, setSelectedProductSuggestionIndex] = useState<number>(-1);
  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const productContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const refresh = useCallback(() => getPurchases().then(setPurchases), []);
  useEffect(() => { refresh(); }, [refresh]);

  const uniqueSuppliers = useMemo(() => {
    return Array.from(new Set(purchases.map(p => p.supplierName).filter(Boolean))).sort();
  }, [purchases]);

  const uniqueProducts = useMemo(() => {
    return Array.from(new Set(purchases.map(p => p.productName).filter(Boolean))).sort();
  }, [purchases]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      const f = purchaseFilter.toLowerCase();
      return p.supplierName.toLowerCase().includes(f) ||
             p.productName.toLowerCase().includes(f) ||
             p.category.toLowerCase().includes(f);
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [purchases, purchaseFilter]);

  useEffect(() => {
    if (selectedSupplierIndex >= 0 && supplierContainerRef.current) {
      const activeElement = supplierContainerRef.current.children[selectedSupplierIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedSupplierIndex]);

  useEffect(() => {
    if (selectedCategorySuggestionIndex >= 0 && categoryContainerRef.current) {
      const activeElement = categoryContainerRef.current.children[selectedCategorySuggestionIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedCategorySuggestionIndex]);

  useEffect(() => {
    if (selectedProductSuggestionIndex >= 0 && productContainerRef.current) {
      const activeElement = productContainerRef.current.children[selectedProductSuggestionIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedProductSuggestionIndex]);

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

  const updateItem = (index: number, key: keyof PurchaseItem, value: string | number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [key]: value };
    setItems(newItems);
  };

  const handleDelete = async (id: string) => {
    const password = window.prompt("Please enter admin password to delete:");
    if (password !== 'admin') {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (window.confirm("Delete this purchase record?")) {
      await deletePurchase(id);
      refresh();
      toast({ title: "Purchase record deleted" });
    }
  };

  const handleEditSave = async () => {
    if (!editingPurchase) return;
    await updatePurchase(editingPurchase.id, editingPurchase);
    refresh();
    setEditingPurchase(null);
    toast({ title: "Purchase record updated" });
  };

  const handleSubmit = async () => {
    if (!supplierName) {
      toast({ title: "Please enter supplier name", variant: "destructive" }); return;
    }
    
    const validItems = items.filter(item => item.productName && item.quantity > 0);
    if (validItems.length === 0) {
      toast({ title: "Please add at least one valid product", variant: "destructive" }); return;
    }

    for (const item of validItems) {
      await addPurchase({ 
        supplierName, 
        supplierPhone: '', 
        productName: item.productName, 
        category: item.category, 
        quantity: item.quantity, 
        rate: 0, 
        totalAmount: 0, 
        batchNumber: item.batchNumber, 
        date 
      });
    }

    toast({ title: "Purchase recorded & stock updated!" });
    setSupplierName('');
    setItems([{ ...defaultItem }]);
    refresh();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Purchase Module</h1>
      <Tabs defaultValue="new">
        <TabsList><TabsTrigger value="new">New Purchase</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
        <TabsContent value="new">
          <Card><CardContent className="space-y-6 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-4 border-b">
              <div className="relative">
                <Label>Supplier Name *</Label>
                <Input 
                  value={supplierName} 
                  onChange={e => {
                    setSupplierName(e.target.value);
                    setShowSupplierSuggestions(true);
                  }} 
                  onFocus={() => {
                    setShowSupplierSuggestions(true);
                    setSelectedSupplierIndex(-1);
                  }}
                  onBlur={() => setTimeout(() => {
                    setShowSupplierSuggestions(false);
                    setSelectedSupplierIndex(-1);
                  }, 200)}
                  onKeyDown={e => {
                    const filtered = uniqueSuppliers.filter(s => !supplierName || s.toLowerCase().includes(supplierName.toLowerCase()));
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedSupplierIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedSupplierIndex(prev => (prev > 0 ? prev - 1 : prev));
                    } else if (e.key === 'Enter') {
                      if (selectedSupplierIndex >= 0 && selectedSupplierIndex < filtered.length) {
                        e.preventDefault();
                        setSupplierName(filtered[selectedSupplierIndex]);
                        setShowSupplierSuggestions(false);
                        setSelectedSupplierIndex(-1);
                      }
                    } else if (e.key === 'Escape') {
                      setShowSupplierSuggestions(false);
                      setSelectedSupplierIndex(-1);
                    }
                  }}
                  placeholder="Enter supplier name" 
                  autoComplete="off"
                />
                {showSupplierSuggestions && (
                  <div ref={supplierContainerRef} className="absolute z-[100] w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                    {uniqueSuppliers
                      .filter(s => !supplierName || s.toLowerCase().includes(supplierName.toLowerCase()))
                      .map((s, i) => (
                        <div 
                          key={s} 
                          className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedSupplierIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSupplierName(s);
                            setShowSupplierSuggestions(false);
                          }}
                        >
                          {s}
                        </div>
                    ))}
                    {uniqueSuppliers.filter(s => !supplierName || s.toLowerCase().includes(supplierName.toLowerCase())).length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground text-center">No matching suppliers</div>
                    )}
                  </div>
                )}
              </div>
              <div><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
              <div className="hidden lg:block"></div>
              <div className="hidden lg:block"></div>
            </div>

            <div className="space-y-4 pb-48">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold">Products</h3>
                <Button variant="outline" size="sm" onClick={addItem}><Plus className="mr-1 h-4 w-4" /> Add Product</Button>
              </div>
              
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-4 px-2 py-1 font-medium text-sm text-muted-foreground border-b">
                  <div className="col-span-4">Product Name *</div>
                  <div className="col-span-3">Category</div>
                  <div className="col-span-2">Quantity *</div>
                  <div className="col-span-2">Batch No</div>
                  <div className="col-span-1"></div>
                </div>
                {items.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-4 items-start relative px-2 py-2 border-b last:border-0">
                    <div className="col-span-4 relative">
                      <Input 
                        value={item.productName} 
                        onChange={e => {
                          updateItem(index, 'productName', e.target.value);
                          setActiveProductIndex(index);
                        }} 
                        onFocus={() => {
                          setActiveProductIndex(index);
                          setSelectedProductSuggestionIndex(-1);
                        }}
                        onBlur={() => setTimeout(() => {
                          setActiveProductIndex(null);
                          setSelectedProductSuggestionIndex(-1);
                        }, 200)}
                        onKeyDown={e => {
                          const filtered = uniqueProducts.filter(p => !item.productName || p.toLowerCase().includes(item.productName.toLowerCase()));
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setSelectedProductSuggestionIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSelectedProductSuggestionIndex(prev => (prev > 0 ? prev - 1 : prev));
                          } else if (e.key === 'Enter') {
                            if (selectedProductSuggestionIndex >= 0 && selectedProductSuggestionIndex < filtered.length) {
                              e.preventDefault();
                              updateItem(index, 'productName', filtered[selectedProductSuggestionIndex]);
                              setActiveProductIndex(null);
                              setSelectedProductSuggestionIndex(-1);
                            } else {
                              e.currentTarget.blur();
                            }
                          } else if (e.key === 'Escape') {
                            setActiveProductIndex(null);
                            setSelectedProductSuggestionIndex(-1);
                          }
                        }}
                        placeholder="Product" 
                        autoComplete="off"
                      />
                      {activeProductIndex === index && (
                        <div ref={productContainerRef} className="absolute z-[115] w-full mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {uniqueProducts
                            .filter(p => !item.productName || p.toLowerCase().includes(item.productName.toLowerCase()))
                            .map((p, i) => (
                              <div 
                                key={p} 
                                className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedProductSuggestionIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  updateItem(index, 'productName', p);
                                  setActiveProductIndex(null);
                                }}
                              >
                                {p}
                              </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-3 relative">
                      <Input 
                        value={item.category} 
                        onChange={e => {
                          updateItem(index, 'category', e.target.value);
                          setActiveCategoryIndex(index);
                        }} 
                        onFocus={() => {
                          setActiveCategoryIndex(index);
                          setSelectedCategorySuggestionIndex(-1);
                        }}
                        onBlur={() => setTimeout(() => {
                          setActiveCategoryIndex(null);
                          setSelectedCategorySuggestionIndex(-1);
                        }, 200)}
                        onKeyDown={e => {
                          const filtered = PURCHASE_CATEGORIES.filter(c => !item.category || c.toLowerCase().includes(item.category.toLowerCase()));
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setSelectedCategorySuggestionIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSelectedCategorySuggestionIndex(prev => (prev > 0 ? prev - 1 : prev));
                          } else if (e.key === 'Enter') {
                            if (selectedCategorySuggestionIndex >= 0 && selectedCategorySuggestionIndex < filtered.length) {
                              e.preventDefault();
                              updateItem(index, 'category', filtered[selectedCategorySuggestionIndex]);
                              setActiveCategoryIndex(null);
                              setSelectedCategorySuggestionIndex(-1);
                            } else {
                              e.currentTarget.blur();
                            }
                          } else if (e.key === 'Escape') {
                            setActiveCategoryIndex(null);
                            setSelectedCategorySuggestionIndex(-1);
                          }
                        }}
                        placeholder="Category" 
                      />
                      {activeCategoryIndex === index && (
                        <div ref={categoryContainerRef} className="absolute z-[110] w-full mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {PURCHASE_CATEGORIES
                            .filter(c => !item.category || c.toLowerCase().includes(item.category.toLowerCase()))
                            .map((c, i) => (
                              <div 
                                key={c} 
                                className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedCategorySuggestionIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  updateItem(index, 'category', c);
                                  setActiveCategoryIndex(null);
                                }}
                              >
                                {c}
                              </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2">
                      <Input type="number" value={item.quantity || ''} onChange={e => updateItem(index, 'quantity', +e.target.value)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} placeholder="Qty" />
                    </div>
                    <div className="col-span-2">
                      <Input value={item.batchNumber} onChange={e => updateItem(index, 'batchNumber', e.target.value)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} placeholder="Batch" />
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

            <Button className="w-full mt-4" onClick={handleSubmit}>Record Purchase</Button>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="history">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => exportCSV(filteredPurchases as any, `purchases-${new Date().toISOString().slice(0,10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
              <Button variant="outline" size="sm" onClick={() => printElement('purchase-table')}><Printer className="mr-1 h-4 w-4" />Print</Button>
            </div>
            <div className="w-full sm:w-72">
              <Input 
                placeholder="Filter by supplier, product or category..." 
                value={purchaseFilter} 
                onChange={e => setPurchaseFilter(e.target.value)} 
                className="h-9"
              />
            </div>
          </div>
          <Card><CardContent className="p-0" id="purchase-table"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Supplier</TableHead><TableHead>Product</TableHead><TableHead>Category</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Batch</TableHead><TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredPurchases.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No purchases found</TableCell></TableRow>
                : filteredPurchases.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.supplierName}</TableCell><TableCell>{p.productName}</TableCell>
                    <TableCell>{p.category}</TableCell><TableCell className="text-right">{p.quantity}</TableCell>
                    <TableCell>{p.batchNumber}</TableCell><TableCell>{p.date}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Dialog open={!!editingPurchase && editingPurchase.id === p.id} onOpenChange={(open) => !open && setEditingPurchase(null)}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => setEditingPurchase({...p})} title="Edit Purchase">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Edit Purchase Record</DialogTitle></DialogHeader>
                            <div className="grid gap-4 py-4">
                              <div className="grid gap-2">
                                <Label>Supplier Name</Label>
                                <Input value={editingPurchase?.supplierName || ''} onChange={e => setEditingPurchase({...editingPurchase, supplierName: e.target.value})} />
                              </div>
                              <div className="grid gap-2">
                                <Label>Product Name</Label>
                                <Input value={editingPurchase?.productName || ''} onChange={e => setEditingPurchase({...editingPurchase, productName: e.target.value})} />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                  <Label>Quantity</Label>
                                  <Input type="number" value={editingPurchase?.quantity || ''} onChange={e => setEditingPurchase({...editingPurchase, quantity: +e.target.value})} />
                                </div>
                                <div className="grid gap-2">
                                  <Label>Batch Number</Label>
                                  <Input value={editingPurchase?.batchNumber || ''} onChange={e => setEditingPurchase({...editingPurchase, batchNumber: e.target.value})} />
                                </div>
                              </div>
                              <div className="grid gap-2">
                                <Label>Category</Label>
                                <Input value={editingPurchase?.category || ''} onChange={e => setEditingPurchase({...editingPurchase, category: e.target.value})} />
                              </div>
                            </div>
                            <DialogFooter><Button onClick={handleEditSave}>Save Changes</Button></DialogFooter>
                          </DialogContent>
                        </Dialog>

                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)} title="Delete Purchase">
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
