import { useState } from "react";
import { getOrders, updateOrder, exportCSV, generateWhatsAppLink } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, Printer, MessageCircle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-warning text-warning-foreground',
  Confirmed: 'bg-primary text-primary-foreground',
  Delivered: 'bg-success text-success-foreground',
  Cancelled: 'bg-destructive text-destructive-foreground',
};

export default function OrderTracking() {
  const [orders, setOrders] = useState(getOrders());

  const changeStatus = (id: string, status: 'Pending' | 'Confirmed' | 'Delivered' | 'Cancelled') => {
    updateOrder(id, { status });
    setOrders(getOrders());
  };

  const sendWhatsApp = (o: typeof orders[0]) => {
    const msg = `Hello ${o.clientName},\n\nYour order ${o.orderNumber} status: ${o.status}\n\nProduct: ${o.productName}\nQuantity: ${o.quantity}\nAmount: ₹${o.totalAmount.toLocaleString()}\n\nThank you!`;
    window.open(generateWhatsAppLink(o.clientPhone, msg), '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Order Tracking</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(orders as any, `orders-${new Date().toISOString().slice(0,10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
          <Button variant="outline" size="sm" onClick={() => printElement('order-table')}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>
      <Card><CardContent className="p-0" id="order-table"><div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Order #</TableHead><TableHead>Client</TableHead><TableHead>Product</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amount</TableHead>
            <TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {orders.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No orders yet</TableCell></TableRow>
            : orders.map(o => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.orderNumber}</TableCell>
                <TableCell>{o.clientName}</TableCell><TableCell>{o.productName}</TableCell>
                <TableCell className="text-right">{o.quantity}</TableCell>
                <TableCell className="text-right font-semibold">₹{o.totalAmount.toLocaleString()}</TableCell>
                <TableCell>{o.orderDate}</TableCell>
                <TableCell>
                  <Select value={o.status} onValueChange={(v: any) => changeStatus(o.id, v)}>
                    <SelectTrigger className="w-[130px] h-8"><Badge className={STATUS_COLORS[o.status]}>{o.status}</Badge></SelectTrigger>
                    <SelectContent>
                      {['Pending','Confirmed','Delivered','Cancelled'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => sendWhatsApp(o)} title="Send WhatsApp">
                    <MessageCircle className="h-4 w-4 text-success" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div></CardContent></Card>
    </div>
  );
}
