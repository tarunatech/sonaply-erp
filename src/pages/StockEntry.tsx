import { useState, useMemo } from "react";
import { addBatch, getBatches, CATEGORIES, THICKNESSES, LOCATIONS } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PackagePlus } from "lucide-react";

const defaultForm = { productCode: '', productName: '', category: 'Laminate', thickness: '18mm', batchNumber: '', supplier: '', quantity: 0, date: new Date().toISOString().slice(0, 10), warehouseLocation: 'Warehouse A' };

export default function StockEntry() {
  const [form, setForm] = useState(defaultForm);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showCodeSuggestions, setShowCodeSuggestions] = useState(false);
  const { toast } = useToast();
  
  const uniqueNames = useMemo(() => Array.from(new Set(getBatches().map(b => b.productName).filter(Boolean))), []);
  const uniqueCodes = useMemo(() => Array.from(new Set(getBatches().map(b => b.productCode).filter(Boolean))), []);

  const validProductCodes = useMemo(() => new Set(uniqueCodes), [uniqueCodes]);
  const isValidProductCode = form.productCode && validProductCodes.has(form.productCode);

  const handleSubmit = () => {
    if (!form.productName || !form.productCode || form.quantity <= 0) {
      toast({ title: "Please fill all required fields", variant: "destructive" }); return;
    }
    if (!isValidProductCode) {
      toast({ title: "Please select a valid product number from the list", variant: "destructive" }); return;
    }
    addBatch({ ...form, rate: 0, productId: '', availableQty: form.quantity, damageQty: 0, nilQty: 0 });
    toast({ title: "Stock batch added successfully!" });
    setForm(defaultForm);
  };

  const u = (key: string, val: string | number) => setForm({ ...form, [key]: val });

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Stock Entry (Batch Wise)</h1>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative">
              <Label>Product Name *</Label>
              <Input 
                value={form.productName} 
                onChange={e => {
                  u('productName', e.target.value);
                  setShowNameSuggestions(true);
                }} 
                onFocus={() => setShowNameSuggestions(true)}
                onBlur={() => setTimeout(() => setShowNameSuggestions(false), 200)}
                autoComplete="off"
              />
              {showNameSuggestions && (
                <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                  {uniqueNames
                    .filter(n => !form.productName || n.toLowerCase().includes(form.productName.toLowerCase()))
                    .map(n => (
                      <div 
                        key={n} 
                        className="px-3 py-2 cursor-pointer hover:bg-accent text-sm text-popover-foreground"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          u('productName', n);
                          setShowNameSuggestions(false);
                        }}
                      >
                        {n}
                      </div>
                  ))}
                  {uniqueNames.filter(n => !form.productName || n.toLowerCase().includes(form.productName.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No matches found.</div>
                  )}
                </div>
              )}
            </div>
            <div className="relative">
              <Label>Product Number *</Label>
              <Input 
                value={form.productCode} 
                onChange={e => {
                  u('productCode', e.target.value);
                  setShowCodeSuggestions(true);
                }} 
                onFocus={() => setShowCodeSuggestions(true)}
                onBlur={() => setTimeout(() => setShowCodeSuggestions(false), 200)}
                placeholder="Type or select..."
                autoComplete="off"
                className={form.productCode && !isValidProductCode ? 'border-destructive' : ''}
              />
              {form.productCode && !isValidProductCode && (
                <p className="text-xs text-destructive mt-1">Please select from the dropdown list</p>
              )}
              {showCodeSuggestions && (
                <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                  {uniqueCodes
                    .filter(c => !form.productCode || c.toLowerCase().includes(form.productCode.toLowerCase()))
                    .map(c => (
                      <div 
                        key={c} 
                        className="px-3 py-2 cursor-pointer hover:bg-accent text-sm text-popover-foreground"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          u('productCode', c);
                          setShowCodeSuggestions(false);
                        }}
                      >
                        {c}
                      </div>
                  ))}
                  {uniqueCodes.filter(c => !form.productCode || c.toLowerCase().includes(form.productCode.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No matches found.</div>
                  )}
                </div>
              )}
            </div>
            <div><Label>Category</Label>
              <Input value="Laminate" readOnly className="bg-muted text-muted-foreground" />
            </div>
            <div><Label>Thickness</Label>
              <Select value={form.thickness} onValueChange={v => u('thickness', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{THICKNESSES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label>Batch Number</Label><Input value={form.batchNumber} onChange={e => u('batchNumber', e.target.value)} /></div>
            <div><Label>Supplier / Party</Label><Input value={form.supplier} onChange={e => u('supplier', e.target.value)} /></div>
            <div><Label>Quantity *</Label><Input type="number" value={form.quantity || ''} onChange={e => u('quantity', +e.target.value)} /></div>
            <div><Label>Date</Label><Input type="date" value={form.date} readOnly className="bg-muted text-muted-foreground" /></div>
            <div><Label>Warehouse Location</Label>
              <Select value={form.warehouseLocation} onValueChange={v => u('warehouseLocation', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          <Button className="w-full" onClick={handleSubmit}><PackagePlus className="mr-2 h-4 w-4" />Add Stock Batch</Button>
        </CardContent>
      </Card>
    </div>
  );
}
