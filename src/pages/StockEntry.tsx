import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { addBatch, getBatches, updateBatch, StockBatch } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PackagePlus } from "lucide-react";

const defaultForm = { productCode: '', productName: '', category: '', batchNumber: '', supplier: '', quantity: 0, date: new Date().toISOString().slice(0, 10) };

export default function StockEntry() {
  const [form, setForm] = useState(defaultForm);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);
  
  const [selectedNameIndex, setSelectedNameIndex] = useState(-1);
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(-1);
  const [selectedSupplierIndex, setSelectedSupplierIndex] = useState(-1);

  const nameContainerRef = useRef<HTMLDivElement>(null);
  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const supplierContainerRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  
  const refresh = useCallback(() => getBatches().then(setBatches), []);
  useEffect(() => { refresh(); }, [refresh]);

  const uniqueNames = useMemo(() => Array.from(new Set(batches.map(b => b.productName).filter(Boolean))), [batches]);
  const uniqueCodes = useMemo(() => Array.from(new Set(batches.map(b => b.productCode).filter(Boolean))), [batches]);
  const uniqueCategories = useMemo(() => Array.from(new Set(batches.map(b => b.category).filter(Boolean))).sort(), [batches]);
  const uniqueSuppliers = useMemo(() => Array.from(new Set(batches.map(b => b.supplier).filter(Boolean))).sort(), [batches]);

  const scrollToSelected = (containerRef: React.RefObject<HTMLDivElement>, index: number) => {
    if (index >= 0 && containerRef.current) {
      const activeElement = containerRef.current.children[index] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  useEffect(() => scrollToSelected(nameContainerRef, selectedNameIndex), [selectedNameIndex]);
  useEffect(() => scrollToSelected(categoryContainerRef, selectedCategoryIndex), [selectedCategoryIndex]);
  useEffect(() => scrollToSelected(supplierContainerRef, selectedSupplierIndex), [selectedSupplierIndex]);

  const handleSubmit = async () => {
    if (!form.productName || form.quantity <= 0) {
      toast({ title: "Please fill all required fields", variant: "destructive" }); return;
    }

    // Check for existing batch to merge (Match: Name, Category)
    const existing = batches.find(b => 
      b.productName.toLowerCase().trim() === form.productName.toLowerCase().trim() &&
      b.category.toLowerCase().trim() === form.category.toLowerCase().trim()
    );

    if (existing) {
      await updateBatch(existing.id, {
        quantity: existing.quantity + form.quantity,
        availableQty: (existing.availableQty || 0) + form.quantity
      });
      toast({ title: "Stock updated (Merged with existing batch)" });
    } else {
      await addBatch({ ...form, rate: 0, productId: null as any, availableQty: form.quantity, damageQty: 0, nilQty: 0 });
      toast({ title: "Stock batch added successfully!" });
    }

    setForm(defaultForm);
    refresh();
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
                onFocus={() => {
                  setShowNameSuggestions(true);
                  setSelectedNameIndex(-1);
                }}
                onBlur={() => setTimeout(() => {
                  setShowNameSuggestions(false);
                  setSelectedNameIndex(-1);
                }, 200)}
                onKeyDown={e => {
                  const filtered = uniqueNames.filter(n => !form.productName || n.toLowerCase().includes(form.productName.toLowerCase()));
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedNameIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedNameIndex(prev => (prev > 0 ? prev - 1 : prev));
                  } else if (e.key === 'Enter') {
                    if (selectedNameIndex >= 0 && selectedNameIndex < filtered.length) {
                      e.preventDefault();
                      setForm(prev => ({ ...prev, productName: filtered[selectedNameIndex] }));
                      setShowNameSuggestions(false);
                      setSelectedNameIndex(-1);
                    }
                  } else if (e.key === 'Escape') {
                    setShowNameSuggestions(false);
                    setSelectedNameIndex(-1);
                  }
                }}
                autoComplete="off"
              />
              {showNameSuggestions && (
                <div ref={nameContainerRef} className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                  {uniqueNames
                    .filter(n => !form.productName || n.toLowerCase().includes(form.productName.toLowerCase()))
                    .map((n, i) => (
                      <div 
                        key={n} 
                        className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedNameIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setForm(prev => ({ ...prev, productName: n }));
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
              <Label>Category</Label>
              <Input 
                value={form.category} 
                onChange={e => {
                  u('category', e.target.value);
                  setShowCategorySuggestions(true);
                }} 
                onFocus={() => {
                  setShowCategorySuggestions(true);
                  setSelectedCategoryIndex(-1);
                }}
                onBlur={() => setTimeout(() => {
                  setShowCategorySuggestions(false);
                  setSelectedCategoryIndex(-1);
                }, 200)}
                onKeyDown={e => {
                  const filtered = uniqueCategories.filter(c => !form.category || c.toLowerCase().includes(form.category.toLowerCase()));
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedCategoryIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedCategoryIndex(prev => (prev > 0 ? prev - 1 : prev));
                  } else if (e.key === 'Enter') {
                    if (selectedCategoryIndex >= 0 && selectedCategoryIndex < filtered.length) {
                      e.preventDefault();
                      u('category', filtered[selectedCategoryIndex]);
                      setShowCategorySuggestions(false);
                      setSelectedCategoryIndex(-1);
                    }
                  } else if (e.key === 'Escape') {
                    setShowCategorySuggestions(false);
                    setSelectedCategoryIndex(-1);
                  }
                }}
                placeholder="Category" 
                autoComplete="off"
              />
              {showCategorySuggestions && (
                <div ref={categoryContainerRef} className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                  {uniqueCategories
                    .filter(c => !form.category || c.toLowerCase().includes(form.category.toLowerCase()))
                    .map((c, i) => (
                      <div 
                        key={c} 
                        className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedCategoryIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          u('category', c);
                          setShowCategorySuggestions(false);
                        }}
                      >
                        {c}
                      </div>
                  ))}
                  {uniqueCategories.filter(c => !form.category || c.toLowerCase().includes(form.category.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No matches found.</div>
                  )}
                </div>
              )}
            </div>

            <div><Label>Batch Number</Label><Input value={form.batchNumber} onChange={e => u('batchNumber', e.target.value)} /></div>
            <div className="relative">
              <Label>Supplier / Party</Label>
              <Input 
                value={form.supplier} 
                onChange={e => {
                  u('supplier', e.target.value);
                  setShowSupplierSuggestions(true);
                }} 
                onFocus={() => {
                  setShowSupplierSuggestions(true);
                  setSelectedSupplierIndex(-1);
                }}
                onBlur={() => setTimeout(() => {
                  setShowSupplierSuggestions(false);
                  setSelectedSupplierIndex(-1);
                }, 200)}
                onKeyDown={e => {
                  const filtered = uniqueSuppliers.filter(s => !form.supplier || s.toLowerCase().includes(form.supplier.toLowerCase()));
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedSupplierIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedSupplierIndex(prev => (prev > 0 ? prev - 1 : prev));
                  } else if (e.key === 'Enter') {
                    if (selectedSupplierIndex >= 0 && selectedSupplierIndex < filtered.length) {
                      e.preventDefault();
                      u('supplier', filtered[selectedSupplierIndex]);
                      setShowSupplierSuggestions(false);
                      setSelectedSupplierIndex(-1);
                    }
                  } else if (e.key === 'Escape') {
                    setShowSupplierSuggestions(false);
                    setSelectedSupplierIndex(-1);
                  }
                }}
                placeholder="Supplier Name"
                autoComplete="off"
              />
              {showSupplierSuggestions && (
                <div ref={supplierContainerRef} className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                  {uniqueSuppliers
                    .filter(s => !form.supplier || s.toLowerCase().includes(form.supplier.toLowerCase()))
                    .map((s, i) => (
                      <div 
                        key={s} 
                        className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedSupplierIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          u('supplier', s);
                          setShowSupplierSuggestions(false);
                        }}
                      >
                        {s}
                      </div>
                  ))}
                  {uniqueSuppliers.filter(s => !form.supplier || s.toLowerCase().includes(form.supplier.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No matches found.</div>
                  )}
                </div>
              )}
            </div>
            <div><Label>Quantity *</Label><Input type="number" value={form.quantity || ''} onChange={e => u('quantity', +e.target.value)} /></div>
            <div><Label>Date</Label><Input type="date" value={form.date} readOnly className="bg-muted text-muted-foreground" /></div>

          </div>
          <Button className="w-full" onClick={handleSubmit}><PackagePlus className="mr-2 h-4 w-4" />Add Stock Batch</Button>
        </CardContent>
      </Card>
    </div>
  );
}
