import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { addPurchase, getPurchases, updatePurchase, deletePurchase, exportCSV, Purchase, getBatches, StockBatch, getLocalDateString, formatLocalDate } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Download, Printer, Plus, Trash2, Pencil, ChevronDown, ChevronRight, Calendar as CalendarIcon, X, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

interface PurchaseItem {
  id?: string;
  productName: string;
  category: string;
  quantity: number;
  batchNumber: string;
}

interface DateGroup {
  date: string;
  formattedDate: string;
  totalQty: number;
  purchases: Purchase[];
}

interface SupplierGroup {
  supplierName: string;
  totalEntries: number;
  totalQty: number;
  dateGroups: DateGroup[];
}

const PURCHASE_CATEGORIES = [
  "FINE TOUCH",
  "FINE TOUCH LITE",
  "FINOBLE",
  "REAL PLUS",
  "REAL TOUCH",
  "ROXX LAM",
  "KIWI DECOR",
  "ELITE LAM",
  "ACRIKA",
  "KALAA",
  "YOUR DECOR"
];
const defaultItem: PurchaseItem = { productName: '', category: '', quantity: 0, batchNumber: '0' };

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return new Date();
  return new Date(year, month - 1, day);
};


export default function PurchasePage() {
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(getLocalDateString());
  const [items, setItems] = useState<PurchaseItem[]>([{ ...defaultItem }]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [editingGroup, setEditingGroup] = useState<{ date: string; supplierName: string; originalPurchases: Purchase[] } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);
  const [selectedSupplierIndex, setSelectedSupplierIndex] = useState(-1);
  const supplierInputRef = useRef<HTMLInputElement>(null);
  const supplierContainerRef = useRef<HTMLDivElement>(null);
  
  const [purchaseFilter, setPurchaseFilter] = useState('');
  const [activeCategoryIndex, setActiveCategoryIndex] = useState<number | null>(null);
  const [activeProductIndex, setActiveProductIndex] = useState<number | null>(null);
  const [selectedCategorySuggestionIndex, setSelectedCategorySuggestionIndex] = useState<number>(-1);
  const [selectedProductSuggestionIndex, setSelectedProductSuggestionIndex] = useState<number>(-1);
  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const productContainerRef = useRef<HTMLDivElement>(null);
  
  const [expandedSuppliers, setExpandedSuppliers] = useState<Record<string, boolean>>({});
  const [expandedDateGroups, setExpandedDateGroups] = useState<Record<string, boolean>>({});
  const { toast } = useToast();
  const addProductBtnRef = useRef<HTMLButtonElement>(null);
  const productInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const [allBatches, setAllBatches] = useState<StockBatch[]>([]);
  const [activeBatchIndex, setActiveBatchIndex] = useState<number | null>(null);
  const [selectedBatchSuggestionIndex, setSelectedBatchSuggestionIndex] = useState<number>(-1);
  const batchContainerRef = useRef<HTMLDivElement>(null);
  const recordPurchaseBtnRef = useRef<HTMLButtonElement>(null);
  const purchaseDateRef = useRef<HTMLButtonElement>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  useEffect(() => {
    if (selectedBatchSuggestionIndex >= 0 && batchContainerRef.current) {
      const activeElement = batchContainerRef.current.children[selectedBatchSuggestionIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedBatchSuggestionIndex]);

  useEffect(() => {
    if (items.length > 1) {
      const lastIndex = items.length - 1;
      const lastInput = productInputsRef.current[lastIndex];
      if (lastInput && !lastInput.value) {
        lastInput.focus();
      }
    }
  }, [items.length]);

  const refresh = useCallback(() => {
    getPurchases().then(setPurchases);
    getBatches().then(setAllBatches);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const uniqueSuppliers = useMemo(() => {
    return Array.from(new Set(purchases.map(p => p.supplierName).filter(Boolean))).sort();
  }, [purchases]);

  const uniqueProducts = useMemo(() => {
    const list = new Set<string>();
    purchases.forEach(p => { if (p.productName) list.add(p.productName); });
    allBatches.forEach(b => { if (b.productName) list.add(b.productName); });
    return Array.from(list).sort();
  }, [purchases, allBatches]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      const f = purchaseFilter.toLowerCase();
      const formattedD = formatLocalDate(p.date);
      return (p.supplierName || '').toLowerCase().includes(f) ||
             (p.productName || '').toLowerCase().includes(f) ||
             (p.category || '').toLowerCase().includes(f) ||
             (p.batchNumber || '').toLowerCase().includes(f) ||
             (p.date || '').toLowerCase().includes(f) ||
             formattedD.toLowerCase().includes(f);
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [purchases, purchaseFilter]);

  const supplierGroups = useMemo(() => {
    const map: Record<string, SupplierGroup> = {};

    filteredPurchases.forEach(p => {
      const sName = (p.supplierName || 'Unknown Supplier').trim();
      const cleanDate = p.date ? String(p.date).slice(0, 10) : 'No Date';

      if (!map[sName]) {
        map[sName] = {
          supplierName: sName,
          totalEntries: 0,
          totalQty: 0,
          dateGroups: []
        };
      }

      map[sName].totalEntries += 1;
      map[sName].totalQty += Number(p.quantity || 0);

      let dGroup = map[sName].dateGroups.find(dg => dg.date === cleanDate);
      if (!dGroup) {
        dGroup = {
          date: cleanDate,
          formattedDate: cleanDate !== 'No Date' ? formatLocalDate(cleanDate) : 'No Date',
          totalQty: 0,
          purchases: []
        };
        map[sName].dateGroups.push(dGroup);
      }

      dGroup.purchases.push(p);
      dGroup.totalQty += Number(p.quantity || 0);
    });

    const result = Object.values(map).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
    
    result.forEach(sg => {
      sg.dateGroups.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    });

    return result;
  }, [filteredPurchases]);

  const toggleSupplier = (supplierName: string) => {
    setExpandedSuppliers(prev => ({
      ...prev,
      [supplierName]: !prev[supplierName]
    }));
  };

  const toggleDateGroup = (key: string) => {
    setExpandedDateGroups(prev => ({
      ...prev,
      [key]: prev[key] === undefined ? false : !prev[key]
    }));
  };

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
    if (key === 'productName' && typeof value === 'string' && value.trim()) {
      const match = allBatches.find(b => b.productName.toLowerCase().trim() === value.toLowerCase().trim());
      if (match) {
        if (!newItems[index].category && match.category) {
          newItems[index].category = match.category;
        }
        if ((!newItems[index].batchNumber || newItems[index].batchNumber === '0') && match.batchNumber) {
          newItems[index].batchNumber = match.batchNumber;
        }
      }
    }
    setItems(newItems);
  };

  const handleEditDateGroup = (supplierName: string, dateGroup: DateGroup) => {
    setSupplierName(supplierName);
    setDate(dateGroup.date);
    setItems(
      dateGroup.purchases.map(p => ({
        id: p.id,
        productName: p.productName,
        category: p.category || '',
        quantity: p.quantity,
        batchNumber: p.batchNumber || '0'
      }))
    );
    setEditingGroup({
      date: dateGroup.date,
      supplierName: supplierName,
      originalPurchases: dateGroup.purchases
    });
    setActiveTab("new");
    setTimeout(() => {
      if (supplierInputRef.current) {
        supplierInputRef.current.focus();
        supplierInputRef.current.select();
      }
    }, 100);
  };

  const handleCancelEdit = () => {
    setEditingGroup(null);
    setSupplierName('');
    setDate(getLocalDateString());
    setItems([{ ...defaultItem }]);
  };

  const handleDeleteDateGroup = async (supplierName: string, dateGroup: DateGroup) => {
    const password = window.prompt("Please enter admin password to delete:");
    if (password !== 'admin') {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (window.confirm(`Delete all ${dateGroup.purchases.length} purchase record(s) for "${supplierName}" on ${dateGroup.formattedDate}?`)) {
      for (const p of dateGroup.purchases) {
        await deletePurchase(p.id);
      }
      refresh();
      toast({ title: "Purchase date group deleted successfully" });
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!supplierName.trim()) {
      toast({ title: "Please enter supplier name", variant: "destructive" }); return;
    }
    
    const validItems = items.filter(item => item.productName.trim() && Number(item.quantity) > 0);
    if (validItems.length === 0) {
      toast({ title: "Please add at least one valid product with quantity > 0", variant: "destructive" }); return;
    }

    setIsSubmitting(true);
    try {
      if (editingGroup) {
        const originalPurchases = editingGroup.originalPurchases;
        const currentItemIds = new Set(validItems.map(it => it.id).filter(Boolean));

        // 1. Delete removed items
        for (const orig of originalPurchases) {
          if (!currentItemIds.has(orig.id)) {
            await deletePurchase(orig.id);
          }
        }

        // 2. Update existing items or Add newly added items
        for (const item of validItems) {
          if (item.id) {
            await updatePurchase(item.id, {
              supplierName: supplierName.trim(),
              productName: item.productName.trim(),
              category: item.category?.trim() || '',
              quantity: Number(item.quantity),
              batchNumber: item.batchNumber?.trim() || '0',
              date: date
            });
          } else {
            await addPurchase({
              supplierName: supplierName.trim(),
              supplierPhone: '',
              productName: item.productName.trim(),
              category: item.category?.trim() || '',
              quantity: Number(item.quantity),
              rate: 0,
              totalAmount: 0,
              batchNumber: item.batchNumber?.trim() || '0',
              date: date
            });
          }
        }

        toast({ title: "Purchase updated successfully!" });
        setEditingGroup(null);
        setSupplierName('');
        setDate(getLocalDateString());
        setItems([{ ...defaultItem }]);
        refresh();
        setActiveTab("history");
      } else {
        for (const item of validItems) {
          await addPurchase({ 
            supplierName: supplierName.trim(), 
            supplierPhone: '', 
            productName: item.productName.trim(), 
            category: item.category?.trim() || '', 
            quantity: Number(item.quantity), 
            rate: 0, 
            totalAmount: 0, 
            batchNumber: item.batchNumber?.trim() || '0', 
            date 
          });
        }

        toast({ title: "Purchase recorded & stock updated!" });
        setSupplierName('');
        setDate(getLocalDateString());
        setItems([{ ...defaultItem }]);
        refresh();
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to process purchase", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Purchase Module</h1>
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'new' | 'history')}>
        <TabsList>
          <TabsTrigger value="new">
            {editingGroup ? "Edit Purchase" : "New Purchase"}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="new">
          <Card>
            <CardContent className="space-y-6 pt-6">
              {editingGroup && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-blue-800 bg-blue-100 border border-blue-300 px-2 py-0.5 rounded">
                      EDITING PURCHASE
                    </span>
                    <span className="text-sm font-semibold text-blue-950">
                      {editingGroup.supplierName} • {formatLocalDate(editingGroup.date)}
                    </span>
                    <span className="text-xs text-blue-700">
                      ({items.length} items)
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-blue-300 text-blue-800 hover:bg-blue-100"
                    onClick={handleCancelEdit}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Cancel Edit
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-4 border-b">
                <div className="relative">
                  <Label>Supplier Name *</Label>
                  <Input 
                    ref={supplierInputRef}
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
                          setTimeout(() => {
                            purchaseDateRef.current?.focus();
                          }, 50);
                        }
                      } else if (e.key === 'Tab') {
                        if (selectedSupplierIndex >= 0 && selectedSupplierIndex < filtered.length) {
                          e.preventDefault();
                          setSupplierName(filtered[selectedSupplierIndex]);
                          setShowSupplierSuggestions(false);
                          setSelectedSupplierIndex(-1);
                          setTimeout(() => {
                            purchaseDateRef.current?.focus();
                          }, 50);
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
                              setTimeout(() => {
                                purchaseDateRef.current?.focus();
                              }, 50);
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
                <div>
                  <Label>Date</Label>
                  <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        ref={purchaseDateRef}
                        variant="outline"
                        className={`w-full justify-start text-left font-normal h-9 text-xs bg-background border-input ${!date ? 'text-slate-400' : 'text-slate-900 font-medium'}`}
                        onKeyDown={e => {
                          if (e.key === 'Tab' && !e.shiftKey) {
                            const firstInput = productInputsRef.current[0];
                            if (firstInput) {
                              e.preventDefault();
                              firstInput.focus();
                            }
                          }
                        }}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 text-slate-500 shrink-0" />
                        {date ? format(parseLocalDate(date), "dd-MM-yyyy") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={date ? parseLocalDate(date) : undefined}
                        onSelect={(d) => {
                          if (d) {
                            setDate(getLocalDateString(d));
                            setIsCalendarOpen(false);
                            setTimeout(() => {
                              purchaseDateRef.current?.focus();
                            }, 50);
                          }
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="hidden lg:block"></div>
                <div className="hidden lg:block"></div>
              </div>

              <div className="space-y-4 pb-48">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold">Products</h3>
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
                          ref={el => { productInputsRef.current[index] = el; }}
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
                            } else if (e.key === 'Tab') {
                              if (selectedProductSuggestionIndex >= 0 && selectedProductSuggestionIndex < filtered.length) {
                                updateItem(index, 'productName', filtered[selectedProductSuggestionIndex]);
                                setActiveProductIndex(null);
                                setSelectedProductSuggestionIndex(-1);
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
                            } else if (e.key === 'Tab') {
                              if (selectedCategorySuggestionIndex >= 0 && selectedCategorySuggestionIndex < filtered.length) {
                                updateItem(index, 'category', filtered[selectedCategorySuggestionIndex]);
                                setActiveCategoryIndex(null);
                                setSelectedCategorySuggestionIndex(-1);
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
                      <div className="col-span-2 relative">
                        <Input 
                          value={item.batchNumber} 
                          onChange={e => {
                            updateItem(index, 'batchNumber', e.target.value);
                            setActiveBatchIndex(index);
                          }} 
                          onFocus={() => {
                            setActiveBatchIndex(index);
                            setSelectedBatchSuggestionIndex(-1);
                          }}
                          onBlur={() => setTimeout(() => {
                            setActiveBatchIndex(null);
                            setSelectedBatchSuggestionIndex(-1);
                          }, 200)}
                          onKeyDown={e => {
                            const rowBatches = Array.from(new Set(
                              allBatches
                                .filter(b => !item.productName || b.productName.trim().toLowerCase() === item.productName.trim().toLowerCase())
                                .map(b => b.batchNumber)
                                .filter(Boolean)
                            )).sort();
                            const filtered = rowBatches.filter(b => !item.batchNumber || b.toLowerCase().includes(item.batchNumber.toLowerCase()));
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              setSelectedBatchSuggestionIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              setSelectedBatchSuggestionIndex(prev => (prev > 0 ? prev - 1 : prev));
                            } else if (e.key === 'Enter') {
                              if (selectedBatchSuggestionIndex >= 0 && selectedBatchSuggestionIndex < filtered.length) {
                                e.preventDefault();
                                updateItem(index, 'batchNumber', filtered[selectedBatchSuggestionIndex]);
                                setActiveBatchIndex(null);
                                setSelectedBatchSuggestionIndex(-1);
                              } else {
                                e.currentTarget.blur();
                              }
                            } else if (e.key === 'Tab') {
                              if (selectedBatchSuggestionIndex >= 0 && selectedBatchSuggestionIndex < filtered.length) {
                                updateItem(index, 'batchNumber', filtered[selectedBatchSuggestionIndex]);
                                setActiveBatchIndex(null);
                                setSelectedBatchSuggestionIndex(-1);
                                if (!e.shiftKey && index === items.length - 1) {
                                  e.preventDefault();
                                  addProductBtnRef.current?.focus();
                                }
                              } else if (!e.shiftKey && index === items.length - 1) {
                                e.preventDefault();
                                addProductBtnRef.current?.focus();
                              }
                            } else if (e.key === 'Escape') {
                              setActiveBatchIndex(null);
                              setSelectedBatchSuggestionIndex(-1);
                            }
                          }}
                          placeholder="Batch No" 
                          autoComplete="off"
                        />
                        {activeBatchIndex === index && (
                          <div ref={batchContainerRef} className="absolute z-[110] w-full mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                            {(() => {
                              const rowBatches = Array.from(new Set(
                                allBatches
                                  .filter(b => !item.productName || b.productName.trim().toLowerCase() === item.productName.trim().toLowerCase())
                                  .map(b => b.batchNumber)
                                  .filter(Boolean)
                              )).sort();
                              const filtered = rowBatches.filter(b => !item.batchNumber || b.toLowerCase().includes(item.batchNumber.toLowerCase()));
                              return filtered.map((b, i) => (
                                <div 
                                  key={b} 
                                  className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedBatchSuggestionIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    updateItem(index, 'batchNumber', b);
                                    setActiveBatchIndex(null);
                                  }}
                                >
                                  {b}
                                </div>
                              ));
                            })()}
                          </div>
                        )}
                      </div>
                      <div className="col-span-1 flex justify-end gap-1 items-center">
                        {index === items.length - 1 && (
                          <Button 
                            ref={addProductBtnRef}
                            variant="outline" 
                            size="sm" 
                            onClick={addItem} 
                            className="h-9 px-2 shrink-0"
                            onKeyDown={e => {
                              if (e.key === 'Tab' && !e.shiftKey) {
                                e.preventDefault();
                                const isFirstRowEmpty = !items[0]?.productName;
                                if (isFirstRowEmpty) {
                                  productInputsRef.current[0]?.focus();
                                } else {
                                  recordPurchaseBtnRef.current?.focus();
                                }
                              }
                            }}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0 h-9 w-9" onClick={() => removeItem(index)} disabled={items.length === 1}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button ref={recordPurchaseBtnRef} className="flex-1" onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {editingGroup ? "Saving Changes..." : "Recording Purchase..."}
                    </>
                  ) : (
                    editingGroup ? "Save Changes (Update Purchase)" : "Record Purchase"
                  )}
                </Button>
                {editingGroup && (
                  <Button variant="outline" onClick={handleCancelEdit} disabled={isSubmitting}>
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="history">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => exportCSV(filteredPurchases as any, `purchases-${new Date().toISOString().slice(0,10)}.csv`)}>
                <Download className="mr-1 h-4 w-4" /> Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => printElement('purchase-table')}>
                <Printer className="mr-1 h-4 w-4" /> Print
              </Button>
            </div>
            <div className="w-full sm:w-72">
              <Input 
                placeholder="Filter by date, supplier, product..." 
                value={purchaseFilter} 
                onChange={e => setPurchaseFilter(e.target.value)} 
                className="h-9"
              />
            </div>
          </div>
          <Card>
            <CardContent className="p-0" id="purchase-table">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier / Purchase Date</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead className="text-right">Total Qty</TableHead>
                      <TableHead className="text-right w-[110px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplierGroups.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          No purchases found
                        </TableCell>
                      </TableRow>
                    ) : (
                      supplierGroups.map(sg => {
                        const isSupplierExpanded = !!expandedSuppliers[sg.supplierName];
                        
                        return (
                          <React.Fragment key={sg.supplierName}>
                            {/* Supplier Level Header */}
                            <TableRow 
                              className="cursor-pointer bg-slate-50/80 hover:bg-slate-100/80 border-b-2 font-medium"
                              onClick={() => toggleSupplier(sg.supplierName)}
                            >
                              <TableCell className="font-bold text-primary flex items-center gap-2">
                                {isSupplierExpanded ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-primary" />}
                                <span>{sg.supplierName}</span>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-xs">
                                {sg.dateGroups.length} date group{sg.dateGroups.length !== 1 ? 's' : ''} • {sg.totalEntries} item{sg.totalEntries !== 1 ? 's' : ''}
                              </TableCell>
                              <TableCell className="text-right font-bold text-slate-900">
                                {sg.totalQty}
                              </TableCell>
                              <TableCell className="text-right"></TableCell>
                            </TableRow>
                            
                            {/* Date Groups under Expanded Supplier */}
                            {isSupplierExpanded && sg.dateGroups.map(dg => {
                              const dateGroupKey = `${sg.supplierName}___${dg.date}`;
                              const isDateExpanded = expandedDateGroups[dateGroupKey] !== false; // expanded by default
                              
                              return (
                                <React.Fragment key={dateGroupKey}>
                                  <TableRow 
                                    className="cursor-pointer bg-white hover:bg-blue-50/40 border-b"
                                    onClick={() => toggleDateGroup(dateGroupKey)}
                                  >
                                    <TableCell className="pl-6 font-semibold text-slate-800">
                                      <div className="flex items-center gap-2">
                                        {isDateExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                                        <span className="text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded text-xs font-bold">
                                          📅 {dg.formattedDate}
                                        </span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-slate-600 text-xs">
                                      <span className="font-medium text-slate-800">{dg.purchases.length} product{dg.purchases.length !== 1 ? 's' : ''}</span>
                                      <span className="ml-2 text-[11px] text-slate-500 hidden sm:inline">
                                        ({dg.purchases.map(p => p.productName).filter(Boolean).slice(0, 3).join(", ")}{dg.purchases.length > 3 ? "..." : ""})
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-right font-bold text-slate-900">
                                      {dg.totalQty}
                                    </TableCell>
                                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex justify-end gap-1 items-center">
                                        <Button 
                                          variant="ghost" 
                                          size="icon" 
                                          className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" 
                                          onClick={() => handleEditDateGroup(sg.supplierName, dg)} 
                                          title={`Edit purchase on ${dg.formattedDate}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button 
                                          variant="ghost" 
                                          size="icon" 
                                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" 
                                          onClick={() => handleDeleteDateGroup(sg.supplierName, dg)} 
                                          title={`Delete purchase on ${dg.formattedDate}`}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>

                                  {/* Product items under Date Group */}
                                  {isDateExpanded && (
                                    <TableRow className="bg-slate-50/50 hover:bg-slate-50/50 p-0 border-b">
                                      <TableCell colSpan={4} className="p-0">
                                        <div className="py-2 pl-12 pr-4 space-y-1 bg-slate-50/60">
                                          <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider pb-1 border-b">
                                            <div className="col-span-5 pl-2">Product Name</div>
                                            <div className="col-span-3">Category</div>
                                            <div className="col-span-2">Batch No</div>
                                            <div className="col-span-2 text-right">Quantity</div>
                                          </div>
                                          {dg.purchases.map(p => (
                                            <div key={p.id} className="grid grid-cols-12 gap-2 text-xs py-1.5 border-b border-slate-100 last:border-0 items-center">
                                              <div className="col-span-5 pl-2 font-medium text-slate-900 flex items-center gap-1.5">
                                                <span className="text-slate-400">└─</span>
                                                <span>{p.productName}</span>
                                              </div>
                                              <div className="col-span-3 text-slate-600">
                                                {p.category || "—"}
                                              </div>
                                              <div className="col-span-2 text-slate-600">
                                                {p.batchNumber || "0"}
                                              </div>
                                              <div className="col-span-2 text-right font-bold text-slate-900">
                                                {p.quantity}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
