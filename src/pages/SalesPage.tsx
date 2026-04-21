import { useState } from "react";
import { addSale, addOrder, getBatches, getProducts, getSales, exportCSV, generateWhatsAppLink } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Download, Printer, MessageCircle } from "lucide-react";

const PRICE_CATEGORIES = ['0-10000', '10000-20000', '20000-50000', '50000-100000', 'Above 100000'];
const defaultForm = { clientName: '', clientPhone: '', productName: '', category: '0-10000', quantity: 0, totalAmount: 0, orderDate: new Date().toISOString().slice(0, 10) };

export default function SalesPage() {
  const [form, setForm] = useState(defaultForm);
  const [sales, setSales] = useState(getSales());
  const { toast } = useToast();

  const productNames = Array.from(new Set([
    ...getProducts().map(p => p.name),
    ...getBatches().map(b => b.productName),
  ]));

  const total = form.totalAmount || 0;
  const valueCategory = total >= 50000 ? 'Above 50,000' : 'Below 50,000';

  const handleSubmit = () => {
    if (!form.clientName || !form.productName || form.quantity <= 0 || form.totalAmount <= 0) {
      toast({ title: "Fill required fields", variant: "destructive" }); return;
    }
    addSale({
      clientName: form.clientName,
      clientPhone: form.clientPhone,
      productName: form.productName,
      category: form.category,
      quantity: form.quantity,
      totalPrice: total,
      orderDate: form.orderDate,
      valueCategory,
    });

    const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;
    addOrder({
      orderNumber: orderNum,
      clientName: form.clientName,
      clientPhone: form.clientPhone,
      productName: form.productName,
      quantity: form.quantity,
      totalAmount: total,
      orderDate: form.orderDate,
      status: 'Pending',
    });

    const msg = `Hello ${form.clientName},\n\nYour order has been placed successfully.\n\nProduct: ${form.productName}\nQuantity: ${form.quantity}\nAmount: ₹${total.toLocaleString()}\n\nThank you for choosing us.`;
    const waLink = generateWhatsAppLink(form.clientPhone, msg);

    toast({ title: "Sale recorded!", description: "Order created automatically." });
    if (form.clientPhone) window.open(waLink, '_blank');
    setForm(defaultForm);
    setSales(getSales());
  };

  const u = (k: string, v: string | number) => setForm({ ...form, [k]: v });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sales Module</h1>
      <Tabs defaultValue="new">
        <TabsList><TabsTrigger value="new">New Sale</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
        <TabsContent value="new">
          <Card><CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>Client Name *</Label><Input value={form.clientName} onChange={e => u('clientName', e.target.value)} /></div>
              <div><Label>Client Phone (with country code)</Label><Input value={form.clientPhone} onChange={e => u('clientPhone', e.target.value)} placeholder="919876543210" /></div>
              <div>
                <Label>Product *</Label>
                <Input
                  list="sales-product-list"
                  value={form.productName}
                  onChange={e => u('productName', e.target.value)}
                  placeholder="Start typing to search products"
                />
                <datalist id="sales-product-list">
                  {productNames.map(name => <option key={name} value={name} />)}
                </datalist>
              </div>
              <div><Label>Price Category</Label><Select value={form.category} onValueChange={v => u('category', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRICE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Quantity *</Label><Input type="number" value={form.quantity || ''} onChange={e => u('quantity', +e.target.value)} /></div>
              <div><Label>Total Amount (₹)</Label><Input type="number" value={form.totalAmount || ''} onChange={e => u('totalAmount', +e.target.value)} /></div>
              <div><Label>Order Date</Label><Input type="date" value={form.orderDate} disabled /></div>
            </div>
            <div className="bg-muted p-3 rounded-md flex items-center justify-between">
              <span className="text-lg font-semibold">Total: ₹{total.toLocaleString()}</span>
              <Badge variant={total >= 50000 ? 'default' : 'secondary'}>{valueCategory}</Badge>
            </div>
            <Button className="w-full" onClick={handleSubmit}><MessageCircle className="mr-2 h-4 w-4" />Record Sale & Send WhatsApp</Button>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="history">
          <div className="flex gap-2 mb-3">
            <Button variant="outline" size="sm" onClick={() => exportCSV(sales as any, `sales-${new Date().toISOString().slice(0,10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
            <Button variant="outline" size="sm" onClick={() => printElement('sales-table')}><Printer className="mr-1 h-4 w-4" />Print</Button>
          </div>
          <Card><CardContent className="p-0" id="sales-table"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Client</TableHead><TableHead>Product</TableHead><TableHead>Price Category</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead>Type</TableHead><TableHead>Date</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sales.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No sales yet</TableCell></TableRow>
                : sales.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.clientName}</TableCell><TableCell>{s.productName}</TableCell>
                    <TableCell>{s.category}</TableCell><TableCell className="text-right">{s.quantity}</TableCell>
                    <TableCell className="text-right font-semibold">₹{s.totalPrice.toLocaleString()}</TableCell>
                    <TableCell><Badge variant={s.valueCategory === 'Above 50,000' ? 'default' : 'secondary'}>{s.valueCategory}</Badge></TableCell>
                    <TableCell>{s.orderDate}</TableCell>
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
