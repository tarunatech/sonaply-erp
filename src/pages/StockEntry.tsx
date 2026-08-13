import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { addBatch, getBatches, updateBatch, StockBatch, getLocalDateString } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PackagePlus } from "lucide-react";

const STOCK_CATEGORIES = [
  "FINE TOUCH",
  "FINE TOUCH LITE",
  "FINOBLE",
  "REAL PLUS",
  "REAL TOUCH",
  "ROXX LAM",
  "KIWI DECOR",
  "ELITE LAM",
  "ACRIKA",
  "KALAA",
  "YOUR DECOR"
];

const defaultForm = { productCode: '', productName: '', category: '', batchNumber: '', supplier: '', quantity: 0, date: getLocalDateString(), description: '' };

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
  const [showBatchSuggestions, setShowBatchSuggestions] = useState(false);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState(-1);
  const batchContainerRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  
  const refresh = useCallback(() => getBatches().then(setBatches), []);
  useEffect(() => { refresh(); }, [refresh]);

  const uniqueNames = useMemo(() => Array.from(new Set(batches.map(b => b.productName).filter(Boolean))), [batches]);
  const uniqueCodes = useMemo(() => Array.from(new Set(batches.map(b => b.productCode).filter(Boolean))), [batches]);
  const uniqueCategories = useMemo(() => Array.from(new Set(batches.map(b => b.category).filter(Boolean))).sort(), [batches]);
  const uniqueSuppliers = useMemo(() => Array.from(new Set(batches.map(b => b.supplier).filter(Boolean))).sort(), [batches]);

  const categoriesToShow = useMemo(() => {
    if (form.productName) {
      const matches = batches.filter(b => b.productName.toLowerCase().trim() === form.productName.toLowerCase().trim());
      if (matches.length > 0) {
        return Array.from(new Set(matches.map(b => b.category).filter(Boolean))).sort();
      }
    }
    return Array.from(new Set([...STOCK_CATEGORIES, ...uniqueCategories])).sort();
  }, [form.productName, uniqueCategories, batches]);

  const batchesToShow = useMemo(() => {
    if (!form.productName) return Array.from(new Set(batches.map(b => b.batchNumber).filter(Boolean))).sort();
    const matches = batches.filter(b => b.productName.toLowerCase().trim() === form.productName.toLowerCase().trim());
    const filteredByCat = form.category 
      ? matches.filter(b => b.category.toLowerCase().trim() === form.category.toLowerCase().trim())
      : matches;
    const source = filteredByCat.length > 0 ? filteredByCat : matches;
    return Array.from(new Set(source.map(b => b.batchNumber).filter(Boolean))).sort();
  }, [form.productName, form.category, batches]);

  const handleSelectProductName = (name: string) => {
    const matches = batches.filter(b => b.productName.toLowerCase().trim() === name.toLowerCase().trim());
    const categories = Array.from(new Set(matches.map(b => b.category).filter(Boolean))).sort();
    const batchesList = Array.from(new Set(matches.map(b => b.batchNumber).filter(Boolean))).sort();

    const newCategory = categories.length === 1 ? categories[0] : '';
    const newBatch = batchesList.length === 1 ? batchesList[0] : '';

    setForm(prev => ({
      ...prev,
      productName: name,
      category: newCategory || prev.category,
      batchNumber: newBatch || prev.batchNumber
    }));
    setShowNameSuggestions(false);
  };

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
  useEffect(() => scrollToSelected(batchContainerRef, selectedBatchIndex), [selectedBatchIndex]);

  const handleSubmit = async () => {
    if (!form.productName || form.quantity < 0) {
      toast({ title: "Please fill product name and valid quantity", variant: "destructive" }); return;
    }

    const batchNum = form.batchNumber?.trim() || '0';

    // Check for existing batch to merge (Match: Name, Category, BatchNumber)
    const existing = batches.find(b => 
      b.productName.toLowerCase().trim() === form.productName.toLowerCase().trim() &&
      b.category.toLowerCase().trim() === form.category.toLowerCase().trim() &&
      (b.batchNumber || '0').toLowerCase().trim() === batchNum.toLowerCase()
    );

    if (existing) {
      await updateBatch(existing.id, {
        quantity: existing.quantity + form.quantity,
        availableQty: (existing.availableQty || 0) + form.quantity
      });
      toast({ title: "Stock updated (Merged with existing batch)" });
    } else {
      await addBatch({ ...form, batchNumber: batchNum, rate: 0, productId: null as any, availableQty: form.quantity, damageQty: 0, displayQty: 0 });
      toast({ title: form.quantity === 0 ? "New product/batch added with 0 stock!" : "Stock batch added successfully!" });
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
                  } else if (e.key === 'Enter' || e.key === 'Tab') {
                    if (selectedNameIndex >= 0 && selectedNameIndex < filtered.length) {
                      e.preventDefault();
                      handleSelectProductName(filtered[selectedNameIndex]);
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
                          handleSelectProductName(n);
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
                  const filtered = categoriesToShow.filter(c => !form.category || c.toLowerCase().includes(form.category.toLowerCase()));
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedCategoryIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedCategoryIndex(prev => (prev > 0 ? prev - 1 : prev));
                  } else if (e.key === 'Enter' || e.key === 'Tab') {
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
                  {categoriesToShow
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
                  {categoriesToShow.filter(c => !form.category || c.toLowerCase().includes(form.category.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No matches found.</div>
                  )}
                </div>
              )}
            </div>

            <div className="relative">
              <Label>Batch Number</Label>
              <Input 
                value={form.batchNumber} 
                onChange={e => {
                  u('batchNumber', e.target.value);
                  setShowBatchSuggestions(true);
                }} 
                onFocus={() => {
                  setShowBatchSuggestions(true);
                  setSelectedBatchIndex(-1);
                }}
                onBlur={() => setTimeout(() => {
                  setShowBatchSuggestions(false);
                  setSelectedBatchIndex(-1);
                }, 200)}
                onKeyDown={e => {
                  const filtered = batchesToShow.filter(b => !form.batchNumber || b.toLowerCase().includes(form.batchNumber.toLowerCase()));
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedBatchIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedBatchIndex(prev => (prev > 0 ? prev - 1 : prev));
                  } else if (e.key === 'Enter' || e.key === 'Tab') {
                    if (selectedBatchIndex >= 0 && selectedBatchIndex < filtered.length) {
                      e.preventDefault();
                      u('batchNumber', filtered[selectedBatchIndex]);
                      setShowBatchSuggestions(false);
                      setSelectedBatchIndex(-1);
                    }
                  } else if (e.key === 'Escape') {
                    setShowBatchSuggestions(false);
                    setSelectedBatchIndex(-1);
                  }
                }}
                placeholder="Batch Number"
                autoComplete="off"
              />
              {showBatchSuggestions && (
                <div ref={batchContainerRef} className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                  {batchesToShow
                    .filter(b => !form.batchNumber || b.toLowerCase().includes(form.batchNumber.toLowerCase()))
                    .map((b, i) => (
                      <div 
                        key={b} 
                        className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedBatchIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          u('batchNumber', b);
                          setShowBatchSuggestions(false);
                        }}
                      >
                        {b}
                      </div>
                  ))}
                  {batchesToShow.filter(b => !form.batchNumber || b.toLowerCase().includes(form.batchNumber.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No matches found.</div>
                  )}
                </div>
              )}
            </div>
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
                  } else if (e.key === 'Enter' || e.key === 'Tab') {
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
            <div>
              <div className="flex items-center justify-between">
                <Label>Quantity</Label>
                <span className="text-[11px] text-muted-foreground ml-1">(Can be 0 for new product)</span>
              </div>
              <Input type="number" min={0} value={form.quantity === 0 ? '0' : (form.quantity || '')} onChange={e => u('quantity', Math.max(0, +e.target.value))} placeholder="0" />
            </div>
            <div><Label>Date</Label><Input type="date" value={form.date} readOnly className="bg-muted text-muted-foreground" /></div>
            <div className="sm:col-span-2">
              <Label>Description / Note</Label>
              <Input value={form.description || ''} onChange={e => u('description', e.target.value)} placeholder="Add a description or note about this batch..." />
            </div>

          </div>
          <Button className="w-full" onClick={handleSubmit}><PackagePlus className="mr-2 h-4 w-4" />Add Stock Batch</Button>
        </CardContent>
      </Card>
    </div>
  );
}
