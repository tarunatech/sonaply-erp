import { useState, useMemo, useEffect, useCallback } from "react";
import { getOrders, updateOrder, exportCSV, addChallan, getBatches, Order, StockBatch } from "@/lib/store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Download, Printer, Search, FileCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function PendingOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState("");
  const { toast } = useToast();
  const [showChallanDialog, setShowChallanDialog] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [challanForm, setChallanForm] = useState({ batchNo: '', notes: '' });
  const [batches, setBatches] = useState<StockBatch[]>([]);

  const refresh = useCallback(async () => {
    const [o, b] = await Promise.all([getOrders(), getBatches()]);
    setOrders(o.filter(order => order.status !== 'Delivered' && order.pendingQty && order.pendingQty > 0));
    setBatches(b);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreateChallan = async () => {
    if (!currentOrder) return;
    const challanNum = `CHL-${Date.now().toString(36).toUpperCase()}`;

    await addChallan({
      challanNumber: challanNum,
      orderNumber: currentOrder.orderNumber,
      clientName: currentOrder.clientName,
      clientPhone: currentOrder.clientPhone,
      productName: currentOrder.productName,
      quantity: currentOrder.pendingQty || currentOrder.quantity,
      date: new Date().toISOString().slice(0, 10),
      batchNo: challanForm.batchNo,
      notes: challanForm.notes,
      shouldFulfill: true,
    });

    toast({ title: "Fulfillment Complete!", description: `Challan ${challanNum} generated. Order marked as fulfilled.` });
    
    // Also update order status to Delivered
    await updateOrder(currentOrder.id, { status: 'Delivered' });

    setChallanForm({ batchNo: '', notes: '' });
    setShowChallanDialog(false);
    setCurrentOrder(null);
    refresh();
  };

  const handleStatusChange = async (orderId: string, newStatus: Order['status']) => {
    try {
      const updates: Partial<Order> = { status: newStatus };
      if (newStatus === 'Delivered') {
        const orderToUpdate = orders.find(o => o.id === orderId);
        if (orderToUpdate) {
          updates.pendingQty = 0;
          updates.fulfilledQty = orderToUpdate.quantity;
        }
      }
      await updateOrder(orderId, updates);
      toast({ title: "Status Updated", description: `Order status changed to ${newStatus}` });
      refresh();
    } catch (error) {
      toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
    }
  };

  const filteredOrders = useMemo(() => {
    if (!filter) return orders;
    const f = filter.toLowerCase();
    return orders.filter(o =>
      o.clientName.toLowerCase().includes(f) ||
      o.productName.toLowerCase().includes(f) ||
      o.orderNumber.toLowerCase().includes(f)
    ).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
  }, [orders, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-red-600">Pending Stock Orders</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search pending items..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredOrders as any, `pending-orders-${new Date().toISOString().slice(0, 10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
          <Button variant="outline" size="sm" onClick={() => printElement('pending-table')}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0" id="pending-table">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead className="text-right text-red-600">Pending</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No pending items found. All orders are fulfilled!
                    </TableCell>
                  </TableRow>
                ) : filteredOrders.map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.orderNumber}</TableCell>
                    <TableCell className="font-medium">{o.clientName}</TableCell>
                    <TableCell>
                      <div className="font-medium">{o.productName}</div>
                      <div className="text-[10px] text-blue-600 font-bold mt-1 uppercase">
                        Stock Available: {batches.filter(b => b.productName === o.productName).reduce((sum, b) => sum + b.availableQty, 0)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{o.quantity}</TableCell>
                    <TableCell className="text-right font-black text-red-600 text-lg">{o.pendingQty}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{o.orderDate}</TableCell>
                    <TableCell>
                      <Select
                        value={o.status}
                        onValueChange={(value) => handleStatusChange(o.id, value as Order['status'])}
                      >
                        <SelectTrigger className="h-8 w-[110px]">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Pending">Pending</SelectItem>
                          <SelectItem value="Confirmed">Confirmed</SelectItem>
                          <SelectItem value="Delivered">Delivered</SelectItem>
                          <SelectItem value="Cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => {
                          setCurrentOrder(o);
                          setChallanForm({ batchNo: o.batchNo || '0', notes: '' });
                          setShowChallanDialog(true);
                        }}
                      >
                        <FileCheck className="mr-1 h-4 w-4" /> Deliver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showChallanDialog} onOpenChange={setShowChallanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Fulfillment & Generate Challan</DialogTitle>
            <DialogDescription>
              This will mark the order as fully fulfilled and generate a delivery challan.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="batch" className="text-right text-xs uppercase font-bold">Batch No</Label>
              <Input id="batch" className="col-span-3" value={challanForm.batchNo} onChange={e => setChallanForm({ ...challanForm, batchNo: e.target.value })} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="notes" className="text-right text-xs uppercase font-bold">Notes</Label>
              <Input id="notes" className="col-span-3" value={challanForm.notes} onChange={e => setChallanForm({ ...challanForm, notes: e.target.value })} placeholder="Special instructions..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChallanDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateChallan} className="bg-green-600 hover:bg-green-700">Confirm & Generate Challan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
