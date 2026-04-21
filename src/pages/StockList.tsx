import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getBatches, getOrders, exportCSV, deleteBatch, updateBatch, StockBatch } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
// Removed Select imports
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, Download, Printer, Plus, ClipboardList, Pencil, Trash2 } from "lucide-react";

export default function StockList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [showLowStock, setShowLowStock] = useState(searchParams.get("filter") === "lowStock");
  const [allBatches, setAllBatches] = useState<StockBatch[]>([]);
  const [editingBatch, setEditingBatch] = useState<StockBatch | null>(null);

  useEffect(() => {
    setAllBatches(getBatches());
  }, []);

  const pendingOrders = useMemo(() => {
    return getOrders().filter(o => o.status === 'Pending');
  }, []);

  const batches = useMemo(() => {
    let b = allBatches;
    if (showLowStock) b = b.filter(i => i.availableQty < 10);
    if (search) b = b.filter(i => i.productName.toLowerCase().includes(search.toLowerCase()) || i.batchNumber.toLowerCase().includes(search.toLowerCase()));
    return b;
  }, [allBatches, search, showLowStock]);

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this stock batch?")) {
      deleteBatch(id);
      setAllBatches(getBatches());
    }
  };

  const handleEditSave = () => {
    if (editingBatch) {
      updateBatch(editingBatch.id, editingBatch);
      setAllBatches(getBatches());
      setEditingBatch(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <h1 className="text-2xl font-bold">Stock List</h1>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm">
                <ClipboardList className="mr-1 h-4 w-4" /> Pending Items
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Pending Orders</DialogTitle>
              </DialogHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingOrders.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No pending items.</TableCell></TableRow>
                  ) : pendingOrders.map(o => (
                    <TableRow key={o.id}>
                      <TableCell>{o.orderNumber}</TableCell>
                      <TableCell>{o.clientName}</TableCell>
                      <TableCell className="font-medium">{o.productName}</TableCell>
                      <TableCell className="text-right font-semibold text-orange-600">{o.quantity}</TableCell>
                      <TableCell>{o.orderDate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DialogContent>
          </Dialog>
          <Button onClick={() => navigate('/stock-entry')} size="sm">
            <Plus className="mr-1 h-4 w-4" /> Add Items
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            let csvContent = "";
            
            const brands: Record<string, Record<string, any[]>> = {};
            batches.forEach(b => {
              let brand = "UNKNOWN";
              let prefix = "Other";
              let suffix = b.productName;

              // Parse from productName as default
              const nameParts = b.productName.trim().split(/\s+/);
              if (nameParts.length >= 3) {
                brand = nameParts[0];
                prefix = nameParts[1];
                suffix = nameParts.slice(2).join(' ');
              } else if (nameParts.length === 2) {
                prefix = nameParts[0];
                suffix = nameParts[1];
              }
              
              if (b.supplier) brand = b.supplier;
              
              // Override with productCode if it exists
              if (b.productCode && b.productCode.trim() !== "") {
                 const codeParts = b.productCode.trim().split(/\s+/);
                 if (codeParts.length > 1) {
                   prefix = codeParts[0];
                   suffix = codeParts.slice(1).join(' ');
                 } else {
                   const match = b.productCode.trim().match(/^([a-zA-Z]+)(.*)$/);
                   if (match) {
                     prefix = match[1];
                     suffix = match[2];
                   } else {
                     suffix = b.productCode;
                   }
                 }
              }
              
              const item = { ...b, parsedSuffix: suffix };
              
              if (!brands[brand]) brands[brand] = {};
              if (!brands[brand][prefix]) brands[brand][prefix] = [];
              brands[brand][prefix].push(item);
            });

            for (const [brand, prefixes] of Object.entries(brands)) {
              csvContent += `Brand: ${brand},,,,,,\n`;
              csvContent += `Product Name,Product Number,Date,Quantity,Available,Nil,Damaged\n`;
              
              const sortedPrefixes = Object.keys(prefixes).sort();
              for (const prefix of sortedPrefixes) {
                 const items = prefixes[prefix];
                 
                 items.sort((a, b) => {
                   const numA = parseInt(a.parsedSuffix);
                   const numB = parseInt(b.parsedSuffix);
                   if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                   return a.parsedSuffix.localeCompare(b.parsedSuffix);
                 }).forEach(item => {
                     // Data row
                     csvContent += `${prefix},${item.parsedSuffix},${item.date || ''},${item.quantity || 0},${item.availableQty || 0},${item.nilQty || 0},${item.damageQty || 0}\n`;
                 });
                 // Empty row between groups
                 csvContent += `,,,,,,,\n`;
              }
              csvContent += `\n`;
            }
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `stock-patrak-${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
          }}><Download className="mr-1 h-4 w-4" />Export Patrak (CSV)</Button>
          <Button variant="outline" size="sm" onClick={() => printElement('stock-table')}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search product or batch..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Button variant={showLowStock ? "default" : "outline"} onClick={() => setShowLowStock(!showLowStock)}>
          Low Stock Only
        </Button>
      </div>
      <Card>
        <CardContent className="p-0" id="stock-table">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead><TableHead>Category</TableHead><TableHead>Thickness</TableHead>
                  <TableHead>Batch</TableHead><TableHead className="text-right">Total Qty</TableHead>
                  <TableHead className="text-right">Available</TableHead><TableHead className="text-right">Nil</TableHead><TableHead className="text-right">Damaged</TableHead>
                  <TableHead>Location</TableHead><TableHead>Updated</TableHead><TableHead className="text-right no-print">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No stock entries found</TableCell></TableRow>
                ) : batches.map(b => (
                  <TableRow key={b.id} className={b.availableQty < 10 ? 'bg-destructive/5' : ''}>
                    <TableCell className="font-medium">{b.productName}</TableCell>
                    <TableCell>{b.category}</TableCell><TableCell>{b.thickness}</TableCell>
                    <TableCell>{b.batchNumber}</TableCell>
                    <TableCell className="text-right">{b.quantity}</TableCell>
                    <TableCell className="text-right font-semibold">{b.availableQty}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{b.nilQty || 0}</TableCell>
                    <TableCell className="text-right text-stock-damaged">{b.damageQty}</TableCell>
                    <TableCell>{b.warehouseLocation}</TableCell>
                    <TableCell>{b.date}</TableCell>
                    <TableCell className="text-right no-print">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => setEditingBatch(b)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(b.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editingBatch} onOpenChange={(o) => !o && setEditingBatch(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Stock Batch</DialogTitle></DialogHeader>
          {editingBatch && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Product</Label>
                <Input className="col-span-3" value={editingBatch.productName} onChange={e => setEditingBatch({...editingBatch, productName: e.target.value})} />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Available Qty</Label>
                <Input type="number" className="col-span-3" value={editingBatch.availableQty} onChange={e => setEditingBatch({...editingBatch, availableQty: Number(e.target.value)})} />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Nil Qty</Label>
                <Input type="number" className="col-span-3" value={editingBatch.nilQty || 0} onChange={e => setEditingBatch({...editingBatch, nilQty: Number(e.target.value)})} />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Damage Qty</Label>
                <Input type="number" className="col-span-3" value={editingBatch.damageQty} onChange={e => setEditingBatch({...editingBatch, damageQty: Number(e.target.value)})} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBatch(null)}>Cancel</Button>
            <Button onClick={handleEditSave}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
