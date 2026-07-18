import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getChallans,
  updateChallan,
  updateChallanGroup,
  deleteChallan,
  cancelChallanGroup,
  exportCSV,
  Challan,
} from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Download,
  Printer,
  Trash2,
  Pencil,
  CheckSquare,
  CheckCircle2,
  Ban,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function ChallanPage() {
  const [challans, setChallans] = useState<Challan[]>([]);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const { toast } = useToast();

  const groupedChallans = useMemo(() => {
    const groups: Record<string, Challan[]> = {};
    challans.forEach((c) => {
      if (!groups[c.challanNumber]) groups[c.challanNumber] = [];
      groups[c.challanNumber].push(c);
    });
    return Object.entries(groups)
      .map(([challanNumber, items]) => ({
        challanNumber,
        clientName: items[0].clientName,
        date: items[0].date,
        items: items,
        isPrinted: items.every((i) => i.isPrinted),
        isBuilt: items.every((i) => i.isBuilt),
        id: items[0].id, // Use first item's ID for keys/editing
      }))
      .sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });
  }, [challans]);

  const openEditDialog = (group: any) => {
    setEditingGroup({
      challanNumber: group.challanNumber,
      clientName: group.clientName,
      clientPhone: group.items[0]?.clientPhone || "",
      date: group.date,
      items: group.items.map((item: Challan) => ({
        id: item.id,
        productName: item.productName,
        quantity: item.quantity,
        originalQuantity: item.quantity,
        batchNo: item.batchNo,
        notes: item.notes || "",
        stockCategory: item.stockCategory || "Available",
      })),
    });
  };

  const refresh = useCallback(() => getChallans().then(setChallans), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDelete = async (challanNumber: string) => {
    const password = window.prompt(
      "Please enter admin password to delete entire challan:",
    );
    if (password !== "admin") {
      if (password !== null)
        toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (
      window.confirm(
        `Are you sure you want to delete challan ${challanNumber} and all its items?`,
      )
    ) {
      const itemsToDelete = challans.filter(
        (c) => c.challanNumber === challanNumber,
      );
      for (const item of itemsToDelete) {
        await deleteChallan(item.id);
      }
      refresh();
      toast({ title: "Challan deleted" });
    }
  };

  const handleEditSave = async () => {
    if (!editingGroup) return;
    await updateChallanGroup(editingGroup.challanNumber, editingGroup);
    window.dispatchEvent(new CustomEvent("erp-stock-updated"));
    refresh();
    setEditingGroup(null);
    toast({ title: "Challan updated" });
  };

  const handleBuildToggle = async (group: any, nextBuilt: boolean) => {
    if (group.items.some((item: Challan) => item.isCancelled)) {
      toast({ title: "Cancelled challan", description: "Cancelled challans cannot be marked as built.", variant: "destructive" });
      return;
    }
    await Promise.all(group.items.map((item: Challan) => updateChallan(item.id, { isBuilt: nextBuilt })));
    refresh();
    toast({ title: nextBuilt ? "Challan marked as built" : "Built mark removed" });
  };

  const handleCancel = async (challanNumber: string) => {
    const ok = window.confirm(
      `Cancel challan ${challanNumber}? Stock will be restored.`,
    );
    if (!ok) return;
    await cancelChallanGroup(challanNumber);
    window.dispatchEvent(new CustomEvent("erp-stock-updated"));
    refresh();
    toast({ title: "Challan cancelled" });
  };

  const getQuantityDeltaLabel = (item: any) => {
    const original = Number(item.originalQuantity || 0);
    const current = Number(item.quantity || 0);
    const diff = current - original;
    if (diff === 0) return "No stock change";
    if (diff < 0) return `+${Math.abs(diff)} stock will return`;
    return `-${diff} stock will be deducted`;
  };

  const printChallan = async (group: any) => {
    const win = window.open("", "_blank");
    if (!win) return;

    const rowsHtml = group.items
      .map((item: any) => {
        const netQty = item.quantity - (item.returnedQty || 0);
        const returnLabel = item.returnedQty > 0 ? ` (${item.returnedQty} returned)` : '';
        return `
          <tr>
            <td>${item.productName}</td>
            <td>${item.stockCategory || 'Available'}</td>
            <td style="text-align:right;">${netQty}${returnLabel}</td>
          </tr>
        `;
      })
      .join("");

    win.document.write(`<!DOCTYPE html><html><head><title></title>
    <style>
      @page { size: 653px 266px; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
      html, body {
        width: 653px;
        height: 266px;
        margin: 0;
        padding: 0;
        overflow: hidden;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 9px;
      }
      .challan {
        width: 653px;
        height: 266px;
        padding: 8px 12px;
        display: flex;
        flex-direction: column;
      }
      .header { text-align: center; border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 6px; }
      .header h1 { margin: 0; font-size: 14px; }
      .header p { margin: 0; font-size: 8px; }
      .meta { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 9px; }
      table { width: 100%; border-collapse: collapse; flex: 1; }
      th, td { border: 1px solid #ccc; padding: 3px 6px; font-size: 9px; }
      th { background: #f5f5f5; text-align: left; }
      .footer { display: flex; justify-content: space-between; margin-top: 6px; font-size: 8px; }
    </style></head><body>
      <div class="challan">
        <div class="header">
          <h1>PLYWOOD PRO</h1>
          <p>DELIVERY CHALLAN</p>
        </div>
        <div class="meta">
          <span><strong>Client:</strong> ${group.clientName}</span>
          <span><strong>Challan #:</strong> ${group.challanNumber}</span>
          <span><strong>Date:</strong> ${group.date ? format(new Date(group.date), "dd-MM-yyyy") : ""}</span>
        </div>
        <table>
          <thead><tr><th>Product</th><th>Category</th><th style="text-align:right;">Quantity</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="footer">
          <span>Receiver's Signature</span>
          <span>For PLYWOOD PRO</span>
        </div>
      </div>
    </body></html>`);
    win.document.close();

    setTimeout(async () => {
      win.focus();
      win.print();
      win.close();
      const unprinted = group.items.filter((i: any) => !i.isPrinted);
      if (unprinted.length > 0) {
        await Promise.all(
          unprinted.map((i: any) => updateChallan(i.id, { isPrinted: true })),
        );
        refresh();
      }
    }, 500);
  };

  const downloadCheat = async (group: any) => {
    const win = window.open("", "_blank");
    if (!win) return;

    const itemsHtml = group.items
      .map((i: any) => {
        const netQty = i.quantity - (i.returnedQty || 0);
        const returnLabel = i.returnedQty > 0 ? ` (${i.returnedQty} returned)` : '';
        return `
          <div class="item-row">
            ${i.productName}<br/>
            QTY: ${netQty}${returnLabel} [${i.stockCategory || 'Available'}]
            ${i.notes ? `<div style="font-size: 8pt; color: #666;">Note: ${i.notes}</div>` : ""}
          </div>
        `;
      })
      .join("");

    win.document.write(`<!DOCTYPE html><html><head><title></title>
      <style>
        @page { size: 80mm auto; margin: 0 !important; }
        @media print { html, body { width: 80mm !important; margin: 0 !important; padding: 0 !important; overflow: hidden; } }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
        body { font-family: 'Courier New', Courier, monospace; width: 80mm !important; padding: 0 !important; margin: 0 !important; background: #fff; }
        .cheat-container { border: 2px solid #000; padding: 2mm; width: 78mm; margin: 0 !important; float: left; }
        .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 2mm; margin-bottom: 3mm; }
        .title { font-size: 16pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
        .subtitle { font-size: 10pt; font-weight: bold; margin-top: 1mm; border: 1px solid #000; display: inline-block; padding: 1px 5px; }
        .details { font-size: 11pt; line-height: 1.3; margin-top: 3mm; }
        .row { display: flex; justify-content: space-between; margin-bottom: 1.5mm; border-bottom: 1px dashed #999; }
        .item-row { margin-top: 4mm; font-weight: 900; font-size: 13pt; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 2mm 0; text-align: center; }
        .footer { text-align: center; margin-top: 6mm; border-top: 1px solid #000; padding-top: 3mm; font-size: 9pt; font-weight: bold; }
      </style></head><body>
        <div class="cheat-container">
          <div class="header">
            
            <div class="subtitle">DELIVERY SLIP</div>
          </div>
          <div class="details">
            <div style="margin-bottom: 3mm; font-weight: 900; font-size: 14pt; border-bottom: 2px solid #000; padding-bottom: 1mm; text-align: center;">CLIENT: ${group.clientName}</div>
            <div class="row"><span>Challan:</span> <span>${group.challanNumber}</span></div>
            <div class="row"><span>Date:</span> <span>${group.date ? format(new Date(group.date), "dd-MM-yyyy") : ""}</span></div>
            ${itemsHtml}
          </div>  
        </div>
      </body></html>`);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
      win.close();
      const unprinted = group.items.filter((i: any) => !i.isPrinted);
      if (unprinted.length > 0) {
        Promise.all(
          unprinted.map((i: any) => updateChallan(i.id, { isPrinted: true })),
        ).then(refresh);
      }
    }, 500);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Delivery Challans</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportCSV(
                challans as any,
                `challans-${new Date().toISOString().slice(0, 10)}.csv`,
              )
            }
          >
            <Download className="mr-1 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Challan #</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedChallans.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      No challans yet
                    </TableCell>
                  </TableRow>
                ) : (
                  groupedChallans.map((group) => (
                    <TableRow
                      key={group.challanNumber}
                      className={`${group.isBuilt ? "bg-blue-50/60" : ""} ${group.isPrinted ? "bg-green-50/50" : ""} ${group.items.some((i) => i.isCancelled) ? "bg-red-50/70 border-l-4 border-l-red-500" : ""}`}
                    >
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{group.challanNumber}</span>
                          <label className={`mt-1 flex items-center gap-2 text-xs w-fit ${group.items.some((i) => i.isCancelled) ? "text-muted-foreground/60 cursor-not-allowed" : "text-muted-foreground cursor-pointer"}`}>
                            <input
                              type="checkbox"
                              checked={group.isBuilt}
                              disabled={group.items.some((i) => i.isCancelled)}
                              onChange={(e) => handleBuildToggle(group, e.target.checked)}
                            />
                            <span>{group.isBuilt ? "Billed" : "Mark as billed"}</span>
                          </label>
                          {group.isPrinted && (
                            <Badge
                              variant="secondary"
                              className="w-fit mt-1 bg-green-100 text-green-700 hover:bg-green-100 flex gap-1 h-5 px-1.5 border-green-200"
                            >
                              <CheckCircle2 className="h-3 w-3" /> Printed
                            </Badge>
                          )}

                          {group.isBuilt && (
                            <Badge
                              variant="secondary"
                              className="w-fit mt-1 bg-blue-100 text-blue-700 hover:bg-blue-100 flex gap-1 h-5 px-1.5 border-blue-200"
                            >
                              <CheckSquare className="h-3 w-3" /> Billed
                            </Badge>
                          )}

                          {group.items.some((i) => i.isCancelled) && (
                            <Badge
                              variant="destructive"
                              className="w-fit mt-1 flex gap-1 h-5 px-1.5"
                            >
                              Cancelled
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{group.clientName}</TableCell>
                      <TableCell>
                        <div className="text-sm space-y-1">
                          {group.items.map((item: any, idx: number) => (
                            <div
                              key={idx}
                              className="flex justify-between gap-4 border-b border-dashed last:border-0 pb-1"
                            >
                              <span className="text-muted-foreground flex items-center gap-1.5 flex-wrap">
                                <span>{item.productName}</span>
                                {item.batchNo && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-muted text-muted-foreground border border-muted-foreground/20">
                                    Batch: {item.batchNo}
                                  </span>
                                )}
                                {item.stockCategory && (
                                  <span className={`text-[10px] px-1 rounded font-bold ${
                                    item.stockCategory === 'Display' ? 'bg-amber-100 text-amber-800' :
                                    item.stockCategory === 'Damage' ? 'bg-red-100 text-red-800' :
                                    'bg-blue-100 text-blue-800'
                                  }`}>
                                    {item.stockCategory}
                                  </span>
                                )}
                              </span>
                              <span className="font-bold">
                                {item.returnedQty > 0 ? (
                                  <span>
                                    {item.quantity - item.returnedQty}
                                    <span className="text-[10px] text-muted-foreground ml-1 font-normal">
                                      ({item.returnedQty} returned)
                                    </span>
                                  </span>
                                ) : (
                                  item.quantity
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {group.date
                          ? format(new Date(group.date), "dd-MM-yyyy")
                          : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => downloadCheat(group)}
                            title="Print Full Challan"
                          >
                            <Printer className="h-4 w-4 text-primary" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => downloadCheat(group)}
                            title="Download Cheat Slip"
                          >
                            <Download className="h-4 w-4 text-success" />
                          </Button>
                          <Dialog
                            open={
                              !!editingGroup &&
                              editingGroup.challanNumber === group.challanNumber
                            }
                            onOpenChange={(open) =>
                              !open && setEditingGroup(null)
                            }
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-blue-600"
                                onClick={() => openEditDialog(group)}
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>Edit Challan</DialogTitle>
                                <DialogDescription>
                                  Update client details, items, and quantities.
                                  Stock will be adjusted automatically.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                  <Label>Client Name</Label>
                                  <Input
                                    value={editingGroup?.clientName || ""}
                                    onChange={(e) =>
                                      setEditingGroup({
                                        ...editingGroup,
                                        clientName: e.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="grid gap-2">
                                  <Label>Client Phone</Label>
                                  <Input
                                    value={editingGroup?.clientPhone || ""}
                                    onChange={(e) =>
                                      setEditingGroup({
                                        ...editingGroup,
                                        clientPhone: e.target.value,
                                      })
                                    }
                                  />
                                </div>
                            <div className="grid gap-2">
                              <Label>Challan Date</Label>
                              <Input
                                type="date"
                                value={editingGroup?.date || ""}
                                    onChange={(e) =>
                                      setEditingGroup({
                                        ...editingGroup,
                                        date: e.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-3">
                                  <div className="font-semibold">Items</div>
                                  {editingGroup?.items?.map(
                                    (item: any, idx: number) => (
                                      <div
                                        key={item.id || idx}
                                        className="grid grid-cols-12 gap-2 items-end"
                                      >
                                        <div className="col-span-4">
                                          <Label className="text-xs">
                                            Product
                                          </Label>
                                          <Input
                                            value={item.productName}
                                            onChange={(e) => {
                                              const next = [
                                                ...editingGroup.items,
                                              ];
                                              next[idx] = {
                                                ...next[idx],
                                                productName: e.target.value,
                                              };
                                              setEditingGroup({
                                                ...editingGroup,
                                                items: next,
                                              });
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-3">
                                          <Label className="text-xs">
                                            Quantity
                                          </Label>
                                          <Input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => {
                                              const next = [
                                                ...editingGroup.items,
                                              ];
                                              next[idx] = {
                                                ...next[idx],
                                                quantity: +e.target.value,
                                              };
                                              setEditingGroup({
                                                ...editingGroup,
                                                items: next,
                                              });
                                            }}
                                          />
                                          <div className="mt-1 text-[11px] text-muted-foreground">
                                            {getQuantityDeltaLabel(item)}
                                          </div>
                                        </div>
                                        <div className="col-span-3">
                                          <Label className="text-xs">
                                            Category
                                          </Label>
                                          <Select
                                            value={item.stockCategory || "Available"}
                                            onValueChange={(v) => {
                                              const next = [
                                                ...editingGroup.items,
                                              ];
                                              next[idx] = {
                                                ...next[idx],
                                                stockCategory: v,
                                              };
                                              setEditingGroup({
                                                ...editingGroup,
                                                items: next,
                                              });
                                            }}
                                          >
                                            <SelectTrigger className="w-full">
                                              <SelectValue placeholder="Select Category" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="Available">Available</SelectItem>
                                              <SelectItem value="Display">Display</SelectItem>
                                              <SelectItem value="Damage">Damage</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <div className="col-span-2">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                              const next =
                                                editingGroup.items.filter(
                                                  (_: any, i: number) =>
                                                    i !== idx,
                                                );
                                              setEditingGroup({
                                                ...editingGroup,
                                                items: next,
                                              });
                                            }}
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      </div>
                                    ),
                                  )}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setEditingGroup({
                                        ...editingGroup,
                                        items: [
                                          ...editingGroup.items,
                                          {
                                            productName: "",
                                            quantity: 0,
                                            batchNo: "",
                                            notes: "",
                                            stockCategory: "Available",
                                          },
                                        ],
                                      })
                                    }
                                  >
                                    Add Item
                                  </Button>
                                </div>
                              </div>

                              <DialogFooter>
                              <Button onClick={handleEditSave}>
                                  Save Changes
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleCancel(group.challanNumber)}
                            title="Cancel Challan"
                          >
                            <Ban className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDelete(group.challanNumber)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="hidden">
                          <div id={`print-challan-${group.challanNumber}`}>
                            <div
                              className="header"
                              style={{
                                borderBottom: "2px solid #333",
                                paddingBottom: "10px",
                                marginBottom: "20px",
                                textAlign: "center",
                              }}
                            >
                              <h1 style={{ margin: 0, fontSize: "24pt" }}>
                                PLYWOOD PRO
                              </h1>
                              <p style={{ margin: 0 }}>
                                Plywood & Hardware Management System
                              </p>
                            </div>
                            <h2
                              style={{
                                textAlign: "center",
                                textDecoration: "underline",
                                marginBottom: "20px",
                              }}
                            >
                              DELIVERY CHALLAN
                            </h2>
                            <div style={{ marginBottom: "20px" }}>
                              <p>
                                <strong>CLIENT:</strong> {group.clientName}
                              </p>
                              <p>
                                <strong>Challan No:</strong>{" "}
                                {group.challanNumber}
                              </p>
                              <p>
                                <strong>Date:</strong>{" "}
                                {group.date
                                  ? format(new Date(group.date), "dd-MM-yyyy")
                                  : ""}
                              </p>
                            </div>
                            <table
                              style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                marginBottom: "20px",
                              }}
                            >
                              <thead>
                                <tr style={{ backgroundColor: "#f5f5f5" }}>
                                  <th
                                    style={{
                                      border: "1px solid #ddd",
                                      padding: "8px",
                                      textAlign: "left",
                                    }}
                                  >
                                    Product
                                  </th>
                                  <th
                                    style={{
                                      border: "1px solid #ddd",
                                      padding: "8px",
                                      textAlign: "right",
                                    }}
                                  >
                                    Quantity
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.items.map((item: any, idx: number) => (
                                  <tr key={idx}>
                                    <td
                                      style={{
                                        border: "1px solid #ddd",
                                        padding: "8px",
                                      }}
                                    >
                                      {item.productName}
                                    </td>
                                    <td
                                      style={{
                                        border: "1px solid #ddd",
                                        padding: "8px",
                                        textAlign: "right",
                                      }}
                                    >
                                      {item.quantity}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {group.items[0].notes && (
                              <div
                                style={{
                                  marginBottom: "20px",
                                  padding: "10px",
                                  border: "1px solid #eee",
                                  backgroundColor: "#fafafa",
                                }}
                              >
                                <p style={{ margin: 0 }}>
                                  <strong>NOTES:</strong> {group.items[0].notes}
                                </p>
                              </div>
                            )}
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginTop: "50px",
                              }}
                            >
                              <div>Receiver's Signature</div>
                              <div>For PLYWOOD PRO</div>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
