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
import { Download, Plus, Pencil, Trash2, Calendar as CalendarIcon } from "lucide-react";
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
  const [productName, setProductName] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [quantity, setQuantity] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [selectedClientIndex, setSelectedClientIndex] = useState(-1);
  const [showProductSuggestions, setShowProductSuggestions] = useState(false);
  const [selectedProductIndex, setSelectedProductIndex] = useState(-1);
  const clientContainerRef = useRef<HTMLDivElement>(null);
  const productContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const receiveDateInputRef = useRef<HTMLButtonElement>(null);
  const productNameInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [editingReturn, setEditingReturn] = useState<SaleReturn | null>(null);

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

  const productSuggestions = useMemo(() => {
    const list = new Set<string>();
    batches.forEach(b => list.add(b.productName));
    return Array.from(list).sort();
  }, [batches]);

  const filteredReturns = useMemo(() => [...returns].sort((a, b) => new Date(b.receiveDate).getTime() - new Date(a.receiveDate).getTime()), [returns]);

  const currentProductBatches = useMemo(() => {
    if (!productName) return [];
    return batches.filter(b => b.productName === productName);
  }, [productName, batches]);

  const filteredClients = useMemo(() => {
    const q = clientName.toLowerCase().trim();
    if (!q) return clients.slice(0, 10);
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
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

  const pickProduct = (name: string) => {
    setProductName(name);
    const matchedBatch = batches.find(b => b.productName === name);
    if (matchedBatch && !batchNo) {
      setBatchNo(matchedBatch.batchNumber);
    }
    setShowProductSuggestions(false);
    setSelectedProductIndex(-1);
    setTimeout(() => {
      qtyInputRef.current?.focus();
    }, 50);
  };

  const handleSubmit = async () => {
    if (!clientName || !productName || quantity <= 0) {
      toast({ title: "Please fill client, product and quantity", variant: "destructive" });
      return;
    }

    await addSalesReturn({
      clientName,
      clientPhone,
      priceCategory,
      receiveDate,
      productName,
      quantity,
      batchNo: batchNo || undefined,
      notes: notes || undefined,
    });
    await refresh();
    window.dispatchEvent(new CustomEvent("erp-stock-updated"));
    setClientName("");
    setClientPhone("");
    setPriceCategory("Regular");
    setReceiveDate(getLocalDateString());
    setProductName("");
    setBatchNo("");
    setQuantity(0);
    setNotes("");
    toast({ title: "Sales return saved", description: "Stock has been restored based on the return quantity." });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sales Return</h1>
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
                        const nextInput = productNameInputRef.current;
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
            <div className="sm:col-span-2">
              <Label>Product Name *</Label>
              <div className="relative">
                <Input
                  ref={productNameInputRef}
                  value={productName}
                  onChange={e => {
                    setProductName(e.target.value);
                    setShowProductSuggestions(true);
                    setBatchNo('');
                  }}
                  onFocus={() => {
                    setShowProductSuggestions(true);
                    setSelectedProductIndex(-1);
                  }}
                  onBlur={() => setTimeout(() => {
                    setShowProductSuggestions(false);
                    setSelectedProductIndex(-1);
                  }, 200)}
                  onKeyDown={e => {
                    if (!showProductSuggestions || productSuggestions.length === 0) return;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedProductIndex(prev => (prev < productSuggestions.length - 1 ? prev + 1 : prev));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedProductIndex(prev => (prev > 0 ? prev - 1 : prev));
                    } else if (e.key === 'Enter' && selectedProductIndex >= 0) {
                      e.preventDefault();
                      pickProduct(productSuggestions[selectedProductIndex]);
                    } else if (e.key === 'Tab' && selectedProductIndex >= 0) {
                      e.preventDefault();
                      pickProduct(productSuggestions[selectedProductIndex]);
                    } else if (e.key === 'Escape') {
                      setShowProductSuggestions(false);
                      setSelectedProductIndex(-1);
                    }
                  }}
                  placeholder="Search product from stock"
                  autoComplete="off"
                />
                {showProductSuggestions && productSuggestions.length > 0 && (
                  <div ref={productContainerRef} className="absolute z-[110] w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {productSuggestions.map((p, i) => (
                      <div
                        key={p}
                        className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedProductIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickProduct(p);
                        }}
                      >
                        <div className="font-medium">{p}</div>
                        <div className="text-xs text-muted-foreground">
                          {batches.filter(b => b.productName === p).reduce((sum, b) => sum + (b.availableQty || 0), 0)} available in stock
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label>Batch No</Label>
              {productName ? (
                <Select value={batchNo} onValueChange={setBatchNo} disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Batch" />
                  </SelectTrigger>
                  <SelectContent>
                    {currentProductBatches.map(b => {
                      const batchVal = b.batchNumber || "0";
                      return (
                        <SelectItem key={b.id} value={batchVal}>
                          {batchVal} (Avail: {b.availableQty})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <Input disabled placeholder="Select product first" />
              )}
            </div>
            <div>
              <Label>Return Quantity *</Label>
              <Input ref={qtyInputRef} type="number" value={quantity || ""} onChange={e => setQuantity(Number(e.target.value))} min={1} />
            </div>
            <div className="sm:col-span-4">
              <Label>Notes</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for return, condition, etc." />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSubmit}>
              <Plus className="mr-2 h-4 w-4" /> Save Return
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Return History</h2>
        <Button variant="outline" size="sm" onClick={() => exportCSV(filteredReturns as any, `sales-returns-${new Date().toISOString().slice(0, 10)}.csv`)}>
          <Download className="mr-1 h-4 w-4" /> Export
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
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
                  <TableRow><TableCell colSpan={9} className="border-2 border-slate-300 text-center text-muted-foreground py-8">No sales returns yet</TableCell></TableRow>
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
    </div>
  );
}
