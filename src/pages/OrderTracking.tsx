import { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { getOrders, updateOrder, deleteOrder, exportCSV, generateWhatsAppLink, addChallan, getBatches, getChallans, Order, StockBatch } from "@/lib/store";

import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, Printer, MessageCircle, FileText, Pencil, Trash2, ChevronDown, ChevronRight, User, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-warning text-warning-foreground',
  Confirmed: 'bg-primary text-primary-foreground',
  Delivered: 'bg-success text-success-foreground',
  Cancelled: 'bg-destructive text-destructive-foreground',
};

export default function OrderTracking() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const { toast } = useToast();
  const [selectedOrders, setSelectedOrders] = useState<Order[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [challanForm, setChallanForm] = useState({ batchNo: '', notes: '' });
  const [showChallanDialog, setShowChallanDialog] = useState(false);
  const [filter, setFilter] = useState('');
  const [batches, setBatches] = useState<StockBatch[]>([]);

  const refresh = useCallback(async () => {
    const [ordersData, batchesData] = await Promise.all([getOrders(), getBatches()]);
    setOrders(ordersData.filter(o => o.status !== 'Delivered'));
    setBatches(batchesData);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => 
      o.clientName.toLowerCase().includes(filter.toLowerCase()) ||
      o.productName.toLowerCase().includes(filter.toLowerCase()) ||
      o.status.toLowerCase().includes(filter.toLowerCase()) ||
      o.orderNumber.toLowerCase().includes(filter.toLowerCase())
    );
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

  const changeStatus = async (id: string, status: Order['status']) => {
    try {
      const updates: Partial<Order> = { status };
      if (status === 'Delivered') {
        const orderToUpdate = orders.find(o => o.id === id);
        if (orderToUpdate) {
          updates.pendingQty = 0;
          updates.fulfilledQty = orderToUpdate.quantity;
        }
      }
      await updateOrder(id, updates);
      toast({ title: "Status Updated", description: `Order status changed to ${status}` });
      window.dispatchEvent(new CustomEvent("erp-stock-updated"));
      refresh();
    } catch (error) {
      toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    const password = window.prompt("Please enter admin password to delete:");
    if (password !== 'admin') {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (window.confirm("Are you sure you want to delete this order?")) {
      await deleteOrder(id);
      refresh();
      toast({ title: "Order deleted" });
    }
  };

  const handleEditSave = async () => {
    if (!editingOrder) return;
    // Recalculate pendingQty based on new quantity and current fulfilledQty
    const fulfilledQty = editingOrder.fulfilledQty ?? 0;
    const newPendingQty = Math.max(0, (editingOrder.quantity ?? 0) - fulfilledQty);
    const updatedOrder = { ...editingOrder, pendingQty: newPendingQty };
    await updateOrder(editingOrder.id, updatedOrder);
    refresh();
    setEditingOrder(null);
    toast({ title: "Order updated", description: `Pending qty updated to ${newPendingQty}` });
  };


  const sendWhatsApp = (o: any) => {
    const msg = `Hello ${o.clientName},\n\nYour order ${o.orderNumber} status: ${o.status}\n\nProduct: ${o.productName}\nQuantity: ${o.quantity}\n\nThank you!`;
    window.open(generateWhatsAppLink(o.clientPhone, msg), '_blank');
  };

  const handleCreateChallan = async () => {
    if (selectedOrders.length === 0) return;
    const allChallans = await getChallans();
    let maxNum = 0;
    for (const c of allChallans) {
      const numPart = c.challanNumber.split('-')[1];
      if (numPart && !isNaN(parseInt(numPart, 10))) {
        maxNum = Math.max(maxNum, parseInt(numPart, 10));
      }
    }
    const challanNum = `CHL-${maxNum + 1}`;
    
    for (const order of selectedOrders) {
      await addChallan({
        challanNumber: challanNum,
        orderNumber: order.orderNumber,
        clientName: order.clientName,
        clientPhone: order.clientPhone,
        productName: order.productName,
        quantity: order.fulfilledQty || order.quantity,
        date: new Date().toISOString().slice(0, 10),
        batchNo: challanForm.batchNo,
        notes: challanForm.notes,
        skipStockUpdate: (order.fulfilledQty || 0) > 0,
        stockCategory: order.stockCategory,
      });
    }

    toast({ title: "Challan Created!", description: `Challan ${challanNum} has been generated with ${selectedOrders.length} items.` });
    window.dispatchEvent(new CustomEvent("erp-stock-updated"));
    setSelectedOrders([]);
    setChallanForm({ batchNo: '', notes: '' });
    setShowChallanDialog(false);
    refresh();
  };

  const editingOrderProductBatches = useMemo(() => {
    if (!editingOrder) return [];
    return batches.filter(b => b.productName === editingOrder.productName);
  }, [editingOrder, batches]);

  const editingOrderBatchOptions = useMemo(() => {
    const list = new Set<string>();
    if (editingOrder?.batchNo) {
      list.add(editingOrder.batchNo);
    }
    editingOrderProductBatches.forEach(b => {
      if (b.batchNumber) list.add(b.batchNumber);
    });
    return Array.from(list);
  }, [editingOrder, editingOrderProductBatches]);

  const selectedProductBatches = useMemo(() => {
    if (selectedOrders.length === 0) return [];
    const productNames = Array.from(new Set(selectedOrders.map(o => o.productName)));
    return batches.filter(b => productNames.includes(b.productName));
  }, [selectedOrders, batches]);

  const selectedOrdersBatchOptions = useMemo(() => {
    const list = new Set<string>();
    selectedOrders.forEach(o => {
      if (o.batchNo) list.add(o.batchNo);
    });
    selectedProductBatches.forEach(b => {
      if (b.batchNumber) list.add(b.batchNumber);
    });
    return Array.from(list);
  }, [selectedOrders, selectedProductBatches]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Order Tracking</h1>
          <div className="flex items-center space-x-2 bg-red-50 px-3 py-1.5 rounded-md border border-red-100 no-print cursor-pointer hover:bg-red-100 transition-colors" onClick={() => navigate('/pending-orders')}>
            <Checkbox id="pending-redirect" checked={false} onCheckedChange={() => navigate('/pending-orders')} />
            <Label htmlFor="pending-redirect" className="text-red-600 font-bold cursor-pointer text-xs uppercase">Go to Pending List</Label>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="w-full sm:w-72">
            <Input 
              placeholder="Filter by client, product, status..." 
              value={filter} 
              onChange={e => setFilter(e.target.value)} 
              className="h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredOrders as any, `orders-${new Date().toISOString().slice(0,10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
          <Button variant="outline" size="sm" onClick={() => printElement('order-table')}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>

      <Card><CardContent className="p-0" id="order-table"><div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Order #</TableHead><TableHead>Client</TableHead><TableHead>Product</TableHead>
            <TableHead className="text-right">Qty (F/P)</TableHead><TableHead className="text-right">Amount</TableHead>
            <TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {groupedOrders.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No orders found</TableCell></TableRow>
            : groupedOrders.map(group => (
              <Fragment key={group.orderNumber}>
                <TableRow 
                  className="cursor-pointer bg-muted/30 hover:bg-muted/50 transition-colors group"
                  onClick={() => toggleGroup(group.orderNumber)}
                >
                  <TableCell className="font-mono text-xs font-semibold py-3 px-4">
                    <div className="flex items-center gap-2">
                      {expandedGroups[group.orderNumber] ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      {group.orderNumber}
                    </div>
                  </TableCell>
                  <TableCell className="font-bold py-3 px-4">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-primary shrink-0" />
                      <span>{group.clientName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-3 px-4 text-muted-foreground text-xs font-medium">
                    {group.orders.length} {group.orders.length === 1 ? 'Item' : 'Items'}
                  </TableCell>
                  <TableCell className="py-3 px-4 text-right font-medium text-muted-foreground">
                    {group.orders.reduce((sum, o) => sum + (o.quantity || 0), 0)}
                  </TableCell>
                  <TableCell className="py-3 px-4 text-right font-semibold text-primary">
                    ₹{group.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="py-3 px-4 text-sm font-semibold text-muted-foreground">
                    {group.date ? format(new Date(group.date), 'dd-MM-yyyy') : ''}
                  </TableCell>
                  <TableCell className="py-3 px-4">
                    {group.orders.some(o => o.isChallanGenerated) && (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 flex gap-1 h-6 px-2 border-green-200 w-fit text-[10px]">
                        <CheckCircle2 className="h-3 w-3" /> Challan
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-3 px-4" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-2 no-print">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-8 w-8 p-0"
                        onClick={() => {
                          setChallanForm({ batchNo: group.orders[0].batchNo || '0', notes: '' });
                          setSelectedOrders(group.orders);
                          setShowChallanDialog(true);
                        }} 
                        title="Create Challan for all items"
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedGroups[group.orderNumber] && group.orders.map(o => (
                  <TableRow key={o.id} className="animate-in fade-in slide-in-from-top-1 duration-200 border-l-4 border-l-primary/40 bg-card/50">
                    <TableCell className="font-medium pl-8">
                      <div className="flex items-center gap-2">
                        {o.orderNumber}
                        {o.isChallanGenerated && (
                          <span title="Challan already generated" className="inline-flex">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground italic">Entry Details</TableCell>
                    <TableCell>
                      <div className="font-medium">{o.productName}</div>
                      {o.batchNo && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 font-semibold">
                          Batch: {o.batchNo}
                        </div>
                      )}
                      {o.narration && (
                        <div className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 mt-1 font-semibold w-fit">
                          Narration: {o.narration}
                        </div>
                      )}
                      <div className="text-[10px] text-blue-600 font-bold mt-1 uppercase">
                        Stock Available: {(() => {
                          const matched = batches.find(b => 
                            b.productName.trim().toLowerCase() === o.productName.trim().toLowerCase() && 
                            (b.batchNumber || '').trim().toLowerCase() === (o.batchNo || '').trim().toLowerCase()
                          );
                          return matched ? matched.availableQty : 0;
                        })()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end">
                        {o.pendingQty && o.pendingQty > 0 ? (
                          <>
                            <div className="flex items-center gap-2">
                              <Checkbox checked={false} onCheckedChange={() => navigate('/pending-orders')} className="border-red-300 data-[state=checked]:bg-red-600" />
                              <span className="text-xl font-black text-red-600 leading-none" title="Pending Quantity">
                                {o.pendingQty}
                              </span>
                              <span className="text-red-600 font-bold text-xs uppercase">Pending</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground uppercase font-bold mt-1">
                              Total: {o.quantity} (F: {o.fulfilledQty || 0})
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-lg font-bold text-success leading-none" title="Fully Fulfilled">
                              {o.quantity}
                            </span>
                            <span className="text-[10px] text-muted-foreground uppercase font-bold mt-1">
                              Fulfilled
                            </span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary">₹{o.totalAmount.toLocaleString()}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{o.orderDate ? format(new Date(o.orderDate), 'dd-MM-yyyy') : ''}</TableCell>
                    <TableCell>
                      <Select
                        value={o.status}
                        onValueChange={(value) => changeStatus(o.id, value as Order['status'])}
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
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-success hover:bg-success/10" onClick={(e) => { e.stopPropagation(); sendWhatsApp(o); }} title="Send WhatsApp">
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                        
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={(e) => { e.stopPropagation(); setEditingOrder({...o}); }} title="Edit Order">
                          <Pencil className="h-4 w-4" />
                        </Button>
    
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); handleDelete(o.id); }} title="Delete Order">
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

      {/* Shared Dialogs */}
      <Dialog open={!!editingOrder} onOpenChange={(open) => !open && setEditingOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Order Details</DialogTitle>
            <DialogDescription>Make changes to the order information below. Click save when you're done.</DialogDescription>
          </DialogHeader>
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
                <Label>Total Quantity</Label>
                <Input
                  type="number"
                  value={editingOrder?.quantity || ''}
                  onChange={e => {
                    const newQty = +e.target.value;
                    const fulfilled = editingOrder?.fulfilledQty ?? 0;
                    const newPending = Math.max(0, newQty - fulfilled);
                    setEditingOrder({ ...editingOrder, quantity: newQty, pendingQty: newPending });
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label>Amount (₹)</Label>
                <Input type="number" value={editingOrder?.totalAmount || ''} onChange={e => setEditingOrder({...editingOrder, totalAmount: +e.target.value})} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-success font-bold">Fulfilled Qty (Deducted)</Label>
                <Input type="number" value={editingOrder?.fulfilledQty || 0} readOnly className="bg-muted cursor-not-allowed" />
              </div>
              <div className="grid gap-2">
                <Label className="text-red-600 font-bold">Pending Qty <span className="text-xs font-normal text-muted-foreground">(auto-calculated)</span></Label>
                <Input type="number" value={editingOrder?.pendingQty ?? 0} readOnly className="bg-muted cursor-not-allowed" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Batch Number</Label>
              <Select
                value={editingOrder?.batchNo || ''}
                onValueChange={v => setEditingOrder({...editingOrder, batchNo: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Batch" />
                </SelectTrigger>
                <SelectContent>
                  {editingOrderBatchOptions.map(bNo => {
                    const batchVal = bNo || "0";
                    const matchedBatch = editingOrderProductBatches.find(b => (b.batchNumber || "0") === batchVal);
                    const avail = matchedBatch ? matchedBatch.availableQty : 0;
                    return (
                      <SelectItem key={batchVal} value={batchVal}>
                        {batchVal} {matchedBatch ? `(Avail: ${avail})` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Narration / Notes</Label>
              <Input value={editingOrder?.narration || ''} onChange={e => setEditingOrder({...editingOrder, narration: e.target.value})} placeholder="Narration" />
            </div>
          </div>
          <DialogFooter><Button onClick={handleEditSave}>Save Changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showChallanDialog} onOpenChange={(open) => { if(!open) setShowChallanDialog(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Delivery Challan</DialogTitle>
            <DialogDescription>Review order items and enter delivery details to generate a challan.</DialogDescription>
          </DialogHeader>
          {selectedOrders.length > 0 && (
            <div className="space-y-4 py-4">
              <div className="bg-muted/50 p-3 rounded-lg space-y-2">
                <div className="flex justify-between text-xs font-bold uppercase text-muted-foreground border-bottom pb-1">
                  <span>Product</span>
                  <span>Qty</span>
                </div>
                {selectedOrders.map((o, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{o.productName}</span>
                    <span className="font-mono font-bold">{o.fulfilledQty ?? o.quantity}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Batch No</Label>
                  <Select
                    value={challanForm.batchNo}
                    onValueChange={v => setChallanForm({...challanForm, batchNo: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Batch" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedOrdersBatchOptions.map(bNo => {
                        const batchVal = bNo || "0";
                        const matchedBatch = selectedProductBatches.find(b => (b.batchNumber || "0") === batchVal);
                        const avail = matchedBatch ? matchedBatch.availableQty : 0;
                        return (
                          <SelectItem key={batchVal} value={batchVal}>
                            {batchVal} {matchedBatch ? `(Avail: ${avail})` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input placeholder="Driver, instructions..." value={challanForm.notes} onChange={e => setChallanForm({...challanForm, notes: e.target.value})} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={handleCreateChallan} className="w-full">Generate & Save Challan ({selectedOrders.length} Items)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
