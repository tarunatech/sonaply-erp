import { useState, useEffect, useMemo } from "react";
import { 
  getSales, getPurchases, getBatches, getOrders, exportCSV, 
  deleteSale, deletePurchase, deleteBatch, 
  StockBatch, Sale, Purchase 
} from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Search, RefreshCw, Layers, Eye, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface LedgerTransaction {
  id: string;
  date: string;
  type: 'Addition' | 'Subtraction';
  qty: number;
  description: string;
  source: 'purchase' | 'batch' | 'sale';
}

export default function DailyExport() {
  const { toast } = useToast();

  // Daily Export State
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  // Date Range Ledger States
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [searchQuery, setSearchQuery] = useState("");

  // DB States
  const [allBatches, setAllBatches] = useState<StockBatch[]>([]);
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [allPurchases, setAllPurchases] = useState<Purchase[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modal State for viewing specific product's transactions
  const [activeLedgerProduct, setActiveLedgerProduct] = useState<string | null>(null);

  const loadLedgerData = async () => {
    setIsLoading(true);
    try {
      const [b, s, p] = await Promise.all([getBatches(), getSales(), getPurchases()]);
      setAllBatches(b);
      setAllSales(s);
      setAllPurchases(p);
    } catch (e) {
      console.error("Failed to load export data", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLedgerData();
  }, []);

  const doExport = async (type: string) => {
    const d = date;
    let data: any[] = [];
    switch (type) {
      case 'sales': data = (await getSales()).filter(s => s.orderDate === d); break;
      case 'purchases': data = (await getPurchases()).filter(p => p.date === d); break;
      case 'stock': data = (await getBatches()).filter(b => b.date === d); break;
      case 'orders': data = (await getOrders()).filter(o => o.orderDate === d); break;
    }
    if (!data.length) { alert('No data for this date'); return; }
    exportCSV(data, `daily-${type}-${d}.csv`);
  };

  // Compile transactions and ledger dynamically
  const ledgerData = useMemo(() => {
    const productNames = new Set<string>();
    allBatches.forEach(b => { if (b.productName) productNames.add(b.productName); });
    allSales.forEach(s => { if (s.productName) productNames.add(s.productName); });
    allPurchases.forEach(p => { if (p.productName) productNames.add(p.productName); });

    const getProductCategory = (name: string): string => {
      const b = allBatches.find(x => x.productName === name);
      if (b) return b.category;
      const p = allPurchases.find(x => x.productName === name);
      if (p) return p.category;
      const s = allSales.find(x => x.productName === name);
      if (s) return s.category;
      return "Other";
    };

    return Array.from(productNames).map(productName => {
      const category = getProductCategory(productName);
      const transactions: LedgerTransaction[] = [];

      // A. Purchases (Stock Addition)
      allPurchases.forEach(p => {
        if (p.productName === productName && p.date >= fromDate && p.date <= toDate) {
          transactions.push({
            id: p.id,
            date: p.date,
            type: 'Addition',
            qty: p.quantity,
            description: `Purchase (Supplier: ${p.supplierName}, Batch: ${p.batchNumber})`,
            source: 'purchase'
          });
        }
      });

      // B. Manual Batches / Initial Stock (Stock Addition)
      allBatches.forEach(b => {
        if (b.productName === productName && b.date >= fromDate && b.date <= toDate) {
          // Avoid double counting if this batch was created from a purchase
          const hasPurchase = allPurchases.some(p => p.productName === b.productName && p.batchNumber === b.batchNumber && p.date === b.date);
          if (!hasPurchase) {
            transactions.push({
              id: b.id,
              date: b.date,
              type: 'Addition',
              qty: b.quantity,
              description: `Initial Stock / Manual Entry (Batch: ${b.batchNumber}, Supplier: ${b.supplier})`,
              source: 'batch'
            });
          }
        }
      });

      // C. Sales (Stock Subtraction)
      allSales.forEach(s => {
        if (s.productName === productName && s.orderDate >= fromDate && s.orderDate <= toDate) {
          transactions.push({
            id: s.id,
            date: s.orderDate,
            type: 'Subtraction',
            qty: s.quantity,
            description: `Sale (Client: ${s.clientName}, Batch: ${s.batchNo || 'N/A'})`,
            source: 'sale'
          });
        }
      });

      // Sort chronologically
      transactions.sort((a, b) => a.date.localeCompare(b.date));

      let totalAdditions = 0;
      let totalSubtractions = 0;
      transactions.forEach(t => {
        if (t.type === 'Addition') {
          totalAdditions += t.qty;
        } else {
          totalSubtractions += t.qty;
        }
      });

      // Format sequence like "2+ 5- 4+"
      const sequence = transactions.map(t => `${t.qty}${t.type === 'Addition' ? '+' : '-'}`).join(' ');

      // Current total available stock
      const currentAvailable = allBatches
        .filter(b => b.productName === productName)
        .reduce((sum, b) => sum + (b.availableQty || 0), 0);

      const details = transactions
        .map(t => `[${t.date}] ${t.qty}${t.type === 'Addition' ? '+' : '-'} (${t.description})`)
        .join('; ');

      return {
        productName,
        category,
        currentAvailable,
        totalAdditions,
        totalSubtractions,
        netChange: totalAdditions - totalSubtractions,
        sequence: sequence || '-',
        details: details || 'No transactions in range',
        transactions
      };
    }).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [allBatches, allSales, allPurchases, fromDate, toDate]);

  // Filtered ledger data for live search preview
  const filteredLedger = useMemo(() => {
    if (!searchQuery) return ledgerData;
    const q = searchQuery.toLowerCase();
    return ledgerData.filter(item => 
      item.productName.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  }, [ledgerData, searchQuery]);

  // Find the selected product's calculated details live so modal stays synced after deletes
  const selectedProductLedger = useMemo(() => {
    if (!activeLedgerProduct) return null;
    return ledgerData.find(item => item.productName === activeLedgerProduct) || null;
  }, [ledgerData, activeLedgerProduct]);

  const handleExportLedger = () => {
    if (!ledgerData.length) {
      alert("No data available to export.");
      return;
    }
    const formatted = ledgerData.map(item => ({
      "Product Name": item.productName,
      "Category": item.category,
      "Current Available Stock": item.currentAvailable,
      "Total Additions (+)": item.totalAdditions,
      "Total Subtractions (-)": item.totalSubtractions,
      "Net Change": item.netChange,
      "Transaction Sequence": item.sequence,
      "Detailed History": item.details
    }));
    exportCSV(formatted as any[], `stock-ledger-totals-${fromDate}-to-${toDate}.csv`);
  };

  // Revert and delete a single transaction from the ledger
  const handleDeleteTransaction = async (t: LedgerTransaction) => {
    const password = window.prompt("Please enter admin password to delete this transaction:");
    if (password !== 'admin') {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }

    const typeStr = t.type === 'Addition' ? 'Stock Addition' : 'Stock Subtraction';
    if (window.confirm(`Are you sure you want to delete this transaction?\n[${t.date}] - ${typeStr}: ${t.qty} units\nDescription: "${t.description}"\n\nThis will permanently update/revert stock values.`)) {
      try {
        if (t.source === 'purchase') {
          await deletePurchase(t.id);
        } else if (t.source === 'sale') {
          await deleteSale(t.id);
        } else if (t.source === 'batch') {
          await deleteBatch(t.id);
        }
        
        toast({ title: "Transaction Deleted", description: "The transaction record has been removed and stock reverted." });
        await loadLedgerData();
      } catch (err: any) {
        toast({ title: "Failed to Delete", description: err.message, variant: "destructive" });
      }
    }
  };

  const exports = [
    { key: 'sales', title: 'Daily Sales', desc: 'Export all sales for the selected date' },
    { key: 'purchases', title: 'Daily Purchases', desc: 'Export all purchases for the selected date' },
    { key: 'stock', title: 'Daily Stock Updates', desc: 'Export stock entries for the selected date' },
    { key: 'orders', title: 'Daily Orders', desc: 'Export all orders for the selected date' },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Daily Export</h1>
        <Button variant="ghost" size="icon" onClick={loadLedgerData} disabled={isLoading} title="Reload Data">
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="w-48">
            <Label>Select Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {exports.map(e => (
              <Card key={e.key} className="bg-accent/10 border-accent/20">
                <CardHeader className="pb-2"><CardTitle className="text-base">{e.title}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">{e.desc}</p>
                  <Button variant="outline" size="sm" onClick={() => doExport(e.key)}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="border-t my-6" />

      {/* Date Range Ledger & Totals Section */}
      <Card className="border-2 border-primary/20 shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <Layers className="h-5 w-5" />
            <CardTitle>Date Range Stock Ledger & Totals</CardTitle>
          </div>
          <CardDescription>
            Compute chronological additions (+), subtractions (-), net changes, and current available stocks for all products within a custom date range.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-4 p-4 bg-muted/30 rounded-lg border">
            <div className="space-y-1.5 flex-1 min-w-[150px]">
              <Label>From Date</Label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[150px]">
              <Label>To Date</Label>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[200px] relative">
              <Label>Search Product</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Filter preview..." 
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)} 
                  className="pl-8"
                />
              </div>
            </div>
            <Button onClick={handleExportLedger} className="w-full sm:w-auto bg-primary hover:bg-primary/95 text-primary-foreground font-semibold shadow-sm">
              <Download className="mr-2 h-4 w-4" /> Export Ledger Totals
            </Button>
          </div>

          {/* Interactive Preview Table */}
          <div className="border rounded-md">
            <div className="max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-center font-bold">Stock Sequence</TableHead>
                    <TableHead className="text-right text-success-700">Add (+)</TableHead>
                    <TableHead className="text-right text-destructive-700">Sub (-)</TableHead>
                    <TableHead className="text-right">Net Change</TableHead>
                    <TableHead className="text-right font-black">Current Stock</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        Loading transaction data...
                      </TableCell>
                    </TableRow>
                  ) : filteredLedger.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No product matches found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLedger.map((item) => (
                      <TableRow key={item.productName} className="hover:bg-muted/20">
                        <TableCell className="font-semibold">{item.productName}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{item.category}</TableCell>
                        <TableCell className="text-center">
                          <span className="font-mono text-xs bg-muted px-2 py-1 rounded border inline-block max-w-[150px] truncate" title={item.sequence}>
                            {item.sequence}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-green-600 font-medium font-mono">+{item.totalAdditions}</TableCell>
                        <TableCell className="text-right text-red-600 font-medium font-mono">-{item.totalSubtractions}</TableCell>
                        <TableCell className={`text-right font-bold font-mono ${item.netChange > 0 ? 'text-green-600' : item.netChange < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {item.netChange > 0 ? `+${item.netChange}` : item.netChange}
                        </TableCell>
                        <TableCell className="text-right font-black text-blue-700 font-mono text-sm bg-blue-50/30">
                          {item.currentAvailable}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 text-primary hover:bg-primary/10 gap-1"
                            onClick={() => setActiveLedgerProduct(item.productName)}
                          >
                            <Eye className="h-4 w-4" /> View / Clean
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="p-2.5 bg-muted/20 text-xs text-muted-foreground border-t text-right">
              Showing {filteredLedger.length} of {ledgerData.length} unique products
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transaction History & Cleaning Dialog */}
      <Dialog open={!!activeLedgerProduct} onOpenChange={(open) => !open && setActiveLedgerProduct(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Transaction Ledger: {selectedProductLedger?.productName}
            </DialogTitle>
            <DialogDescription>
              Chronological log of transactions in the selected date range. Revert incorrect entries securely using the red delete buttons.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-2 text-xs bg-muted/50 p-2.5 rounded border">
              <div><span className="font-bold">Total Additions:</span> <span className="font-mono text-green-600 font-bold">+{selectedProductLedger?.totalAdditions}</span></div>
              <div><span className="font-bold">Total Subtractions:</span> <span className="font-mono text-red-600 font-bold">-{selectedProductLedger?.totalSubtractions}</span></div>
              <div><span className="font-bold">Current Stock:</span> <span className="font-mono text-blue-700 font-bold">{selectedProductLedger?.currentAvailable}</span></div>
            </div>

            <div className="border rounded-md max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader className="bg-muted/30 sticky top-0">
                  <TableRow>
                    <TableHead className="w-24">Date</TableHead>
                    <TableHead className="w-24 text-center">Change</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right w-16">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!selectedProductLedger?.transactions.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                        No transactions found inside this date range
                      </TableCell>
                    </TableRow>
                  ) : (
                    selectedProductLedger.transactions.map((t) => (
                      <TableRow key={t.id} className="hover:bg-muted/10">
                        <TableCell className="text-xs font-medium font-mono">{t.date}</TableCell>
                        <TableCell className="text-center font-mono font-bold">
                          <span className={`px-2 py-0.5 rounded text-xs ${t.type === 'Addition' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {t.type === 'Addition' ? `+${t.qty}` : `-${t.qty}`}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground leading-snug">
                          {t.description}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteTransaction(t)}
                            title="Delete Transaction & Revert Stock"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
