import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getBatches,
  getBatchesPaginated,
  getDistinctColumnValues,
  exportCSV,
  deleteBatch,
  updateBatch,
  addBatch,
  addPurchase,
  getSales,
  Sale,
  StockBatch,
  StockStats,
  CATEGORIES,
  getLocalDateString,
  formatLocalDate,
} from "@/lib/store";
import { format } from "date-fns";

import { printElement } from "@/lib/print";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Search,
  Download,
  Printer,
  Plus,
  ClipboardList,
  Pencil,
  Trash2,
  Upload,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  Check,
  RotateCcw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// --- Column Filter Helper Components ---

function TextColumnFilter({
  title,
  columnName,
  value,
  onChange,
  placeholder = "Search...",
}: {
  title: string;
  columnName?: "product_name" | "batch_number" | "description";
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(value || "");
  const [suggestions, setSuggestions] = useState<{ value: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setSearchQuery(value || "");
      if (columnName) {
        setLoading(true);
        getDistinctColumnValues(columnName, "")
          .then((list) => setSuggestions(list))
          .catch(() => setSuggestions([]))
          .finally(() => setLoading(false));
      }
    }
  }, [open, value, columnName]);

  // Debounce search in suggestions
  useEffect(() => {
    if (!open || !columnName) return;
    const timer = setTimeout(() => {
      getDistinctColumnValues(columnName, searchQuery)
        .then((list) => setSuggestions(list))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, open, columnName]);

  const handleApply = (valToApply?: string) => {
    const finalVal = valToApply !== undefined ? valToApply : searchQuery.trim();
    onChange(finalVal);
    setOpen(false);
  };

  const handleClear = () => {
    setSearchQuery("");
    onChange("");
    setOpen(false);
  };

  const isActive = Boolean(value && value.trim());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center justify-center h-6 w-6 rounded p-0 transition-colors cursor-pointer ${
            isActive
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-2xs"
              : "text-slate-400 hover:text-slate-700 hover:bg-slate-200/80"
          }`}
          title={`Filter ${title}`}
        >
          <Filter className={`h-3.5 w-3.5 ${isActive ? "fill-current" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 z-50 bg-white" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-xs font-bold text-slate-900">Filter by {title}</span>
            {isActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleClear}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleApply();
                }
              }}
              placeholder={placeholder}
              className="h-8 pl-8 pr-8 text-xs"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {columnName && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">
                {loading ? "Loading options..." : "Select or search:"}
              </div>
              <div className="max-h-36 overflow-y-auto space-y-0.5 pr-1 border rounded p-1 bg-slate-50/50">
                {suggestions.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground py-2 text-center">
                    {loading ? "Loading..." : "No matching items"}
                  </div>
                ) : (
                  suggestions.map((item) => {
                    const isSelected = value.toLowerCase() === item.value.toLowerCase();
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => handleApply(item.value)}
                        className={`w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-blue-100 text-blue-900 font-semibold"
                            : "hover:bg-slate-200/70 text-slate-700"
                        }`}
                      >
                        <span className="truncate pr-1">{item.value}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">({item.count})</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700" onClick={() => handleApply()}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CategoryColumnFilter({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return categories;
    return categories.filter((c) => c.toLowerCase().includes(q));
  }, [categories, searchQuery]);

  const handleSelect = (cat: string) => {
    onChange(cat === value ? "" : cat);
    setOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setOpen(false);
  };

  const isActive = Boolean(value && value !== "all" && value.trim());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center justify-center h-6 w-6 rounded p-0 transition-colors cursor-pointer ${
            isActive
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-2xs"
              : "text-slate-400 hover:text-slate-700 hover:bg-slate-200/80"
          }`}
          title="Filter Category"
        >
          <Filter className={`h-3.5 w-3.5 ${isActive ? "fill-current" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 z-50 bg-white" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-xs font-bold text-slate-900">Filter Category</span>
            {isActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleClear}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search category..."
              className="h-8 pl-8 pr-8 text-xs"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-44 overflow-y-auto space-y-0.5 border rounded p-1 bg-slate-50/50">
            <button
              type="button"
              onClick={handleClear}
              className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between transition-colors cursor-pointer ${
                !isActive
                  ? "bg-blue-100 text-blue-900 font-semibold"
                  : "hover:bg-slate-200/70 text-slate-700"
              }`}
            >
              <span>All Categories</span>
              {!isActive && <Check className="h-3.5 w-3.5 text-blue-700" />}
            </button>
            {filteredCategories.map((c) => {
              const isSelected = value.toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleSelect(c)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-blue-100 text-blue-900 font-semibold"
                      : "hover:bg-slate-200/70 text-slate-700"
                  }`}
                >
                  <span className="truncate">{c}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-blue-700" />}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NumericColumnFilter({
  title,
  filterType,
  minValue,
  maxValue,
  onChange,
}: {
  title: string;
  filterType: string;
  minValue: string;
  maxValue: string;
  onChange: (type: string, min: string, max: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(filterType || "all");
  const [min, setMin] = useState(minValue || "");
  const [max, setMax] = useState(maxValue || "");

  useEffect(() => {
    if (open) {
      setType(filterType || "all");
      setMin(minValue || "");
      setMax(maxValue || "");
    }
  }, [open, filterType, minValue, maxValue]);

  const handleApply = (newType = type, newMin = min, newMax = max) => {
    onChange(newType, newMin, newMax);
    setOpen(false);
  };

  const handleClear = () => {
    setType("all");
    setMin("");
    setMax("");
    onChange("all", "", "");
    setOpen(false);
  };

  const isActive = (filterType && filterType !== "all") || Boolean(minValue || maxValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center justify-center h-6 w-6 rounded p-0 transition-colors cursor-pointer ${
            isActive
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-2xs"
              : "text-slate-400 hover:text-slate-700 hover:bg-slate-200/80"
          }`}
          title={`Filter ${title}`}
        >
          <Filter className={`h-3.5 w-3.5 ${isActive ? "fill-current" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 z-50 bg-white" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-xs font-bold text-slate-900">Filter {title}</span>
            {isActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleClear}
              >
                Clear
              </Button>
            )}
          </div>

          {/* Quick Presets */}
          <div className="grid grid-cols-4 gap-1">
            <Button
              type="button"
              variant={type === "all" ? "default" : "outline"}
              size="sm"
              className={`h-7 px-1 text-xs ${type === "all" ? "bg-slate-800 text-white" : ""}`}
              onClick={() => {
                setType("all");
                setMin("");
                setMax("");
                handleApply("all", "", "");
              }}
            >
              All
            </Button>
            <Button
              type="button"
              variant={type === ">0" ? "default" : "outline"}
              size="sm"
              className={`h-7 px-1 text-xs font-semibold ${type === ">0" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "text-emerald-700"}`}
              onClick={() => {
                setType(">0");
                setMin("");
                setMax("");
                handleApply(">0", "", "");
              }}
            >
              &gt; 0
            </Button>
            <Button
              type="button"
              variant={type === "=0" ? "default" : "outline"}
              size="sm"
              className={`h-7 px-1 text-xs font-semibold ${type === "=0" ? "bg-slate-700 hover:bg-slate-800 text-white" : "text-slate-700"}`}
              onClick={() => {
                setType("=0");
                setMin("");
                setMax("");
                handleApply("=0", "", "");
              }}
            >
              = 0
            </Button>
            <Button
              type="button"
              variant={type === "<0" ? "default" : "outline"}
              size="sm"
              className={`h-7 px-1 text-xs font-semibold ${type === "<0" ? "bg-red-600 hover:bg-red-700 text-white" : "text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"}`}
              onClick={() => {
                setType("<0");
                setMin("");
                setMax("");
                handleApply("<0", "", "");
              }}
              title="Less than 0 (Negative stock)"
            >
              &lt; 0
            </Button>
          </div>

          {/* Custom Range */}
          <div className="space-y-1.5 pt-1 border-t">
            <div className="text-[11px] font-semibold text-slate-600">Custom Value / Range:</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-slate-500">Min Qty</Label>
                <Input
                  type="number"
                  placeholder="Min"
                  value={min}
                  onChange={(e) => {
                    setMin(e.target.value);
                    setType("custom");
                  }}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-slate-500">Max Qty</Label>
                <Input
                  type="number"
                  placeholder="Max"
                  value={max}
                  onChange={(e) => {
                    setMax(e.target.value);
                    setType("custom");
                  }}
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
              onClick={() => handleApply(type === "all" && (min || max) ? "custom" : type, min, max)}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface StockColumnFilters {
  product: string;
  category: string;
  batch: string;
  soldType: string;
  minSold: string;
  maxSold: string;
  availableType: string;
  minAvailable: string;
  maxAvailable: string;
  stockMaintainType: string;
  minStockMaintain: string;
  maxStockMaintain: string;
  holdType: string;
  minHold: string;
  maxHold: string;
  displayType: string;
  minDisplay: string;
  maxDisplay: string;
  damageType: string;
  minDamage: string;
  maxDamage: string;
  description: string;
  updatedDate: string;
}

const initialFilters: StockColumnFilters = {
  product: "",
  category: "",
  batch: "",
  soldType: "all",
  minSold: "",
  maxSold: "",
  availableType: "all",
  minAvailable: "",
  maxAvailable: "",
  stockMaintainType: "all",
  minStockMaintain: "",
  maxStockMaintain: "",
  holdType: "all",
  minHold: "",
  maxHold: "",
  displayType: "all",
  minDisplay: "",
  maxDisplay: "",
  damageType: "all",
  minDamage: "",
  maxDamage: "",
  description: "",
  updatedDate: "",
};

export default function StockList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [columnFilters, setColumnFilters] = useState<StockColumnFilters>(initialFilters);
  const [page, setPage] = useState<number>(1);
  const limit = 50;
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [stats, setStats] = useState<StockStats>({
    totalSales: 0,
    availableStock: 0,
    totalDisplay: 0,
    totalDamage: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Sale[]>([]);
  const [editingBatch, setEditingBatch] = useState<StockBatch | null>(null);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  useEffect(() => {
    if (!editingBatch) {
      setIsAdminUnlocked(false);
    }
  }, [editingBatch]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const setColumnFilter = useCallback((key: keyof StockColumnFilters, value: any) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const setNumericColumnFilter = useCallback((prefix: string, type: string, min: string, max: string) => {
    setColumnFilters((prev) => ({
      ...prev,
      [`${prefix}Type`]: type,
      [`min${prefix.charAt(0).toUpperCase() + prefix.slice(1)}`]: min,
      [`max${prefix.charAt(0).toUpperCase() + prefix.slice(1)}`]: max,
    }));
    setPage(1);
  }, []);

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setSelectedCategory("all");
    setSelectedStatus("all");
    setColumnFilters(initialFilters);
    setPage(1);
  }, []);

  // Debounce search string by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const refreshCategories = useCallback(async () => {
    try {
      const bList = await getBatches();
      const list = new Set<string>();
      bList.forEach((b) => {
        if (b.category) list.add(b.category);
      });
      CATEGORIES.forEach((c) => list.add(c));
      setAllCategories(Array.from(list).sort());
    } catch (err) {
      console.error("Failed to load categories:", err);
    }
  }, []);

  useEffect(() => {
    refreshCategories();
  }, [refreshCategories]);

  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [res, s] = await Promise.all([
        getBatchesPaginated({
          page,
          limit,
          search: debouncedSearch,
          category: columnFilters.category || (selectedCategory !== "all" ? selectedCategory : undefined),
          stockStatus: selectedStatus !== "all" ? selectedStatus : undefined,
          product: columnFilters.product,
          batch: columnFilters.batch,
          soldType: columnFilters.soldType !== "all" ? columnFilters.soldType : undefined,
          minSold: columnFilters.minSold,
          maxSold: columnFilters.maxSold,
          availableType: columnFilters.availableType !== "all" ? columnFilters.availableType : undefined,
          minAvailable: columnFilters.minAvailable,
          maxAvailable: columnFilters.maxAvailable,
          stockMaintainType: columnFilters.stockMaintainType !== "all" ? columnFilters.stockMaintainType : undefined,
          minStockMaintain: columnFilters.minStockMaintain,
          maxStockMaintain: columnFilters.maxStockMaintain,
          holdType: columnFilters.holdType !== "all" ? columnFilters.holdType : undefined,
          minHold: columnFilters.minHold,
          maxHold: columnFilters.maxHold,
          displayType: columnFilters.displayType !== "all" ? columnFilters.displayType : undefined,
          minDisplay: columnFilters.minDisplay,
          maxDisplay: columnFilters.maxDisplay,
          damageType: columnFilters.damageType !== "all" ? columnFilters.damageType : undefined,
          minDamage: columnFilters.minDamage,
          maxDamage: columnFilters.maxDamage,
          description: columnFilters.description,
          updatedDate: columnFilters.updatedDate,
        }),
        getSales(),
      ]);
      setBatches(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages || Math.ceil(res.total / limit) || 1);
      if (res.stats) {
        setStats(res.stats);
      }
      setPendingOrders(
        s.filter(
          (sale) =>
            sale.status !== "Delivered" &&
            sale.status !== "Cancelled" &&
            sale.pendingQty > 0,
        ),
      );
    } catch (err) {
      console.error("Failed to fetch stock batches:", err);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, debouncedSearch, selectedCategory, selectedStatus, columnFilters]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    const handleStockUpdate = () => {
      refreshData();
      refreshCategories();
    };
    window.addEventListener("erp-stock-updated", handleStockUpdate);
    return () =>
      window.removeEventListener("erp-stock-updated", handleStockUpdate);
  }, [refreshData, refreshCategories]);

  const handleDelete = async (id: string) => {
    const password = prompt("Please enter admin password to delete:");
    if (password !== "admin") {
      if (password !== null)
        toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (confirm("Are you sure you want to delete this stock batch?")) {
      await deleteBatch(id);
      refreshData();
      toast({ title: "Batch deleted" });
    }
  };

  const handleEditSave = async () => {
    if (editingBatch) {
      try {
        const finalBatch = {
          ...editingBatch,
          batchNumber: editingBatch.batchNumber?.trim() || "0",
        };
        const originalBatch = batches.find((b) => b.id === finalBatch.id);
        if (originalBatch) {
          const oldAvailable = Number(originalBatch.availableQty || 0);
          const oldDisplay = Number(originalBatch.displayQty || 0);
          const oldDamage = Number(originalBatch.damageQty || 0);

          const newAvailable = Number(finalBatch.availableQty || 0);
          const newDisplay = Number(finalBatch.displayQty || 0);
          const newDamage = Number(finalBatch.damageQty || 0);

          const diff =
            newAvailable +
            newDisplay +
            newDamage -
            (oldAvailable + oldDisplay + oldDamage);

          finalBatch.quantity = (originalBatch.quantity || 0) + diff;
        }
        await updateBatch(finalBatch.id, finalBatch);
        await refreshData();
        window.dispatchEvent(new Event("erp-stock-updated"));
        toast({
          title: "Batch updated",
          description: "Stock batch details saved successfully.",
        });
        setEditingBatch(null);
      } catch (err: any) {
        console.error("Failed to update batch:", err);
        toast({
          title: "Update failed",
          description: err.message || "Could not save changes.",
          variant: "destructive",
        });
      }
    }
  };

  const escapeCsvValue = (
    value: string | number | boolean | null | undefined,
  ) => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };

  const downloadExcelTemplate = () => {
    const headers = [
      "Product Name",
      "Category",
      "Batch Number",
      "Supplier",
      "Date",
      "Available Qty",
      "Stock Maintain",
      "Damage Qty",
      "Display Qty",
      "Description",
      "Is Not next Folder",
      "Is Dead Stock",
      "Is Nil",
    ];
    const today = getLocalDateString();
    // Format as dd-mm-yyyy for the template (matches user CSV format)
    const [yyyy, mm, dd] = today.split("-");
    const sampleRow = [
      "SUNPLY BOARD 8MM",
      "FINE TOUCH",
      "BATCH-001",
      "ABC SUPPLIER",
      `${dd}-${mm}-${yyyy}`,
      "100",
      "0",
      "0",
      "0",
      "Optional note",
      "No",
      "No",
      "No",
    ];
    const csv = [
      headers.join(","),
      sampleRow.map(escapeCsvValue).join(","),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock-template-${getLocalDateString()}.csv`;
    a.click();
  };

  const parseCsvLine = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const handleImportFile = async (file: File) => {
    // flushSync forces React to render immediately so the spinner is visible
    flushSync(() => {
      setIsImporting(true);
      setImportProgress("Reading file...");
    });
    try {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) {
      toast({
        title: "Invalid file",
        description:
          "Template must include a header row and at least one data row.",
        variant: "destructive",
      });
      return;
    }

    const headers = parseCsvLine(lines[0]).map((h) => h.trim());

    // Define helper to match headers
    const findHeader = (possibleNames: string[]) => {
      return headers.find((h) =>
        possibleNames.some(
          (name) => h.trim().toLowerCase() === name.toLowerCase(),
        ),
      );
    };

    const mapKeys = {
      productName: findHeader([
        "Product Name",
        "productName",
        "product_name",
        "product",
      ]),
      category: findHeader(["Category", "category"]),
      batchNumber: findHeader([
        "Batch Number",
        "Batch No",
        "batchNum",
        "batchNumber",
        "batchNo",
        "batch_number",
      ]),
      supplier: findHeader([
        "Supplier",
        "Supplier Name",
        "supplier",
        "supplierName",
        "supplier_name",
      ]),
      quantity: findHeader(["Quantity", "quantity", "Qty", "qty"]),
      date: findHeader(["Date", "date"]),
      availableQty: findHeader([
        "Available Qty",
        "availableQty",
        "available_qty",
        "available",
      ]),
      stockMaintain: findHeader([
        "Stock Maintain",
        "stockMaintain",
        "stock_maintain",
        "Maintain Stock",
        "maintain_stock",
        "maintain_qty",
        "Min Stock",
        "min_stock",
      ]),
      damageQty: findHeader([
        "Damage Qty",
        "damageQty",
        "damage_qty",
        "damage",
      ]),
      displayQty: findHeader([
        "Display Qty",
        "displayQty",
        "display_qty",
        "display",
        "nilQty",
        "nil_qty",
      ]),
      description: findHeader([
        "Description",
        "description",
        "desc",
        "notes",
        "narration",
      ]),
      isNil: findHeader([
        "Is Not next Folder",
        "isNotNextFolder",
        "isNil",
        "is_nil",
        "not next folder",
      ]),
      isCancelled: findHeader([
        "Is Dead Stock",
        "isCancelled",
        "is_cancelled",
        "dead stock",
        "deadstock",
      ]),
      isDeadStock: findHeader([
        "Is Nil",
        "isDeadStock",
        "is_dead_stock",
        "nil",
      ]),
    };

    if (
      !mapKeys.productName ||
      !mapKeys.category ||
      (!mapKeys.availableQty && !mapKeys.quantity)
    ) {
      toast({
        title: "Invalid template",
        description:
          "Template must include columns for Product Name, Category, and Available Qty (or Quantity).",
        variant: "destructive",
      });
      return;
    }

    let created = 0;
    let updated = 0;
    const currentBatches = await getBatches();
    const existingByKey = new Set(
      currentBatches.map(
        (b) =>
          `${b.productName.trim().toLowerCase()}||${(b.batchNumber || "").trim().toLowerCase()}`,
      ),
    );

    // Parse the rows to process them in two steps
    interface ParsedRow {
      productName: string;
      category: string;
      batchNumber: string;
      supplier: string;
      quantity: number;
      date: string;
      availableQty: number;
      stockMaintain: number;
      damageQty: number;
      displayQty: number;
      description: string;
      isNil: boolean;
      isCancelled: boolean;
      isDeadStock: boolean;
    }

    const parsedRows: ParsedRow[] = [];

    const parseBoolValue = (val: any) => {
      const s = String(val || "").trim().toLowerCase();
      return s === "true" || s === "yes" || s === "1";
    };

    for (const line of lines.slice(1)) {
      const values = parseCsvLine(line);
      if (!values.some(Boolean)) continue;
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? "";
      });

      const productName = mapKeys.productName
        ? row[mapKeys.productName]?.trim()
        : "";
      const category = mapKeys.category ? row[mapKeys.category]?.trim() : "";
      if (!productName || !category) continue;

      const batchNumberRaw = mapKeys.batchNumber
        ? row[mapKeys.batchNumber]?.trim() || "0"
        : "0";
      let batchNumbers = batchNumberRaw
        .split(/[,/|;]+/)
        .map((b) => b.trim())
        .filter(Boolean);
      if (batchNumbers.length === 0) {
        batchNumbers = ["0"];
      }
      const count = batchNumbers.length;

      const supplier = mapKeys.supplier
        ? row[mapKeys.supplier]?.trim() || ""
        : "";
      // Parse date – support both dd-mm-yyyy and yyyy-mm-dd formats
      const rawDate = mapKeys.date ? row[mapKeys.date]?.trim() || "" : "";
      let date: string;
      if (rawDate.match(/^(\d{2})-(\d{2})-(\d{4})$/)) {
        // Convert dd-mm-yyyy → yyyy-mm-dd
        const [dd, mm, yyyy] = rawDate.split("-");
        date = `${yyyy}-${mm}-${dd}`;
      } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        date = rawDate;
      } else {
        date = getLocalDateString();
      }

      const damageQty = mapKeys.damageQty
        ? Number(row[mapKeys.damageQty] || 0)
        : 0;
      const displayQty = mapKeys.displayQty
        ? Number(row[mapKeys.displayQty] || 0)
        : 0;
      const stockMaintain = mapKeys.stockMaintain
        ? Number(row[mapKeys.stockMaintain] || 0)
        : 0;
      const description = mapKeys.description
        ? row[mapKeys.description]?.trim() || ""
        : "";
      const isNil = mapKeys.isNil ? parseBoolValue(row[mapKeys.isNil]) : false;
      const isCancelled = mapKeys.isCancelled
        ? parseBoolValue(row[mapKeys.isCancelled])
        : false;
      const isDeadStock = mapKeys.isDeadStock
        ? parseBoolValue(row[mapKeys.isDeadStock])
        : false;

      // CSV columns are separate counts: availableQty, damageQty, displayQty
      // Total quantity = sum of all three
      let availableQty = 0;
      let quantity = 0;

      if (mapKeys.availableQty) {
        const rawAvail = row[mapKeys.availableQty];
        availableQty = rawAvail !== undefined && rawAvail !== "" ? Number(rawAvail) : 0;
        if (Number.isNaN(availableQty)) availableQty = 0;
      } else if (mapKeys.quantity) {
        availableQty = Number(row[mapKeys.quantity] || 0);
        if (Number.isNaN(availableQty)) availableQty = 0;
      }

      // Total = available + damage + display
      quantity = availableQty + damageQty + displayQty;
      if (quantity < 0) quantity = 0;

      batchNumbers.forEach((bNum, idx) => {
        const qtyForBatch =
          Math.floor(quantity / count) + (idx === 0 ? quantity % count : 0);
        const availForBatch =
          Math.floor(availableQty / count) +
          (idx === 0 ? availableQty % count : 0);
        const dmgForBatch =
          Math.floor(damageQty / count) + (idx === 0 ? damageQty % count : 0);
        const dispForBatch =
          Math.floor(displayQty / count) + (idx === 0 ? displayQty % count : 0);

        parsedRows.push({
          productName,
          category,
          batchNumber: bNum,
          supplier,
          quantity: qtyForBatch,
          date,
          availableQty: availForBatch,
          stockMaintain,
          damageQty: dmgForBatch,
          displayQty: dispForBatch,
          description,
          isNil,
          isCancelled,
          isDeadStock,
        });
      });
    }

    setImportProgress(`Parsing ${parsedRows.length} rows...`);
    // Step 1: Record purchases (this ensures batches are created/updated in db)
    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      flushSync(() => setImportProgress(`Saving ${i + 1} of ${parsedRows.length}...`));
      await addPurchase({
        supplierName: row.supplier,
        supplierPhone: "",
        productName: row.productName,
        category: row.category,
        quantity: row.quantity,
        rate: 0,
        totalAmount: 0,
        batchNumber: row.batchNumber,
        date: row.date,
      });

      const key = `${row.productName.toLowerCase()}||${row.batchNumber.toLowerCase()}`;
      if (existingByKey.has(key)) {
        updated += 1;
      } else {
        created += 1;
        existingByKey.add(key);
      }
    }

    // Step 2: Aggregate stock by (productName, batchNumber) so combined stock totals (e.g. MA 845 = 3 + 1 = 4) are preserved
    const aggregatedBatches = new Map<string, ParsedRow>();
    for (const row of parsedRows) {
      const key = `${row.productName.trim().toLowerCase()}||${(row.batchNumber || "0").trim().toLowerCase()}`;
      const existing = aggregatedBatches.get(key);
      if (!existing) {
        aggregatedBatches.set(key, { ...row });
      } else {
        existing.quantity += row.quantity;
        existing.availableQty += row.availableQty;
        existing.damageQty += row.damageQty;
        existing.displayQty += row.displayQty;
        if (row.stockMaintain) existing.stockMaintain = row.stockMaintain;
        if (row.isNil) existing.isNil = true;
        if (row.isCancelled) existing.isCancelled = true;
        if (row.isDeadStock) existing.isDeadStock = true;
        if (!existing.description && row.description) existing.description = row.description;
        if (!existing.supplier && row.supplier) existing.supplier = row.supplier;
      }
    }

    const latestBatches = await getBatches();
    for (const row of Array.from(aggregatedBatches.values())) {
      const match = latestBatches.find(
        (b) =>
          b.productName.trim().toLowerCase() ===
            row.productName.toLowerCase() &&
          (b.batchNumber || "").trim().toLowerCase() ===
            row.batchNumber.toLowerCase(),
      );

      if (match) {
        await updateBatch(match.id, {
          category: row.category,
          supplier: row.supplier,
          quantity: row.quantity,
          availableQty: row.availableQty,
          stockMaintain: row.stockMaintain,
          damageQty: row.damageQty,
          displayQty: row.displayQty,
          description: row.description,
          isNil: row.isNil,
          isCancelled: row.isCancelled,
          isDeadStock: row.isDeadStock,
        });
      }
    }

    setImportProgress("Refreshing stock list...");
    refreshData();
    toast({
      title: "Import complete",
      description: `${created} added, ${updated} updated.`,
    });
    } catch (err: any) {
      toast({
        title: "Import failed",
        description: err?.message || "An error occurred during import.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      setImportProgress("");
    }
  };

  const formatUpdatedDate = (value: string) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const activeFilterPills = useMemo(() => {
    const pills: { key: string; label: string; onRemove: () => void }[] = [];
    if (columnFilters.product) {
      pills.push({
        key: "product",
        label: `Product: "${columnFilters.product}"`,
        onRemove: () => setColumnFilter("product", ""),
      });
    }
    if (columnFilters.category && columnFilters.category !== "all") {
      pills.push({
        key: "category",
        label: `Category: ${columnFilters.category}`,
        onRemove: () => {
          setColumnFilter("category", "");
          setSelectedCategory("all");
        },
      });
    }
    if (columnFilters.batch) {
      pills.push({
        key: "batch",
        label: `Batch: "${columnFilters.batch}"`,
        onRemove: () => setColumnFilter("batch", ""),
      });
    }
    if (columnFilters.soldType === ">0") {
      pills.push({ key: "sold", label: "Sold: > 0", onRemove: () => setNumericColumnFilter("sold", "all", "", "") });
    } else if (columnFilters.soldType === "=0") {
      pills.push({ key: "sold", label: "Sold: = 0", onRemove: () => setNumericColumnFilter("sold", "all", "", "") });
    } else if (columnFilters.soldType === "<0") {
      pills.push({ key: "sold", label: "Sold: < 0", onRemove: () => setNumericColumnFilter("sold", "all", "", "") });
    } else if (columnFilters.minSold || columnFilters.maxSold) {
      pills.push({
        key: "sold",
        label: `Sold: ${columnFilters.minSold || "0"} - ${columnFilters.maxSold || "∞"}`,
        onRemove: () => setNumericColumnFilter("sold", "all", "", ""),
      });
    }
    if (columnFilters.availableType === ">0") {
      pills.push({ key: "available", label: "Available: > 0", onRemove: () => setNumericColumnFilter("available", "all", "", "") });
    } else if (columnFilters.availableType === "=0") {
      pills.push({ key: "available", label: "Available: = 0", onRemove: () => setNumericColumnFilter("available", "all", "", "") });
    } else if (columnFilters.availableType === "<0") {
      pills.push({ key: "available", label: "Available: < 0 (Negative)", onRemove: () => setNumericColumnFilter("available", "all", "", "") });
    } else if (columnFilters.minAvailable || columnFilters.maxAvailable) {
      pills.push({
        key: "available",
        label: `Available: ${columnFilters.minAvailable || "0"} - ${columnFilters.maxAvailable || "∞"}`,
        onRemove: () => setNumericColumnFilter("available", "all", "", ""),
      });
    }
    if (columnFilters.stockMaintainType === ">0") {
      pills.push({ key: "stockMaintain", label: "Stock Maintain: > 0", onRemove: () => setNumericColumnFilter("stockMaintain", "all", "", "") });
    } else if (columnFilters.stockMaintainType === "=0") {
      pills.push({ key: "stockMaintain", label: "Stock Maintain: = 0", onRemove: () => setNumericColumnFilter("stockMaintain", "all", "", "") });
    } else if (columnFilters.stockMaintainType === "<0") {
      pills.push({ key: "stockMaintain", label: "Stock Maintain: < 0", onRemove: () => setNumericColumnFilter("stockMaintain", "all", "", "") });
    } else if (columnFilters.minStockMaintain || columnFilters.maxStockMaintain) {
      pills.push({
        key: "stockMaintain",
        label: `Stock Maintain: ${columnFilters.minStockMaintain || "0"} - ${columnFilters.maxStockMaintain || "∞"}`,
        onRemove: () => setNumericColumnFilter("stockMaintain", "all", "", ""),
      });
    }
    if (columnFilters.holdType === ">0") {
      pills.push({ key: "hold", label: "Hold: > 0", onRemove: () => setNumericColumnFilter("hold", "all", "", "") });
    } else if (columnFilters.holdType === "=0") {
      pills.push({ key: "hold", label: "Hold: = 0", onRemove: () => setNumericColumnFilter("hold", "all", "", "") });
    } else if (columnFilters.holdType === "<0") {
      pills.push({ key: "hold", label: "Hold: < 0", onRemove: () => setNumericColumnFilter("hold", "all", "", "") });
    } else if (columnFilters.minHold || columnFilters.maxHold) {
      pills.push({
        key: "hold",
        label: `Hold: ${columnFilters.minHold || "0"} - ${columnFilters.maxHold || "∞"}`,
        onRemove: () => setNumericColumnFilter("hold", "all", "", ""),
      });
    }
    if (columnFilters.displayType === ">0") {
      pills.push({ key: "display", label: "Display: > 0", onRemove: () => setNumericColumnFilter("display", "all", "", "") });
    } else if (columnFilters.displayType === "=0") {
      pills.push({ key: "display", label: "Display: = 0", onRemove: () => setNumericColumnFilter("display", "all", "", "") });
    } else if (columnFilters.displayType === "<0") {
      pills.push({ key: "display", label: "Display: < 0", onRemove: () => setNumericColumnFilter("display", "all", "", "") });
    } else if (columnFilters.minDisplay || columnFilters.maxDisplay) {
      pills.push({
        key: "display",
        label: `Display: ${columnFilters.minDisplay || "0"} - ${columnFilters.maxDisplay || "∞"}`,
        onRemove: () => setNumericColumnFilter("display", "all", "", ""),
      });
    }
    if (columnFilters.damageType === ">0") {
      pills.push({ key: "damage", label: "Damaged: > 0", onRemove: () => setNumericColumnFilter("damage", "all", "", "") });
    } else if (columnFilters.damageType === "=0") {
      pills.push({ key: "damage", label: "Damaged: = 0", onRemove: () => setNumericColumnFilter("damage", "all", "", "") });
    } else if (columnFilters.damageType === "<0") {
      pills.push({ key: "damage", label: "Damaged: < 0", onRemove: () => setNumericColumnFilter("damage", "all", "", "") });
    } else if (columnFilters.minDamage || columnFilters.maxDamage) {
      pills.push({
        key: "damage",
        label: `Damaged: ${columnFilters.minDamage || "0"} - ${columnFilters.maxDamage || "∞"}`,
        onRemove: () => setNumericColumnFilter("damage", "all", "", ""),
      });
    }
    if (columnFilters.description) {
      pills.push({
        key: "description",
        label: `Description: "${columnFilters.description}"`,
        onRemove: () => setColumnFilter("description", ""),
      });
    }
    if (columnFilters.updatedDate) {
      pills.push({
        key: "updatedDate",
        label: `Updated: "${columnFilters.updatedDate}"`,
        onRemove: () => setColumnFilter("updatedDate", ""),
      });
    }
    if (selectedStatus && selectedStatus !== "all") {
      const statusLabels: Record<string, string> = {
        not_in_next_folder: "Not in Next Folder",
        dead_stock: "Dead Stock",
        nil: "Nil Stock",
        regular: "Regular Stock Only",
      };
      pills.push({
        key: "status",
        label: `Status: ${statusLabels[selectedStatus] || selectedStatus}`,
        onRemove: () => setSelectedStatus("all"),
      });
    }
    return pills;
  }, [columnFilters, selectedStatus, setColumnFilter, setNumericColumnFilter]);

  return (
    <div className="relative space-y-4">
      {/* Full-page loading overlay shown during CSV import */}
      {isImporting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
          <p className="text-lg font-semibold text-foreground">{importProgress || "Importing..."}</p>
          <p className="text-sm text-muted-foreground mt-1">Please wait, do not close this page</p>
        </div>
      )}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <h1 className="text-2xl font-bold">Stock List</h1>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm">
                <ClipboardList className="mr-1 h-4 w-4" /> Pending Items
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Pending Orders</DialogTitle>
              </DialogHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Total Qty</TableHead>
                    <TableHead className="text-right text-orange-600">
                      Pending
                    </TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingOrders.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-4 text-muted-foreground"
                      >
                        No pending items.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pendingOrders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="text-xs">
                          {o.orderNo}
                        </TableCell>
                        <TableCell>{o.customer}</TableCell>
                        <TableCell className="font-medium">
                          {o.product}
                        </TableCell>
                        <TableCell className="text-right">
                          {o.orderedQty}
                        </TableCell>
                        <TableCell className="text-right font-bold text-orange-600">
                          {o.pendingQty || 0}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatLocalDate(o.orderDate)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </DialogContent>
          </Dialog>
          <Button onClick={() => navigate("/stock-entry")} size="sm">
            <Plus className="mr-1 h-4 w-4" /> Add Items
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              let csvContent = "";
              const fullBatchesList = await getBatches();

              const brands: Record<string, Record<string, any[]>> = {};
              fullBatchesList.forEach((b) => {
                let brand = "UNKNOWN";
                let prefix = "Other";
                let suffix = b.productName;

                // Parse from productName as default
                const nameParts = b.productName.trim().split(/\s+/);
                if (nameParts.length >= 3) {
                  brand = nameParts[0];
                  prefix = nameParts[1];
                  suffix = nameParts.slice(2).join(" ");
                } else if (nameParts.length === 2) {
                  prefix = nameParts[0];
                  suffix = nameParts[1];
                }

                if (b.supplier) brand = b.supplier;

                // Override with productCode if it exists
                if (b.productCode && b.productCode.trim() !== "") {
                  const codeParts = b.productCode.trim().split(/\s+/);
                  if (codeParts.length > 1) {
                    prefix = codeParts[0];
                    suffix = codeParts.slice(1).join(" ");
                  } else {
                    const match = b.productCode
                      .trim()
                      .match(/^([a-zA-Z]+)(.*)$/);
                    if (match) {
                      prefix = match[1];
                      suffix = match[2];
                    } else {
                      suffix = b.productCode;
                    }
                  }
                }

                const item = { ...b, parsedSuffix: suffix };

                if (!brands[brand]) brands[brand] = {};
                if (!brands[brand][prefix]) brands[brand][prefix] = [];
                brands[brand][prefix].push(item);
              });

              for (const [brand, prefixes] of Object.entries(brands)) {
                csvContent += `Brand: ${brand},,,,,,,,,,\n`;
                csvContent += `Product Name,Product Number,Date,Quantity,Available,Stock Maintain,Hold,Display,Damaged,Description\n`;

                const sortedPrefixes = Object.keys(prefixes).sort();
                for (const prefix of sortedPrefixes) {
                  const items = prefixes[prefix];

                  items
                    .sort((a, b) => {
                      const numA = parseInt(a.parsedSuffix);
                      const numB = parseInt(b.parsedSuffix);
                      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                      return a.parsedSuffix.localeCompare(b.parsedSuffix);
                    })
                    .forEach((item) => {
                      const cleanDesc = (item.description || "").replace(/"/g, '""');
                      // Data row
                      csvContent += `"${prefix}","${item.parsedSuffix}","${item.date || ""}","${item.quantity || 0}","${item.availableQty || 0}","${item.stockMaintain || 0}","${item.holdQty || 0}","${item.displayQty || 0}","${item.damageQty || 0}","${cleanDesc}"\n`;
                    });
                  // Empty row between groups
                  csvContent += `,,,,,,,,,,\n`;
                }
                csvContent += `\n`;
              }

              const blob = new Blob([csvContent], {
                type: "text/csv;charset=utf-8;",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `stock-patrak-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
            }}
          >
            <Download className="mr-1 h-4 w-4" />
            Export Patrak (CSV)
          </Button>
          <Button variant="outline" size="sm" onClick={downloadExcelTemplate} disabled={isImporting}>
            <Download className="mr-1 h-4 w-4" />
            Download Template
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                {importProgress || "Importing..."}
              </>
            ) : (
              <>
                <Upload className="mr-1 h-4 w-4" />
                Import Template
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) await handleImportFile(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => printElement("stock-table")}
          >
            <Printer className="mr-1 h-4 w-4" />
            Print
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-muted-foreground">
              Total Sales (Items)
            </div>
            <div className="text-2xl font-bold text-primary">
              {stats.totalSales.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/10 border-emerald-500/20">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-muted-foreground">
              Available Stock
            </div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {stats.availableStock.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-purple-500/10 border-purple-500/20">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-muted-foreground">
              Total Display Qty
            </div>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {stats.totalDisplay.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-rose-500/10 border-rose-500/20">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-muted-foreground">
              Total Damage Qty
            </div>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">
              {stats.totalDamage.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 h-9"
              placeholder="Global Search (product, category, batch, supplier)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-[220px]">
            <Select
              value={columnFilters.category || selectedCategory}
              onValueChange={(val) => {
                setSelectedCategory(val);
                setColumnFilter("category", val === "all" ? "" : val);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {allCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-[210px]">
            <Select
              value={selectedStatus}
              onValueChange={(val) => {
                setSelectedStatus(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stock Status</SelectItem>
                <SelectItem value="not_in_next_folder">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500"></span>
                    <span>Not in next folder</span>
                  </div>
                </SelectItem>
                <SelectItem value="dead_stock">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-500"></span>
                    <span>Dead Stock</span>
                  </div>
                </SelectItem>
                <SelectItem value="nil">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    <span>Nil Stock</span>
                  </div>
                </SelectItem>
                <SelectItem value="regular">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    <span>Regular Stock Only</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {activeFilterPills.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="h-9 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear All ({activeFilterPills.length})
            </Button>
          )}
        </div>

        {/* Active Filter Pills Bar */}
        {activeFilterPills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs font-semibold text-slate-500 mr-1">Active Filters:</span>
            {activeFilterPills.map((pill) => (
              <Badge
                key={pill.key}
                variant="secondary"
                className="pl-2 pr-1 py-0.5 text-xs bg-blue-50 text-blue-900 border border-blue-200 flex items-center gap-1 hover:bg-blue-100 transition-colors"
              >
                <span>{pill.label}</span>
                <button
                  type="button"
                  onClick={pill.onRemove}
                  className="rounded-full p-0.5 hover:bg-blue-200/80 text-blue-700 hover:text-blue-950 transition-colors"
                  title="Remove filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-0" id="stock-table">
          <Table className="border-collapse border-2 border-slate-300" wrapperClassName="max-h-[calc(100vh-250px)]">
            <TableHeader className="sticky top-0 bg-slate-100 z-10 shadow-2xs border-b-2 border-slate-300">
              <TableRow>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800">
                  <div className="flex items-center justify-between gap-1.5 min-w-[120px]">
                    <span>Product</span>
                    <TextColumnFilter
                      title="Product"
                      columnName="product_name"
                      value={columnFilters.product}
                      onChange={(val) => setColumnFilter("product", val)}
                      placeholder="Search product..."
                    />
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800">
                  <div className="flex items-center justify-between gap-1.5 min-w-[110px]">
                    <span>Category</span>
                    <CategoryColumnFilter
                      categories={allCategories}
                      value={columnFilters.category || (selectedCategory !== "all" ? selectedCategory : "")}
                      onChange={(val) => {
                        setColumnFilter("category", val);
                        if (val) setSelectedCategory(val);
                        else setSelectedCategory("all");
                      }}
                    />
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800">
                  <div className="flex items-center justify-between gap-1.5 min-w-[90px]">
                    <span>Batch</span>
                    <TextColumnFilter
                      title="Batch"
                      columnName="batch_number"
                      value={columnFilters.batch}
                      onChange={(val) => setColumnFilter("batch", val)}
                      placeholder="Search batch..."
                    />
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <NumericColumnFilter
                      title="Sold"
                      filterType={columnFilters.soldType}
                      minValue={columnFilters.minSold}
                      maxValue={columnFilters.maxSold}
                      onChange={(type, min, max) => setNumericColumnFilter("sold", type, min, max)}
                    />
                    <span>Sold</span>
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <NumericColumnFilter
                      title="Available"
                      filterType={columnFilters.availableType}
                      minValue={columnFilters.minAvailable}
                      maxValue={columnFilters.maxAvailable}
                      onChange={(type, min, max) => setNumericColumnFilter("available", type, min, max)}
                    />
                    <span>Available</span>
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-indigo-800 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <NumericColumnFilter
                      title="Stock Maintain"
                      filterType={columnFilters.stockMaintainType}
                      minValue={columnFilters.minStockMaintain}
                      maxValue={columnFilters.maxStockMaintain}
                      onChange={(type, min, max) => setNumericColumnFilter("stockMaintain", type, min, max)}
                    />
                    <span className="whitespace-nowrap">Stock Maintain</span>
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-amber-700 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <NumericColumnFilter
                      title="Hold"
                      filterType={columnFilters.holdType}
                      minValue={columnFilters.minHold}
                      maxValue={columnFilters.maxHold}
                      onChange={(type, min, max) => setNumericColumnFilter("hold", type, min, max)}
                    />
                    <span>Hold</span>
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <NumericColumnFilter
                      title="Display"
                      filterType={columnFilters.displayType}
                      minValue={columnFilters.minDisplay}
                      maxValue={columnFilters.maxDisplay}
                      onChange={(type, min, max) => setNumericColumnFilter("display", type, min, max)}
                    />
                    <span>Display</span>
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <NumericColumnFilter
                      title="Damaged"
                      filterType={columnFilters.damageType}
                      minValue={columnFilters.minDamage}
                      maxValue={columnFilters.maxDamage}
                      onChange={(type, min, max) => setNumericColumnFilter("damage", type, min, max)}
                    />
                    <span>Damaged</span>
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800">
                  <div className="flex items-center justify-between gap-1.5 min-w-[120px]">
                    <span>Description</span>
                    <TextColumnFilter
                      title="Description"
                      columnName="description"
                      value={columnFilters.description}
                      onChange={(val) => setColumnFilter("description", val)}
                      placeholder="Search description..."
                    />
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800">
                  <div className="flex items-center justify-between gap-1.5 min-w-[100px]">
                    <span>Updated</span>
                    <TextColumnFilter
                      title="Updated Date"
                      value={columnFilters.updatedDate}
                      onChange={(val) => setColumnFilter("updatedDate", val)}
                      placeholder="Search date..."
                    />
                  </div>
                </TableHead>
                <TableHead className="border-2 border-slate-300 px-3 py-2.5 font-bold text-slate-800 text-right no-print">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && batches.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="border-2 border-slate-300 text-center text-muted-foreground py-8"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      Loading stock items...
                    </div>
                  </TableCell>
                </TableRow>
              ) : batches.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="border-2 border-slate-300 text-center text-muted-foreground py-8"
                  >
                    No stock entries found
                  </TableCell>
                </TableRow>
              ) : (
                batches.map((b) => (
                  <TableRow
                    key={b.id}
                    className={`transition-colors ${
                      b.isDeadStock
                        ? "bg-slate-400/90 text-slate-900 hover:bg-slate-500/90 border-slate-300"
                        : b.isCancelled
                        ? "bg-red-200/90 text-red-950 hover:bg-red-300/90 border-red-300"
                        : b.isNil
                        ? "bg-blue-200/90 text-blue-950 hover:bg-blue-300/90 border-blue-300"
                        : "hover:bg-slate-50/50"
                    }`}
                  >
                    <TableCell className={`border-2 border-slate-300 px-4 py-3 align-middle font-bold ${b.isCancelled ? "text-red-950" : b.isNil ? "text-blue-950" : "text-slate-800"}`}>
                      {b.productName}
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle font-medium text-slate-700">{b.category}</TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle font-medium text-slate-700">{b.batchNumber}</TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle text-right font-bold text-blue-700">
                      {b.quantity -
                        b.availableQty -
                        (b.displayQty || 0) -
                        (b.damageQty || 0) -
                        (b.holdQty || 0) || 0}
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle text-right font-bold text-emerald-700">
                      {b.availableQty}
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle text-right font-bold text-indigo-700">
                      {b.stockMaintain ?? 0}
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle text-right font-bold text-amber-600">
                      {b.holdQty || 0}
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle text-right font-medium text-slate-600">
                      {b.displayQty || 0}
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle text-right font-medium text-red-600">
                      {b.damageQty}
                    </TableCell>
                    <TableCell
                      className="border-2 border-slate-300 px-4 py-3 align-middle max-w-[200px] truncate font-medium text-sm text-slate-700"
                      title={b.description}
                    >
                      {b.description || "-"}
                    </TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle text-xs font-medium text-slate-600">{formatUpdatedDate(b.date)}</TableCell>
                    <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle text-right no-print">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-100/80"
                          onClick={() => setEditingBatch(b)}
                          title="Edit Batch"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-red-700 hover:bg-red-100/80"
                          onClick={() => handleDelete(b.id)}
                          title="Delete Batch"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-t-2 border-slate-300 bg-slate-50 no-print">
            <div className="text-sm text-slate-600 font-medium">
              Showing {total === 0 ? 0 : (page - 1) * limit + 1} to{" "}
              {Math.min(page * limit, total)} of {total} entries
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <span className="text-sm font-semibold px-2.5 py-1 bg-white border border-slate-300 rounded text-slate-700 shadow-2xs">
                Page {page} of {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!editingBatch}
        onOpenChange={(o) => !o && setEditingBatch(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Stock Batch</DialogTitle>
          </DialogHeader>
          {editingBatch && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Product</Label>
                <Input
                  className="col-span-3"
                  value={editingBatch.productName}
                  onChange={(e) =>
                    setEditingBatch({
                      ...editingBatch,
                      productName: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Category</Label>
                <div className="col-span-3">
                  <Select
                    value={editingBatch.category}
                    onValueChange={(v) =>
                      setEditingBatch({ ...editingBatch, category: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Category" />
                    </SelectTrigger>
                    <SelectContent>
                      {allCategories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Batch Number</Label>
                <Input
                  className="col-span-3"
                  value={editingBatch.batchNumber || ""}
                  onChange={(e) =>
                    setEditingBatch({
                      ...editingBatch,
                      batchNumber: e.target.value,
                    })
                  }
                  placeholder="Batch Number"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Available Qty</Label>
                <div className="col-span-3 flex gap-2">
                  <Input
                    type="number"
                    disabled={!isAdminUnlocked}
                    className="flex-1"
                    value={editingBatch.availableQty}
                    onChange={(e) =>
                      setEditingBatch({
                        ...editingBatch,
                        availableQty: Number(e.target.value),
                      })
                    }
                  />
                  {!isAdminUnlocked && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const password = prompt(
                          "Please enter admin password to unlock:",
                        );
                        if (password === "admin") {
                          setIsAdminUnlocked(true);
                          toast({
                            title: "Unlocked",
                            description: "Available quantity editing enabled.",
                          });
                        } else {
                          if (password !== null)
                            toast({
                              title: "Incorrect password",
                              variant: "destructive",
                            });
                        }
                      }}
                    >
                      Unlock
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Display Qty</Label>
                <Input
                  type="number"
                  className="col-span-3"
                  value={editingBatch.displayQty || 0}
                  onChange={(e) => {
                    const newDisplay = Number(e.target.value);
                    const oldDisplay = editingBatch.displayQty || 0;
                    const diff = newDisplay - oldDisplay;
                    setEditingBatch({
                      ...editingBatch,
                      displayQty: newDisplay,
                      availableQty: (editingBatch.availableQty || 0) - diff,
                    });
                  }}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Damage Qty</Label>
                <Input
                  type="number"
                  className="col-span-3"
                  value={editingBatch.damageQty || 0}
                  onChange={(e) => {
                    const newDamage = Number(e.target.value);
                    const oldDamage = editingBatch.damageQty || 0;
                    const diff = newDamage - oldDamage;
                    setEditingBatch({
                      ...editingBatch,
                      damageQty: newDamage,
                      availableQty: (editingBatch.availableQty || 0) - diff,
                    });
                  }}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Stock Maintain</Label>
                <Input
                  type="number"
                  className="col-span-3"
                  placeholder="0"
                  value={editingBatch.stockMaintain ?? 0}
                  onChange={(e) =>
                    setEditingBatch({
                      ...editingBatch,
                      stockMaintain: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Description</Label>
                <Input
                  className="col-span-3"
                  value={editingBatch.description || ""}
                  onChange={(e) =>
                    setEditingBatch({
                      ...editingBatch,
                      description: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Status</Label>
                <div className="col-span-3 grid grid-cols-3 gap-1.5">
                  <div
                    onClick={() =>
                      setEditingBatch({
                        ...editingBatch,
                        isNil: !editingBatch.isNil,
                        isCancelled: false,
                        isDeadStock: false,
                      })
                    }
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-all duration-150 justify-center cursor-pointer select-none ${editingBatch.isNil ? "border-blue-600 bg-blue-100 shadow-md ring-1 ring-blue-300" : "border-muted-foreground/20 bg-background hover:border-blue-300"}`}
                  >
                    <Checkbox
                      id="isNil"
                      checked={editingBatch.isNil || false}
                      onCheckedChange={(c) =>
                        setEditingBatch({
                          ...editingBatch,
                          isNil: c as boolean,
                          isCancelled: c
                            ? false
                            : editingBatch.isCancelled || false,
                          isDeadStock: c ? false : editingBatch.isDeadStock || false,
                        })
                      }
                      className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 data-[state=checked]:text-white h-4 w-4 pointer-events-none"
                    />
                    <Label
                      htmlFor="isNil"
                      className={`text-xs font-semibold cursor-pointer pointer-events-none ${editingBatch.isNil ? "text-blue-900 font-bold" : "text-blue-600"}`}
                    >
                      Not next Folder
                    </Label>
                  </div>
                  <div
                    onClick={() =>
                      setEditingBatch({
                        ...editingBatch,
                        isCancelled: !editingBatch.isCancelled,
                        isNil: false,
                        isDeadStock: false,
                      })
                    }
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-all duration-150 justify-center cursor-pointer select-none ${editingBatch.isCancelled ? "border-red-600 bg-red-200 shadow-md ring-1 ring-red-300" : "border-muted-foreground/20 bg-background hover:border-red-300"}`}
                  >
                    <Checkbox
                      id="isCancelled"
                      checked={editingBatch.isCancelled || false}
                      onCheckedChange={(c) =>
                        setEditingBatch({
                          ...editingBatch,
                          isCancelled: c as boolean,
                          isNil: c ? false : editingBatch.isNil || false,
                          isDeadStock: c ? false : editingBatch.isDeadStock || false,
                        })
                      }
                      className="data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600 data-[state=checked]:text-white h-4 w-4 pointer-events-none"
                    />
                    <Label
                      htmlFor="isCancelled"
                      className={`text-xs font-semibold cursor-pointer pointer-events-none ${editingBatch.isCancelled ? "text-red-900 font-bold" : "text-destructive"}`}
                    >
                      Dead Stock
                    </Label>
                  </div>
                  <div
                    onClick={() =>
                      setEditingBatch({
                        ...editingBatch,
                        isDeadStock: !editingBatch.isDeadStock,
                        isNil: false,
                        isCancelled: false,
                      })
                    }
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-all duration-150 justify-center cursor-pointer select-none ${editingBatch.isDeadStock ? "border-slate-900 bg-slate-900 text-white shadow-md ring-1 ring-slate-700" : "border-muted-foreground/20 bg-background hover:border-slate-800"}`}
                  >
                    <Checkbox
                      id="isDeadStock"
                      checked={editingBatch.isDeadStock || false}
                      onCheckedChange={(c) =>
                        setEditingBatch({
                          ...editingBatch,
                          isDeadStock: c as boolean,
                          isNil: c ? false : editingBatch.isNil || false,
                          isCancelled: c ? false : editingBatch.isCancelled || false,
                        })
                      }
                      className="data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-slate-900 h-4 w-4 pointer-events-none"
                    />
                    <Label
                      htmlFor="isDeadStock"
                      className={`text-xs font-semibold cursor-pointer pointer-events-none ${editingBatch.isDeadStock ? "text-white font-bold" : "text-slate-800"}`}
                    >
                      Nil
                    </Label>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBatch(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
