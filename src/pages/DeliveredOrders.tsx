import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { getOrders, updateOrder, deleteOrder, exportCSV, generateWhatsAppLink, Order } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, Printer, MessageCircle, CheckCircle2, Pencil, Trash2, ChevronDown, ChevronRight, User } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function DeliveredOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [filter, setFilter] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
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

  const groupedOrders = useMemo(() => {
    const groups: Record<string, { clientName: string, orders: Order[], date: string }> = {};
    filteredOrders.forEach(o => {
      const key = o.orderNumber;
      if (!groups[key]) groups[key] = { clientName: o.clientName, orders: [], date: o.orderDate };
      groups[key].orders.push(o);
    });
    return Object.entries(groups).map(([orderNumber, group]) => ({
      orderNumber,
      clientName: group.clientName,
      orders: group.orders,
      date: group.date
    })).sort((a, b) => b.orderNumber.localeCompare(a.orderNumber));
  }, [filteredOrders]);

  const toggleGroup = (orderNumber: string) => {
    setExpandedGroups(prev => ({ ...prev, [orderNumber]: !prev[orderNumber] }));
  };

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
            {groupedOrders.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No delivered orders found</TableCell></TableRow>
            : groupedOrders.map(group => (
              <Fragment key={group.orderNumber}>
                <TableRow 
                  className="cursor-pointer bg-muted/30 hover:bg-muted/50 transition-colors group"
                  onClick={() => toggleGroup(group.orderNumber)}
                >
                  <TableCell colSpan={8} className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-success/10 text-success">
                          <User className="h-4 w-4" />
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                          <span className="font-bold text-lg">{group.clientName}</span>
                          <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded border">{group.orderNumber}</span>
                          <Badge variant="outline" className="bg-background w-fit">
                            {group.orders.length} {group.orders.length === 1 ? 'Item' : 'Items'}
                          </Badge>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
                        <span className="text-sm font-medium hidden sm:inline">{expandedGroups[group.orderNumber] ? 'Click to collapse' : 'Click to expand'}</span>
                        {expandedGroups[group.orderNumber] ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
                
                {expandedGroups[group.orderNumber] && group.orders.map(o => (
                  <TableRow key={o.id} className="animate-in fade-in slide-in-from-top-1 duration-200 border-l-4 border-l-success/40 bg-card/50">
                    <TableCell className="font-mono text-xs pl-8">{o.orderNumber}</TableCell>
                    <TableCell className="text-muted-foreground italic">Entry Details</TableCell>
                    <TableCell className="font-medium">{o.productName}</TableCell>
                    <TableCell className="text-right">{o.quantity}</TableCell>
                    <TableCell className="text-right font-semibold">₹{o.totalAmount.toLocaleString()}</TableCell>
                    <TableCell>{o.orderDate}</TableCell>
                    <TableCell><Badge className="bg-success text-success-foreground">Delivered</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-success hover:bg-success/10" onClick={() => sendWhatsApp(o)} title="Send WhatsApp">
                          <MessageCircle className="h-4 w-4" />
                        </Button>

                        <Dialog open={!!editingOrder && editingOrder.id === o.id} onOpenChange={(open) => !open && setEditingOrder(null)}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => setEditingOrder({...o})} title="Edit Order">
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

                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(o.id)} title="Delete Order">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div></CardContent></Card>
    </div>
  );
}
