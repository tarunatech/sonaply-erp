import { useState } from "react";
import { addPurchase, addBatch, getPurchases, exportCSV, CATEGORIES } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Download, Printer } from "lucide-react";

const defaultForm = { supplierName: '', supplierPhone: '', productName: '', category: 'Laminate', quantity: 0, rate: 0, batchNumber: '', date: new Date().toISOString().slice(0, 10) };

export default function PurchasePage() {
  const [form, setForm] = useState(defaultForm);
  const [purchases, setPurchases] = useState(getPurchases());
  const { toast } = useToast();

  const handleSubmit = () => {
    if (!form.supplierName || !form.productName || form.quantity <= 0) {
      toast({ title: "Fill required fields", variant: "destructive" }); return;
    }
    const total = 0;
    addPurchase({ ...form, rate: 0, supplierPhone: '', totalAmount: total });
    addBatch({ productId: '', productName: form.productName, category: form.category, thickness: '', batchNumber: form.batchNumber, supplier: form.supplierName, quantity: form.quantity, rate: 0, date: form.date, warehouseLocation: 'Warehouse A', availableQty: form.quantity, damageQty: 0, nilQty: 0 });
    toast({ title: "Purchase recorded & stock updated!" });
    setForm(defaultForm);
    setPurchases(getPurchases());
  };

  const u = (k: string, v: string | number) => setForm({ ...form, [k]: v });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Purchase Module</h1>
      <Tabs defaultValue="new">
        <TabsList><TabsTrigger value="new">New Purchase</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
        <TabsContent value="new">
          <Card><CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>Supplier Name *</Label><Input value={form.supplierName} onChange={e => u('supplierName', e.target.value)} /></div>
              <div><Label>Product *</Label><Input value={form.productName} onChange={e => u('productName', e.target.value)} /></div>
              <div><Label>Category</Label><Input value="Laminate" readOnly className="bg-muted text-muted-foreground" /></div>
              <div><Label>Quantity *</Label><Input type="number" value={form.quantity || ''} onChange={e => u('quantity', +e.target.value)} /></div>
              <div><Label>Batch Number</Label><Input value={form.batchNumber} onChange={e => u('batchNumber', e.target.value)} /></div>
              <div><Label>Date</Label><Input type="date" value={form.date} readOnly className="bg-muted text-muted-foreground" /></div>
            </div>
            <Button className="w-full" onClick={handleSubmit}>Record Purchase</Button>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="history">
          <div className="flex gap-2 mb-3">
            <Button variant="outline" size="sm" onClick={() => exportCSV(purchases as any, `purchases-${new Date().toISOString().slice(0,10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
            <Button variant="outline" size="sm" onClick={() => printElement('purchase-table')}><Printer className="mr-1 h-4 w-4" />Print</Button>
          </div>
          <Card><CardContent className="p-0" id="purchase-table"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Supplier</TableHead><TableHead>Product</TableHead><TableHead>Category</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Batch</TableHead><TableHead>Date</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {purchases.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No purchases yet</TableCell></TableRow>
                : purchases.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.supplierName}</TableCell><TableCell>{p.productName}</TableCell>
                    <TableCell>{p.category}</TableCell><TableCell className="text-right">{p.quantity}</TableCell>
                    <TableCell>{p.batchNumber}</TableCell><TableCell>{p.date}</TableCell>
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
