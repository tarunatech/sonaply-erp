import { useState, useEffect, useMemo } from "react";
import { 
  getSales, getPurchases, getBatches, exportCSV, 
  deleteSale, deletePurchase, deleteBatch, getSalesReturns,
  getChallans, StockBatch, Sale, Purchase, SaleReturn, Challan, getLocalDateString
} from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Search, RefreshCw, Layers, Eye, Trash2, Filter } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface LedgerTransaction {
  id: string;
  date: string;
  type: 'Addition' | 'Subtraction';
  qty: number;
  description: string;
  source: 'purchase' | 'batch' | 'sale' | 'sales_return' | 'challan_cancel' | 'delivered_challan';
  isNil?: boolean;
  isCancelled?: boolean;
  isDeadStock?: boolean;
}

export default function DailyExport() {
  const { toast } = useToast();

  // Daily Export State (single date for daily sales, purchases, stock exports)
  const [date, setDate] = useState(getLocalDateString());

  // Stock Ledger Date Range States (for user selection)
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return getLocalDateString(d);
  });
  const [toDate, setToDate] = useState(() => getLocalDateString());

  // Applied Date Range States for Stock Ledger
  const [appliedFromDate, setAppliedFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return getLocalDateString(d);
  });
  const [appliedToDate, setAppliedToDate] = useState(() => getLocalDateString());

  const [searchQuery, setSearchQuery] = useState("");

  // DB States
  const [allBatches, setAllBatches] = useState<StockBatch[]>([]);
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [allPurchases, setAllPurchases] = useState<Purchase[]>([]);
  const [allSalesReturns, setAllSalesReturns] = useState<SaleReturn[]>([]);
  const [allChallans, setAllChallans] = useState<Challan[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modal State for viewing specific product's transactions
  const [activeLedgerProduct, setActiveLedgerProduct] = useState<string | null>(null);

  const loadLedgerData = async () => {
    setIsLoading(true);
    try {
      const [b, s, p, r, c] = await Promise.all([
        getBatches(), 
        getSales(), 
        getPurchases(), 
        getSalesReturns(),
        getChallans()
      ]);
      setAllBatches(b);
      setAllSales(s);
      setAllPurchases(p);
      setAllSalesReturns(r);
      setAllChallans(c);
    } catch (e) {
      console.error("Failed to load export data", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLedgerData();
  }, []);

  const handleApplyLedgerFilter = () => {
    setAppliedFromDate(fromDate);
    setAppliedToDate(toDate);
    toast({
      title: "Stock Ledger Filtered",
      description: `Showing ledger records from ${fromDate} to ${toDate}`,
    });
  };

  const doExport = async (type: string) => {
    const d = date;
    let data: any[] = [];
    const batches = await getBatches();

    switch (type) {
      case 'sales': {
        const rawSales = (await getSales()).filter(s => s.orderDate === d);
        data = rawSales.map(s => {
          const matchingBatch = batches.find(b => b.productName === s.product || (s.batchNo && b.batchNumber === s.batchNo));
          const description = s.description || s.remarks || matchingBatch?.description || "";
          const isCancelled = s.status === 'Cancelled' || matchingBatch?.isCancelled || false;
          const isNil = !isCancelled && (s.orderedQty === 0 || matchingBatch?.isNil || false);
          const isDeadStock = matchingBatch?.isDeadStock || false;
          const status = isCancelled ? 'Dead Stock' : isNil ? 'Not next Folder' : isDeadStock ? 'Nil' : s.status;
          return {
            "Order No": s.orderNo,
            "Customer": s.customer,
            "Phone": s.clientPhone || "",
            "Product": s.product,
            "Category": s.category,
            "Description": description,
            "Ordered Qty": s.orderedQty,
            "Delivered Qty": s.deliveredQty || 0,
            "Pending Qty": s.pendingQty || 0,
            "Rate": s.rate || 0,
            "GST (%)": s.GST || 0,
            "Total Price": s.totalPrice || 0,
            "Stock Category": s.stockCategory || "Available",
            "Is Not next Folder": isNil ? "Yes" : "No",
            "Is Dead Stock": isCancelled ? "Yes" : "No",
            "Is Nil": isDeadStock ? "Yes" : "No",
            "Status": status,
            "Order Date": s.orderDate
          };
        });
        break;
      }
      case 'purchases': {
        const rawPurchases = (await getPurchases()).filter(p => p.date === d);
        data = rawPurchases.map(p => {
          const matchingBatch = batches.find(b => (b.productName === p.productName && b.batchNumber === p.batchNumber) || b.batchNumber === p.batchNumber);
          const description = p.description || matchingBatch?.description || "";
          const isCancelled = matchingBatch?.isCancelled || false;
          const isNil = p.quantity === 0 || matchingBatch?.isNil || false;
          const isDeadStock = matchingBatch?.isDeadStock || false;
          const status = isCancelled ? 'Dead Stock' : isNil ? 'Not next Folder' : isDeadStock ? 'Nil' : 'Active';
          return {
            "Date": p.date,
            "Supplier Name": p.supplierName,
            "Supplier Phone": p.supplierPhone || "",
            "Product Name": p.productName,
            "Category": p.category,
            "Batch Number": p.batchNumber,
            "Quantity": p.quantity,
            "Rate": p.rate || 0,
            "Total Amount": p.totalAmount || 0,
            "Description": description,
            "Is Not next Folder": isNil ? "Yes" : "No",
            "Is Dead Stock": isCancelled ? "Yes" : "No",
            "Is Nil": isDeadStock ? "Yes" : "No",
            "Status": status
          };
        });
        break;
      }
      case 'stock': {
        const rawBatches = batches.filter(b => b.date === d);
        data = rawBatches.map(b => {
          const isCancelled = b.isCancelled || false;
          const isNil = b.isNil || b.availableQty === 0 || false;
          const isDeadStock = b.isDeadStock || false;
          const status = isCancelled ? 'Dead Stock' : isNil ? 'Not next Folder' : isDeadStock ? 'Nil' : 'Active';
          return {
            "Date": b.date,
            "Product Name": b.productName,
            "Category": b.category,
            "Batch Number": b.batchNumber,
            "Supplier": b.supplier,
            "Quantity": b.quantity,
            "Available Qty": b.availableQty || 0,
            "Display Qty": b.displayQty || 0,
            "Damage Qty": b.damageQty || 0,
            "Description": b.description || "",
            "Is Not next Folder": isNil ? "Yes" : "No",
            "Is Dead Stock": isCancelled ? "Yes" : "No",
            "Is Nil": isDeadStock ? "Yes" : "No",
            "Status": status
          };
        });
        break;
      }
    }
    if (!data.length) { alert(`No data available for date: ${d}`); return; }
    exportCSV(data, `daily-${type}-${d}.csv`);
  };

  // Compile transactions and ledger dynamically based on appliedFromDate & appliedToDate
  const ledgerData = useMemo(() => {
    const productNames = new Set<string>();
    allBatches.forEach(b => { if (b.productName) productNames.add(b.productName); });
    allSales.forEach(s => { if (s.product) productNames.add(s.product); });
    allPurchases.forEach(p => { if (p.productName) productNames.add(p.productName); });

    const getProductCategory = (name: string): string => {
      const b = allBatches.find(x => x.productName === name);
      if (b) return b.category;
      const p = allPurchases.find(x => x.productName === name);
      if (p) return p.category;
      const s = allSales.find(x => x.product === name);
      if (s) return s.category;
      return "Other";
    };

    return Array.from(productNames).map(productName => {
      const category = getProductCategory(productName);
      const transactions: LedgerTransaction[] = [];
      const productBatches = allBatches.filter(b => b.productName === productName);
      const isProductDeadStock = productBatches.some(b => b.isDeadStock);
      const isProductCancelled = !isProductDeadStock && productBatches.some(b => b.isCancelled);
      const isProductNil = !isProductDeadStock && !isProductCancelled && productBatches.some(b => b.isNil);

      // A. Purchases (Stock Addition)
      allPurchases.forEach(p => {
        if (p.productName === productName && p.date >= appliedFromDate && p.date <= appliedToDate) {
          const matchingBatch = allBatches.find(b => b.productName === p.productName && b.batchNumber === p.batchNumber);
          const desc = p.description || matchingBatch?.description || "";
          const isNil = p.quantity === 0 || matchingBatch?.isNil || false;
          const isCancelled = matchingBatch?.isCancelled || false;
          const isDeadStock = matchingBatch?.isDeadStock || false;
          const statusStr = isCancelled ? " [Dead Stock]" : isNil ? " [Not next Folder]" : isDeadStock ? " [Nil]" : "";
          transactions.push({
            id: p.id,
            date: p.date,
            type: 'Addition',
            qty: p.quantity,
            description: `Purchase (Supplier: ${p.supplierName}, Batch: ${p.batchNumber}${statusStr}${desc ? `, Desc: ${desc}` : ''})`,
            source: 'purchase',
            isNil,
            isCancelled,
            isDeadStock
          });
        }
      });

      // B. Manual Batches / Initial Stock (Stock Addition)
      allBatches.forEach(b => {
        if (b.productName === productName && b.date >= appliedFromDate && b.date <= appliedToDate) {
          // Avoid double counting if this batch was created from a purchase
          const hasPurchase = allPurchases.some(p => p.productName === b.productName && p.batchNumber === b.batchNumber);
          if (!hasPurchase) {
            const desc = b.description || "";
            const isNil = b.isNil || b.availableQty === 0 || false;
            const isCancelled = b.isCancelled || false;
            const isDeadStock = b.isDeadStock || false;
            const statusStr = isCancelled ? " [Dead Stock]" : isNil ? " [Not next Folder]" : isDeadStock ? " [Nil]" : "";
            transactions.push({
              id: b.id,
              date: b.date,
              type: 'Addition',
              qty: b.quantity,
              description: `Initial Stock / Manual Entry (Batch: ${b.batchNumber}, Supplier: ${b.supplier}${statusStr}${desc ? `, Desc: ${desc}` : ''})`,
              source: 'batch',
              isNil,
              isCancelled,
              isDeadStock
            });
          }
        }
      });

      // C. Sales Recorded (Stock Subtraction) & Cancellations (Stock Addition)
      allSales.forEach(s => {
        if (s.product === productName) {
          const matchingBatch = allBatches.find(b => b.productName === s.product || (s.batchNo && b.batchNumber === s.batchNo));
          const desc = s.description || s.remarks || matchingBatch?.description || "";
          const isCancelled = s.status === 'Cancelled' || matchingBatch?.isCancelled || false;
          const isNil = !isCancelled && (s.orderedQty === 0 || matchingBatch?.isNil || false);
          const isDeadStock = matchingBatch?.isDeadStock || false;
          const orderStatus = isCancelled ? 'Dead Stock' : isNil ? 'Not next Folder' : isDeadStock ? 'Nil' : s.status;

          // 1. Record the sale subtraction
          if (s.orderDate >= appliedFromDate && s.orderDate <= appliedToDate) {
            transactions.push({
              id: s.id,
              date: s.orderDate,
              type: 'Subtraction',
              qty: s.orderedQty,
              description: `Sale Recorded (Order: ${s.orderNo}, Customer: ${s.customer}, Batch: ${s.batchNo || '0'}, Status: ${orderStatus}${desc ? `, Desc: ${desc}` : ''})`,
              source: 'sale',
              isNil,
              isCancelled,
              isDeadStock
            });
          }
          // 2. If cancelled, record the cancellation addition
          if (s.status === 'Cancelled') {
            const cancelDate = s.updatedAt ? s.updatedAt.slice(0, 10) : s.orderDate;
            if (cancelDate >= appliedFromDate && cancelDate <= appliedToDate) {
              transactions.push({
                id: `${s.id}-cancel`,
                date: cancelDate,
                type: 'Addition',
                qty: s.orderedQty,
                description: `Sale Cancelled / Restored (Order: ${s.orderNo}, Customer: ${s.customer}, Status: Cancelled${desc ? `, Desc: ${desc}` : ''})`,
                source: 'challan_cancel',
                isCancelled: true
              });
            }
          }
        }
      });

      // D. Sales Returns (Stock Addition)
      allSalesReturns.forEach(r => {
        if (r.productName === productName && r.receiveDate >= appliedFromDate && r.receiveDate <= appliedToDate) {
          transactions.push({
            id: r.id,
            date: r.receiveDate,
            type: 'Addition',
            qty: r.quantity,
            description: `Sales Return (Client: ${r.clientName}, Batch: ${r.batchNo || 'N/A'}, Notes: ${r.notes || ''})`,
            source: 'sales_return'
          });
        }
      });

      // Sort chronologically
      transactions.sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateA - dateB;
      });

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

      // Current total physical stock (Available + Display + Damage)
      const currentAvailable = allBatches
        .filter(b => b.productName === productName)
        .reduce((sum, b) => sum + (b.availableQty || 0) + (b.displayQty || 0) + (b.damageQty || 0), 0);

      const details = transactions
        .map(t => `[${t.date}] ${t.qty}${t.type === 'Addition' ? '+' : '-'} (${t.description})`)
        .join('; ');

      return {
        productName,
        category,
        isDeadStock: isProductDeadStock,
        isNil: isProductNil,
        isCancelled: isProductCancelled,
        currentAvailable,
        totalAdditions,
        totalSubtractions,
        netChange: totalAdditions - totalSubtractions,
        sequence: sequence || '-',
        details: details || 'No transactions in range',
        transactions
      };
    }).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [allBatches, allSales, allPurchases, allSalesReturns, allChallans, appliedFromDate, appliedToDate]);

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
    if (!filteredLedger.length) {
      alert("No data available to export.");
      return;
    }
    const formatted = filteredLedger.map(item => ({
      "Product Name": item.productName,
      "Category": item.category,
      "Is Not next Folder": item.isNil ? "Yes" : "No",
      "Is Dead Stock": item.isCancelled ? "Yes" : "No",
      "Is Nil": item.isDeadStock ? "Yes" : "No",
      "Status": item.isDeadStock ? "Nil" : item.isCancelled ? "Dead Stock" : item.isNil ? "Not next Folder" : "Active",
      "Current Available Stock": item.currentAvailable,
      "Total Additions (+)": item.totalAdditions,
      "Total Subtractions (-)": item.totalSubtractions,
      "Net Change": item.netChange,
      "Transaction Sequence": item.sequence,
      "Detailed History": item.details
    }));
    exportCSV(formatted as any[], `stock-ledger-totals-${appliedFromDate}-to-${appliedToDate}.csv`);
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {exports.map(e => (
              <Card key={e.key} className="bg-accent/10 border-accent/20">
                <CardHeader className="pb-2"><CardTitle className="text-base">{e.title}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">{e.desc}</p>
                  <Button variant="outline" size="sm" onClick={() => doExport(e.key)} className="w-full">
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="border-t my-6" />

      {/* Date Range Stock Ledger & Totals Section */}
      <Card className="border-2 border-primary/20 shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <Layers className="h-5 w-5" />
            <CardTitle>Date Range Stock Ledger & Totals</CardTitle>
          </div>
          <CardDescription>
            Compute chronological additions (+), subtractions (-), net changes, and current available stocks for all products within a custom date range. Enter Start Date & End Date, then click <strong>Filter</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-end gap-4 p-4 bg-muted/30 rounded-lg border">
            <div className="space-y-1.5 flex-1 min-w-[140px]">
              <Label className="font-semibold text-slate-800">From Date</Label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[140px]">
              <Label className="font-semibold text-slate-800">To Date</Label>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <Button 
              onClick={handleApplyLedgerFilter} 
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 shadow-sm gap-2"
            >
              <Filter className="h-4 w-4" /> Filter
            </Button>
            <div className="space-y-1.5 flex-1 min-w-[180px] relative">
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

          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>
              Showing Stock Ledger from: <strong className="text-slate-900 font-mono">{appliedFromDate}</strong> to <strong className="text-slate-900 font-mono">{appliedToDate}</strong>
            </span>
            {(appliedFromDate !== fromDate || appliedToDate !== toDate) && (
              <span className="text-amber-700 font-semibold animate-pulse">
                ⚠️ Click "Filter" to apply selected dates
              </span>
            )}
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
                      <TableRow 
                        key={item.productName} 
                        className={`transition-colors ${
                          item.isDeadStock
                            ? "bg-slate-400/90 text-slate-900 hover:bg-slate-500/90 border-slate-300"
                            : item.isCancelled 
                            ? "bg-red-200/90 text-red-950 hover:bg-red-300/90 border-red-300" 
                            : item.isNil 
                            ? "bg-blue-200/90 text-blue-950 hover:bg-blue-300/90 border-blue-300" 
                            : "hover:bg-slate-50/50"
                        }`}
                      >
                        <TableCell className={`font-semibold ${item.isCancelled ? "text-red-950" : item.isNil ? "text-blue-950" : "text-slate-800"}`}>
                          <div className="flex items-center gap-2">
                            <span>{item.productName}</span>
                            {/* {item.isCancelled && !item.isDeadStock && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-200 text-red-950 border border-red-400 shadow-2xs">
                                Cancelled
                              </span>
                            )} */}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.category}</TableCell>
                        <TableCell className="text-center">
                          <span className="font-mono text-xs px-2 py-1 rounded border inline-block max-w-[150px] truncate bg-slate-100 border-slate-200 text-slate-700" title={item.sequence}>
                            {item.sequence}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium font-mono text-green-600">+{item.totalAdditions}</TableCell>
                        <TableCell className="text-right font-medium font-mono text-red-600">-{item.totalSubtractions}</TableCell>
                        <TableCell className={`text-right font-bold font-mono ${item.netChange > 0 ? 'text-green-600' : item.netChange < 0 ? 'text-red-600' : 'text-slate-600'}`}>
                          {item.netChange > 0 ? `+${item.netChange}` : item.netChange}
                        </TableCell>
                        <TableCell className="text-right font-black font-mono text-sm bg-blue-50/50 text-blue-700">
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
                    selectedProductLedger.transactions.map((t) => {
                      const isCanc = t.isCancelled || t.description.includes("[Dead Stock]") || t.description.includes("Status: Dead Stock");
                      const isNilItem = t.isNil || t.description.includes("[Not next Folder]") || t.description.includes("Status: Not next Folder");
                      const isDeadItem = t.isDeadStock || t.description.includes("[Nil]") || t.description.includes("Status: Nil");
                      return (
                        <TableRow 
                          key={t.id} 
                          className={`transition-colors ${
                            isCanc 
                              ? "bg-red-50/80 hover:bg-red-100/80" 
                              : isNilItem 
                              ? "bg-blue-50/80 hover:bg-blue-100/80" 
                              : isDeadItem
                              ? "bg-slate-100/80 hover:bg-slate-200/80"
                              : "hover:bg-muted/10"
                          }`}
                        >
                          <TableCell className="text-xs font-medium font-mono">{t.date}</TableCell>
                          <TableCell className="text-center font-mono font-bold">
                            <span className={`px-2 py-0.5 rounded text-xs ${t.type === 'Addition' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
                              {t.type === 'Addition' ? `+${t.qty}` : `-${t.qty}`}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs leading-snug">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isCanc && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-800 border border-red-200">
                                  Dead Stock
                                </span>
                              )}
                              {isNilItem && !isCanc && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-800 border border-blue-200">
                                  Not next Folder
                                </span>
                              )}
                              {isDeadItem && !isCanc && !isNilItem && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-200 text-slate-800 border border-slate-300">
                                  Nil
                                </span>
                              )}
                              <span className={isCanc ? "text-red-950 font-medium" : isNilItem ? "text-blue-950 font-medium" : isDeadItem ? "text-slate-900 font-medium" : "text-slate-700"}>
                                {t.description}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {t.source === 'purchase' || t.source === 'batch' ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-red-700 hover:bg-red-50"
                                onClick={() => handleDeleteTransaction(t)}
                                title="Delete Transaction & Revert Stock"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic px-2">System-locked</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
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
