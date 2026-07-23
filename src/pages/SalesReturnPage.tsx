import { useEffect, useMemo, useRef, useState } from "react";
import { addSalesReturn, getClients, getSalesReturns, getBatches, SaleReturn, Client, StockBatch, exportCSV } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Download, Plus } from "lucide-react";
import { format } from "date-fns";

const PRICE_CATEGORIES = ['Regular', 'Premium', 'Only Cash'];

export default function SalesReturnPage() {
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [priceCategory, setPriceCategory] = useState("Regular");
  const [receiveDate, setReceiveDate] = useState(new Date().toISOString().slice(0, 10));
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
  const receiveDateInputRef = useRef<HTMLInputElement>(null);

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
    setReceiveDate(new Date().toISOString().slice(0, 10));
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
              <Input ref={receiveDateInputRef} type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Product Name *</Label>
              <div className="relative">
                <Input
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
                <Select value={batchNo} onValueChange={setBatchNo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Batch" />
                  </SelectTrigger>
                  <SelectContent>
                    {currentProductBatches.map(b => (
                      <SelectItem key={b.id} value={b.batchNumber}>
                        {b.batchNumber} (Avail: {b.availableQty})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input disabled placeholder="Select product first" />
              )}
            </div>
            <div>
              <Label>Return Quantity *</Label>
              <Input type="number" value={quantity || ""} onChange={e => setQuantity(Number(e.target.value))} min={1} />
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Price Category</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Receive Date</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReturns.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No sales returns yet</TableCell></TableRow>
              ) : filteredReturns.map(item => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.clientName}</TableCell>
                  <TableCell>{item.clientPhone || "-"}</TableCell>
                  <TableCell>{item.priceCategory || "-"}</TableCell>
                  <TableCell>{item.productName}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell>{item.batchNo || "-"}</TableCell>
                  <TableCell>{item.receiveDate ? format(new Date(item.receiveDate), 'dd-MM-yyyy') : "-"}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={item.notes}>{item.notes || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
