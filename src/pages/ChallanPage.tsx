import { useState, useEffect, useCallback, useMemo } from "react";
import { getChallans, updateChallan, deleteChallan, exportCSV, Challan } from "@/lib/store";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Printer, Trash2, Pencil, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export default function ChallanPage() {
  const [challans, setChallans] = useState<Challan[]>([]);
  const [editingChallan, setEditingChallan] = useState<any>(null);
  const { toast } = useToast();

  const groupedChallans = useMemo(() => {
    const groups: Record<string, Challan[]> = {};
    challans.forEach(c => {
      if (!groups[c.challanNumber]) groups[c.challanNumber] = [];
      groups[c.challanNumber].push(c);
    });
    return Object.entries(groups).map(([challanNumber, items]) => ({
      challanNumber,
      clientName: items[0].clientName,
      date: items[0].date,
      items: items,
      isPrinted: items.every(i => i.isPrinted),
      id: items[0].id // Use first item's ID for keys/editing
    })).sort((a, b) => b.date.localeCompare(a.date));
  }, [challans]);

  const refresh = useCallback(() => getChallans().then(setChallans), []);
  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (challanNumber: string) => {
    const password = window.prompt("Please enter admin password to delete entire challan:");
    if (password !== 'admin') {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (window.confirm(`Are you sure you want to delete challan ${challanNumber} and all its items?`)) {
      const itemsToDelete = challans.filter(c => c.challanNumber === challanNumber);
      for (const item of itemsToDelete) {
        await deleteChallan(item.id);
      }
      refresh();
      toast({ title: "Challan deleted" });
    }
  };

  const handleEditSave = async () => {
    if (!editingChallan) return;
    // Note: editing a grouped challan is complex, so we edit the first item for now or implement multi-edit
    await updateChallan(editingChallan.id, editingChallan);
    refresh();
    setEditingChallan(null);
    toast({ title: "Challan updated" });
  };

  const printChallan = async (group: any) => {
    const printId = `print-challan-${group.challanNumber}`;
    const el = document.getElementById(printId);
    if (el) {
      printElement(printId);
      const unprinted = group.items.filter((i: any) => !i.isPrinted);
      for (const item of unprinted) {
        await updateChallan(item.id, { isPrinted: true });
      }
      refresh();
    }
  };

  const downloadCheat = async (group: any) => {
    const win = window.open('', '_blank');
    if (!win) return;
    
    const itemsHtml = group.items.map((i: any) => `
      <div class="item-row">
        ${i.productName}<br/>
        QTY: ${i.quantity}
        ${i.notes ? `<div style="font-size: 8pt; color: #666;">Note: ${i.notes}</div>` : ''}
      </div>
    `).join('');

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
            <div class="title">PLYWOOD PRO</div>
            <div class="subtitle">DELIVERY SLIP</div>
          </div>
          <div class="details">
            <div style="margin-bottom: 3mm; font-weight: 900; font-size: 14pt; border-bottom: 2px solid #000; padding-bottom: 1mm; text-align: center;">CLIENT: ${group.clientName}</div>
            <div class="row"><span>Challan:</span> <span>${group.challanNumber}</span></div>
            <div class="row"><span>Date:</span> <span>${group.date}</span></div>
            ${itemsHtml}
          </div>
          <div class="footer">AUTHORIZED SIGNATORY</div>
        </div>
      </body></html>`);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
      win.close();
      const unprinted = group.items.filter((i: any) => !i.isPrinted);
      if (unprinted.length > 0) {
        Promise.all(unprinted.map((i: any) => updateChallan(i.id, { isPrinted: true }))).then(refresh);
      }
    }, 500);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Delivery Challans</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(challans as any, `challans-${new Date().toISOString().slice(0,10)}.csv`)}><Download className="mr-1 h-4 w-4" />Export</Button>
        </div>
      </div>

      <Card><CardContent className="p-0"><div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Challan #</TableHead><TableHead>Client</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>Date</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {groupedChallans.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No challans yet</TableCell></TableRow>
            : groupedChallans.map(group => (
              <TableRow key={group.challanNumber} className={group.isPrinted ? "bg-green-50/50" : ""}>
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span>{group.challanNumber}</span>
                    {group.isPrinted && (
                      <Badge variant="secondary" className="w-fit mt-1 bg-green-100 text-green-700 hover:bg-green-100 flex gap-1 h-5 px-1.5 border-green-200">
                        <CheckCircle2 className="h-3 w-3" /> Printed
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{group.clientName}</TableCell>
                <TableCell>
                  <div className="text-sm space-y-1">
                    {group.items.map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between gap-4 border-b border-dashed last:border-0 pb-1">
                        <span className="text-muted-foreground">{item.productName}</span>
                        <span className="font-bold">{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{group.date}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => printChallan(group)} title="Print Full Challan">
                      <Printer className="h-4 w-4 text-primary" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => downloadCheat(group)} title="Download Cheat Slip">
                      <Download className="h-4 w-4 text-success" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(group.challanNumber)} title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="hidden">
                    <div id={`print-challan-${group.challanNumber}`}>
                      <div className="header" style={{ borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '20px', textAlign: 'center' }}>
                        <h1 style={{ margin: 0, fontSize: '24pt' }}>PLYWOOD PRO</h1>
                        <p style={{ margin: 0 }}>Plywood & Hardware Management System</p>
                      </div>
                      <h2 style={{ textAlign: 'center', textDecoration: 'underline', marginBottom: '20px' }}>DELIVERY CHALLAN</h2>
                      <div style={{ marginBottom: '20px' }}>
                        <p><strong>CLIENT:</strong> {group.clientName}</p>
                        <p><strong>Challan No:</strong> {group.challanNumber}</p>
                        <p><strong>Date:</strong> {group.date}</p>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f5f5f5' }}>
                            <th style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'left' }}>Product</th>
                            <th style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'right' }}>Quantity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item: any, idx: number) => (
                            <tr key={idx}>
                              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{item.productName}</td>
                              <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'right' }}>{item.quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {group.items[0].notes && (
                        <div style={{ marginBottom: '20px', padding: '10px', border: '1px solid #eee', backgroundColor: '#fafafa' }}>
                          <p style={{ margin: 0 }}><strong>NOTES:</strong> {group.items[0].notes}</p>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '50px' }}>
                        <div>Receiver's Signature</div>
                        <div>For PLYWOOD PRO</div>
                      </div>
                    </div>
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
