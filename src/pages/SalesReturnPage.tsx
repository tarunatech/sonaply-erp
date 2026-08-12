import { useEffect, useMemo, useRef, useState } from "react";
import { addSalesReturn, updateSalesReturn, deleteSalesReturn, getClients, getSalesReturns, getBatches, SaleReturn, Client, StockBatch, exportCSV, getLocalDateString } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Download, Plus, Pencil, Trash2, Calendar as CalendarIcon, Search } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

const PRICE_CATEGORIES = ['Regular', 'Premium', 'Only Cash'];

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return new Date();
  return new Date(year, month - 1, day);
};

export default function SalesReturnPage() {
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [priceCategory, setPriceCategory] = useState("Regular");
  const [receiveDate, setReceiveDate] = useState(getLocalDateString());

  interface ReturnItemRow {
    productName: string;
    batchNo: string;
    quantity: number;
    notes: string;
  }

  const [items, setItems] = useState<ReturnItemRow[]>([
    { productName: "", batchNo: "", quantity: 0, notes: "" }
  ]);

  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);

  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [selectedClientIndex, setSelectedClientIndex] = useState(-1);

  const [activeProductIndex, setActiveProductIndex] = useState<number | null>(null);
  const [selectedProductIndex, setSelectedProductIndex] = useState(-1);

  const clientContainerRef = useRef<HTMLDivElement>(null);
  const productContainerRef = useRef<HTMLDivElement>(null);
  const receiveDateInputRef = useRef<HTMLButtonElement>(null);
  const productInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const qtyInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const addBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { toast } = useToast();
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [editingReturn, setEditingReturn] = useState<SaleReturn | null>(null);
  const [filter, setFilter] = useState("");
  const [activeTab, setActiveTab] = useState("new");

  const handleDelete = async (id: string) => {
    const password = window.prompt("Please enter admin password to delete sales return:");
    if (password !== "admin") {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (window.confirm("Are you sure you want to delete this return? Stock will be adjusted back.")) {
      try {
        await deleteSalesReturn(id);
        await refresh();
        window.dispatchEvent(new CustomEvent("erp-stock-updated"));
        toast({ title: "Sales return deleted", description: "Stock updated accordingly." });
      } catch (err: any) {
        toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
      }
    }
  };

  const handleEditSave = async () => {
    if (!editingReturn) return;
    if (editingReturn.quantity <= 0) {
      toast({ title: "Quantity must be greater than 0", variant: "destructive" });
      return;
    }
    try {
      await updateSalesReturn(editingReturn.id, editingReturn);
      await refresh();
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      setEditingReturn(null);
      toast({ title: "Sales return updated", description: "Stock adjusted accordingly." });
    } catch (err: any) {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    }
  };

  const refresh = async () => {
    const [r, c, b] = await Promise.all([getSalesReturns(), getClients(), getBatches()]);
    setReturns(r);
    setClients(c);
    setBatches(b);
  };

  useEffect(() => {
    refresh();
  }, []);

  const getFilteredProductSuggestions = (query: string) => {
    const list = new Set<string>();
    batches.forEach(b => {
      if (b.productName && b.productName.trim()) {
        list.add(b.productName.trim());
      }
    });
    const q = query.toLowerCase().trim();
    const sorted = Array.from(list).sort();
    if (!q) return sorted.slice(0, 10);
    return sorted.filter(p => p.toLowerCase().includes(q)).slice(0, 10);
  };

  const filteredReturns = useMemo(() => {
    const sorted = [...returns].sort((a, b) => new Date(b.receiveDate).getTime() - new Date(a.receiveDate).getTime());
    if (!filter.trim()) return sorted;
    const q = filter.toLowerCase().trim();
    return sorted.filter((r) =>
      (r.clientName || '').toLowerCase().includes(q) ||
      (r.clientPhone || '').toLowerCase().includes(q) ||
      (r.productName || '').toLowerCase().includes(q) ||
      (r.batchNo || '').toLowerCase().includes(q) ||
      (r.priceCategory || '').toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q)
    );
  }, [returns, filter]);

  const filteredClients = useMemo(() => {
    const q = clientName.toLowerCase().trim();
    if (!q) return clients.slice(0, 10);
    return clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.priceCategory || '').toLowerCase().includes(q)
    ).slice(0, 10);
  }, [clients, clientName]);

  useEffect(() => {
    if (selectedClientIndex >= 0 && clientContainerRef.current) {
      const activeElement = clientContainerRef.current.children[selectedClientIndex] as HTMLElement;
      activeElement?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedClientIndex]);

  useEffect(() => {
    if (selectedProductIndex >= 0 && productContainerRef.current) {
      const activeElement = productContainerRef.current.children[selectedProductIndex] as HTMLElement;
      activeElement?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedProductIndex]);

  const pickClient = (client: Client) => {
    setClientName(client.name);
    setClientPhone(client.phone || '');
    setPriceCategory(client.priceCategory || 'Regular');
    setShowClientSuggestions(false);
    setSelectedClientIndex(-1);
    setTimeout(() => {
      receiveDateInputRef.current?.focus();
    }, 0);
  };

  const updateItem = (index: number, fields: Partial<ReturnItemRow>) => {
    setItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...fields };
      return updated;
    });
  };

  const pickProduct = (index: number, name: string) => {
    const matchedBatches = batches.filter(b => (b.productName || '').trim().toLowerCase() === name.trim().toLowerCase());
    const batchNo = matchedBatches.length > 0 ? (matchedBatches[0].batchNumber || "0") : "";
    updateItem(index, { productName: name, batchNo });
    setActiveProductIndex(null);
    setSelectedProductIndex(-1);
    setTimeout(() => {
      qtyInputsRef.current[index]?.focus();
    }, 50);
  };

  const addItemRow = () => {
    const newIdx = items.length;
    setItems(prev => [...prev, { productName: "", batchNo: "", quantity: 0, notes: "" }]);
    setTimeout(() => {
      productInputsRef.current[newIdx]?.focus();
    }, 50);
  };

  const removeItemRow = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!clientName.trim()) {
      toast({ title: "Please select or enter a client name", variant: "destructive" });
      return;
    }

    const validItems = items.filter(i => i.productName.trim() && i.quantity > 0);
    if (validItems.length === 0) {
      toast({ title: "Please add at least one product with quantity greater than 0", variant: "destructive" });
      return;
    }

    try {
      await Promise.all(
        validItems.map(item =>
          addSalesReturn({
            clientName: clientName.trim(),
            clientPhone: clientPhone || undefined,
            priceCategory: priceCategory || "Regular",
            receiveDate,
            productName: item.productName.trim(),
            quantity: item.quantity,
            batchNo: item.batchNo || undefined,
            notes: item.notes || undefined,
          })
        )
      );

      await refresh();
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));

      setClientName("");
      setClientPhone("");
      setPriceCategory("Regular");
      setReceiveDate(getLocalDateString());
      setItems([{ productName: "", batchNo: "", quantity: 0, notes: "" }]);

      toast({
        title: "Sales return saved",
        description: `Saved sales return for ${validItems.length} product(s). Stock list updated.`,
      });
    } catch (err: any) {
      toast({
        title: "Save Failed",
        description: err.message || "Failed to save sales return",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-primary">Sales Return</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-xs">
          <TabsTrigger value="new">Sales Return</TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            Return History
            {returns.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-slate-200 text-slate-700">
                {returns.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label>Client Name *</Label>
                  <div className="relative">
                    <Input
                      value={clientName}
                      onChange={e => {
                        const value = e.target.value;
                        setClientName(value);
                        setShowClientSuggestions(true);
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
                        if (!showClientSuggestions || filteredClients.length === 0) return;
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSelectedClientIndex(prev => (prev < filteredClients.length - 1 ? prev + 1 : prev));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSelectedClientIndex(prev => (prev > 0 ? prev - 1 : prev));
                        } else if (e.key === 'Enter' && selectedClientIndex >= 0) {
                          e.preventDefault();
                          pickClient(filteredClients[selectedClientIndex]);
                        } else if (e.key === 'Tab' && selectedClientIndex >= 0) {
                          e.preventDefault();
                          pickClient(filteredClients[selectedClientIndex]);
                        } else if (e.key === 'Escape') {
                          setShowClientSuggestions(false);
                          setSelectedClientIndex(-1);
                        }
                      }}
                      placeholder="Client name"
                      autoComplete="off"
                    />
                    {showClientSuggestions && filteredClients.length > 0 && (
                      <div ref={clientContainerRef} className="absolute z-[110] w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {filteredClients.map((c, i) => (
                          <div
                            key={c.id}
                            className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedClientIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              pickClient(c);
                            }}
                          >
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                              <span>{c.phone || 'No phone'}</span>
                              <span>{c.priceCategory || 'No price category'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <Label>Client Phone</Label>
                  <Input value={clientPhone} placeholder="Phone number" disabled />
                </div>
                <div>
                  <Label>Price Category</Label>
                  <Select
                    value={PRICE_CATEGORIES.includes(priceCategory) ? priceCategory : 'custom'}
                    disabled
                  >
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
                  <Label>Receive Date</Label>
                  <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        ref={receiveDateInputRef}
                        variant="outline"
                        className={`w-full justify-start text-left font-normal h-9 text-xs bg-background border-input ${!receiveDate ? 'text-slate-400' : 'text-slate-900 font-medium'}`}
                        onKeyDown={e => {
                          if (e.key === 'Tab' && !e.shiftKey) {
                            const nextInput = productInputsRef.current[0];
                            if (nextInput) {
                              e.preventDefault();
                              nextInput.focus();
                            }
                          }
                        }}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 text-slate-500 shrink-0" />
                        {receiveDate ? format(parseLocalDate(receiveDate), "dd-MM-yyyy") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={receiveDate ? parseLocalDate(receiveDate) : undefined}
                        onSelect={(d) => {
                          if (d) {
                            setReceiveDate(getLocalDateString(d));
                            setIsCalendarOpen(false);
                            setTimeout(() => {
                              receiveDateInputRef.current?.focus();
                            }, 50);
                          }
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold text-slate-900">Return Products *</Label>
                </div>

                <div className="border rounded-md divide-y bg-background overflow-visible shadow-sm">
                  <div className="grid grid-cols-12 gap-3 px-3 py-2.5 bg-slate-100/70 font-semibold text-xs text-slate-700 border-b">
                    <div className="col-span-12 sm:col-span-4">Product Name *</div>
                    <div className="col-span-6 sm:col-span-2">Batch No</div>
                    <div className="col-span-6 sm:col-span-2">Return Qty *</div>
                    <div className="col-span-10 sm:col-span-3">Notes</div>
                    <div className="col-span-2 sm:col-span-1 text-center">Action</div>
                  </div>

                  {items.map((item, index) => {
                    const currentProductBatches = item.productName
                      ? batches.filter(b => (b.productName || '').trim().toLowerCase() === item.productName.trim().toLowerCase())
                      : [];
                    const suggestions = getFilteredProductSuggestions(item.productName);

                    return (
                      <div key={index} className="grid grid-cols-12 gap-3 items-center px-3 py-3 relative border-b last:border-0 hover:bg-slate-50/50">
                        {/* Product Name with suggestions */}
                        <div className="col-span-12 sm:col-span-4 relative">
                          <Input
                            ref={el => { productInputsRef.current[index] = el; }}
                            value={item.productName}
                            onChange={e => {
                              const val = e.target.value;
                              const matched = batches.filter(b => (b.productName || '').trim().toLowerCase() === val.trim().toLowerCase());
                              const defaultBatch = matched.length > 0 ? (matched[0].batchNumber || "0") : "";
                              updateItem(index, { productName: val, batchNo: defaultBatch });
                              setActiveProductIndex(index);
                              setSelectedProductIndex(-1);
                            }}
                            onFocus={() => {
                              setActiveProductIndex(index);
                              setSelectedProductIndex(-1);
                            }}
                            onBlur={() => setTimeout(() => {
                              if (activeProductIndex === index) {
                                setActiveProductIndex(null);
                                setSelectedProductIndex(-1);
                              }
                            }, 200)}
                            onKeyDown={e => {
                              if (activeProductIndex === index && suggestions.length > 0) {
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setSelectedProductIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setSelectedProductIndex(prev => (prev > 0 ? prev - 1 : prev));
                                } else if (e.key === 'Enter') {
                                  if (selectedProductIndex >= 0 && selectedProductIndex < suggestions.length) {
                                    e.preventDefault();
                                    pickProduct(index, suggestions[selectedProductIndex]);
                                  } else {
                                    e.preventDefault();
                                    qtyInputsRef.current[index]?.focus();
                                  }
                                } else if (e.key === 'Tab') {
                                  if (selectedProductIndex >= 0 && selectedProductIndex < suggestions.length) {
                                    pickProduct(index, suggestions[selectedProductIndex]);
                                  }
                                } else if (e.key === 'Escape') {
                                  setActiveProductIndex(null);
                                  setSelectedProductIndex(-1);
                                }
                              } else if (e.key === 'Enter') {
                                e.preventDefault();
                                qtyInputsRef.current[index]?.focus();
                              }
                            }}
                            placeholder="Search product from stock"
                            autoComplete="off"
                            className="h-9 text-xs"
                          />
                          {activeProductIndex === index && suggestions.length > 0 && (
                            <div ref={productContainerRef} className="absolute z-[110] w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto left-0">
                              {suggestions.map((p, i) => (
                                <div
                                  key={p}
                                  className={`px-3 py-2 cursor-pointer text-xs text-popover-foreground border-b last:border-0 ${selectedProductIndex === i ? 'bg-accent font-medium' : 'hover:bg-accent'}`}
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    pickProduct(index, p);
                                  }}
                                >
                                  <div className="font-medium">{p}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {batches.filter(b => (b.productName || '').trim().toLowerCase() === p.trim().toLowerCase()).reduce((sum, b) => sum + (b.availableQty || 0), 0)} available in stock
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Batch No Select */}
                        <div className="col-span-6 sm:col-span-2">
                          {item.productName ? (
                            <Select value={item.batchNo} onValueChange={val => updateItem(index, { batchNo: val })} disabled={currentProductBatches.length <= 1}>
                              <SelectTrigger className="h-9 text-xs">
                                <SelectValue placeholder="Select Batch" />
                              </SelectTrigger>
                              <SelectContent>
                                {currentProductBatches.map(b => {
                                  const batchVal = b.batchNumber || "0";
                                  return (
                                    <SelectItem key={b.id} value={batchVal} className="text-xs">
                                      {batchVal} (Avail: {b.availableQty})
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input disabled placeholder="Select product first" className="h-9 text-xs" />
                          )}
                        </div>

                        {/* Return Quantity Input */}
                        <div className="col-span-6 sm:col-span-2">
                          <Input
                            ref={el => { qtyInputsRef.current[index] = el; }}
                            type="number"
                            value={item.quantity || ""}
                            onChange={e => updateItem(index, { quantity: Number(e.target.value) })}
                            min={1}
                            placeholder="Return qty"
                            className="h-9 text-xs font-semibold"
                          />
                        </div>

                        {/* Notes */}
                        <div className="col-span-10 sm:col-span-3">
                          <Input
                            value={item.notes}
                            onChange={e => updateItem(index, { notes: e.target.value })}
                            placeholder="Reason for return, condition, etc."
                            className="h-9 text-xs"
                          />
                        </div>

                        {/* Action Buttons (+ Add and Trash) */}
                        <div className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1">
                          <Button
                            ref={el => { addBtnRefs.current[index] = el; }}
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-300"
                            onClick={addItemRow}
                            title="Add another product row"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>

                          {items.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              onClick={() => removeItemRow(index)}
                              title="Remove this product row"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={handleSubmit} size="lg" className="px-6">
                  <Plus className="mr-2 h-4 w-4" /> Save Return ({items.filter(i => i.productName.trim() && i.quantity > 0).length} items)
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search client, phone, product, batch or notes..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => exportCSV(filteredReturns as any, `sales-returns-${new Date().toISOString().slice(0, 10)}.csv`)}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
          </div>

          <Card>
            <CardContent className="p-0 overflow-hidden">
              <Table className="border-collapse border-2 border-slate-300 w-full">
                <TableHeader className="bg-slate-50/75">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Receive Date</TableHead>
                    <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Client Name</TableHead>
                    <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Phone</TableHead>
                    <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Product</TableHead>
                    <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Price Category</TableHead>
                    <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Qty</TableHead>
                    <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Batch</TableHead>
                    <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Notes</TableHead>
                    <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReturns.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="border-2 border-slate-300 text-center text-muted-foreground py-8">No sales returns found</TableCell></TableRow>
                  ) : filteredReturns.map(item => (
                    <TableRow key={item.id} className="hover:bg-slate-50/40">
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700 font-medium whitespace-nowrap">
                        {item.receiveDate ? format(new Date(item.receiveDate), 'dd-MM-yyyy') : "-"}
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm min-w-[150px] max-w-[220px] break-words">
                        {renderCustomer(item.clientName)}
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700">{item.clientPhone || "-"}</TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-900 font-semibold">{item.productName}</TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700">{item.priceCategory || "-"}</TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-right font-bold text-slate-800">{item.quantity}</TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700">{item.batchNo || "-"}</TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700 max-w-[200px] truncate" title={item.notes}>
                        {item.notes || "-"}
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-right align-middle">
                        <div className="flex justify-end gap-1">
                          <Dialog open={!!editingReturn && editingReturn.id === item.id} onOpenChange={(open) => !open && setEditingReturn(null)}>
                            <DialogTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-blue-600" 
                                onClick={() => setEditingReturn({ ...item })} 
                                title="Edit Return"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            {editingReturn && (
                              <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                                <DialogHeader><DialogTitle>Edit Sales Return</DialogTitle></DialogHeader>
                                <div className="grid grid-cols-2 gap-3 py-4 text-left">
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Client Name</Label>
                                    <Input 
                                      value={editingReturn.clientName || ''} 
                                      onChange={e => setEditingReturn({...editingReturn, clientName: e.target.value})} 
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Client Phone</Label>
                                    <Input 
                                      value={editingReturn.clientPhone || ''} 
                                      onChange={e => setEditingReturn({...editingReturn, clientPhone: e.target.value})} 
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Price Category</Label>
                                    <Select 
                                      value={editingReturn.priceCategory || 'Regular'} 
                                      onValueChange={val => setEditingReturn({...editingReturn, priceCategory: val})}
                                    >
                                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        {PRICE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Receive Date</Label>
                                    <Input 
                                      type="date"
                                      value={editingReturn.receiveDate ? editingReturn.receiveDate.slice(0, 10) : ''} 
                                      onChange={e => setEditingReturn({...editingReturn, receiveDate: e.target.value})} 
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <div className="grid gap-1 col-span-2">
                                    <Label className="text-xs">Product Name</Label>
                                    <Input 
                                      value={editingReturn.productName || ''} 
                                      onChange={e => setEditingReturn({...editingReturn, productName: e.target.value})} 
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Batch No</Label>
                                    <Input 
                                      value={editingReturn.batchNo || ''} 
                                      onChange={e => setEditingReturn({...editingReturn, batchNo: e.target.value})} 
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Quantity</Label>
                                    <Input 
                                      type="number"
                                      value={editingReturn.quantity || ''} 
                                      onChange={e => setEditingReturn({...editingReturn, quantity: Number(e.target.value)})} 
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <div className="grid gap-1 col-span-2">
                                    <Label className="text-xs">Notes</Label>
                                    <Input 
                                      value={editingReturn.notes || ''} 
                                      onChange={e => setEditingReturn({...editingReturn, notes: e.target.value})} 
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                </div>
                                <DialogFooter><Button onClick={handleEditSave} size="sm">Save Changes</Button></DialogFooter>
                              </DialogContent>
                            )}
                          </Dialog>

                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive" 
                            onClick={() => handleDelete(item.id)} 
                            title="Delete Return"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
