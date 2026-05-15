import { useState, useEffect, useCallback, useMemo } from "react";
import { getOrders, updateOrder, deleteOrder, exportCSV, generateWhatsAppLink, Order } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, Printer, MessageCircle, CheckCircle2, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function DeliveredOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [filter, setFilter] = useState('');
  const { toast } = useToast();

  const refresh = useCallback(() => {
    getOrders().then(data => setOrders(data.filter(o => o.status === 'Delivered')));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filteredOrders = useMemo(() => {
    return orders
      .filter(o => 
        o.clientName.toLowerCase().includes(filter.toLowerCase()) ||
        o.productName.toLowerCase().includes(filter.toLowerCase()) ||
        o.orderNumber.toLowerCase().includes(filter.toLowerCase())
      )
      .sort((a, b) => {
        const dateA = new Date(a.orderDate).getTime();
        const dateB = new Date(b.orderDate).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return b.orderNumber.localeCompare(a.orderNumber);
      });
  }, [orders, filter]);

  const handleDelete = async (id: string) => {
    const password = window.prompt("Please enter admin password to delete:");
    if (password !== 'admin') {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (window.confirm("Are you sure you want to delete this delivered order?")) {
      await deleteOrder(id);
      refresh();
      toast({ title: "Order deleted" });
    }
  };

  const handleEditSave = async () => {
    if (!editingOrder) return;
    await updateOrder(editingOrder.id, editingOrder);
    refresh();
    setEditingOrder(null);
    toast({ title: "Order updated" });
  };

  const sendWhatsApp = (o: any) => {
    const msg = `Hello ${o.clientName},\n\nYour order ${o.orderNumber} has been delivered successfully.\n\nProduct: ${o.productName}\nQuantity: ${o.quantity}\n\nThank you for business!`;
    window.open(generateWhatsAppLink(o.clientPhone, msg), '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <h1 className="text-2xl font-bold">Delivered Orders</h1>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="w-full sm:w-72">
            <Input 
              placeholder="Filter by client, product, order #..." 
              value={filter} 
              onChange={e => setFilter(e.target.value)} 
              className="h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredOrders as any, `delivered-orders-${new Date().toISOString().slice(0,10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
          <Button variant="outline" size="sm" onClick={() => printElement('delivered-table')}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>
      <Card><CardContent className="p-0" id="delivered-table"><div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Order #</TableHead><TableHead>Client</TableHead><TableHead>Product</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amount</TableHead>
            <TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filteredOrders.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No delivered orders found</TableCell></TableRow>
            : filteredOrders.map(o => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.orderNumber}</TableCell>
                <TableCell>{o.clientName}</TableCell><TableCell>{o.productName}</TableCell>
                <TableCell className="text-right">{o.quantity}</TableCell>
                <TableCell className="text-right font-semibold">₹{o.totalAmount.toLocaleString()}</TableCell>
                <TableCell>{o.orderDate}</TableCell>
                <TableCell><Badge className="bg-success text-success-foreground">Delivered</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-success" onClick={() => sendWhatsApp(o)} title="Send WhatsApp">
                      <MessageCircle className="h-4 w-4" />
                    </Button>

                    <Dialog open={!!editingOrder && editingOrder.id === o.id} onOpenChange={(open) => !open && setEditingOrder(null)}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => setEditingOrder({...o})} title="Edit Order">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Edit Delivered Order</DialogTitle></DialogHeader>
                        <div className="grid gap-4 py-4">
                          <div className="grid gap-2">
                            <Label>Client Name</Label>
                            <Input value={editingOrder?.clientName || ''} onChange={e => setEditingOrder({...editingOrder, clientName: e.target.value})} />
                          </div>
                          <div className="grid gap-2">
                            <Label>Product Name</Label>
                            <Input value={editingOrder?.productName || ''} onChange={e => setEditingOrder({...editingOrder, productName: e.target.value})} />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                              <Label>Quantity</Label>
                              <Input type="number" value={editingOrder?.quantity || ''} onChange={e => setEditingOrder({...editingOrder, quantity: +e.target.value})} />
                            </div>
                            <div className="grid gap-2">
                              <Label>Amount</Label>
                              <Input type="number" value={editingOrder?.totalAmount || ''} onChange={e => setEditingOrder({...editingOrder, totalAmount: +e.target.value})} />
                            </div>
                          </div>
                        </div>
                        <DialogFooter><Button onClick={handleEditSave}>Save Changes</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>

                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(o.id)} title="Delete Order">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div></CardContent></Card>
    </div>
  );
}
