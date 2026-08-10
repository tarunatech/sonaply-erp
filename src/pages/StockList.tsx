import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getBatches,
  exportCSV,
  deleteBatch,
  updateBatch,
  addBatch,
  addPurchase,
  getSales,
  Sale,
  StockBatch,
  CATEGORIES,
  getLocalDateString,
  formatLocalDate,
} from "@/lib/store";
import { format } from "date-fns";

import { printElement } from "@/lib/print";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function StockList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [allBatches, setAllBatches] = useState<StockBatch[]>([]);
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

  const refreshData = useCallback(async () => {
    const [b, s] = await Promise.all([getBatches(), getSales()]);
    setAllBatches(b);
    setPendingOrders(s.filter((sale) => sale.status !== "Delivered" && sale.status !== "Cancelled" && sale.pendingQty > 0));
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    const handleStockUpdate = () => refreshData();
    window.addEventListener("erp-stock-updated", handleStockUpdate);
    return () =>
      window.removeEventListener("erp-stock-updated", handleStockUpdate);
  }, [refreshData]);

  const categoriesList = useMemo(() => {
    const list = new Set<string>();
    allBatches.forEach((b) => {
      if (b.category) list.add(b.category);
    });
    // Add default categories from store
    CATEGORIES.forEach((c) => list.add(c));
    return Array.from(list).sort();
  }, [allBatches]);

  const batches = useMemo(() => {
    let b = allBatches;
    if (selectedCategory && selectedCategory !== "all") {
      b = b.filter(
        (i) =>
          (i.category || "").toLowerCase() === selectedCategory.toLowerCase(),
      );
    }
    if (search) {
      const s = search.toLowerCase().trim();
      const tokens = s.split(/\s+/).filter(Boolean);
      b = b.filter((i) => {
        const fullString = `${i.productName || ""} ${i.productCode || ""} ${i.batchNumber || ""} ${i.category || ""} ${i.supplier || ""} ${i.description || ""}`.toLowerCase();
        return tokens.every((token) => fullString.includes(token));
      });
    }
    return [...b].sort((a, b) => {
      const nameCompare = (a.productName || "").localeCompare(
        b.productName || "",
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      if (nameCompare !== 0) return nameCompare;
      return (a.batchNumber || "").localeCompare(
        b.batchNumber || "",
        undefined,
        { numeric: true, sensitivity: "base" },
      );
    });
  }, [allBatches, search, selectedCategory]);

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
      "productName",
      "category",
      "batchNum",
      "supplier",
      "date",
      "availableQty",
      "damageQty",
      "displayQty",
      "description",
      "isNil",
      "isCancelled",
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
      "Optional note",
      "false",
      "false",
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
      productName: findHeader(["productName", "product_name", "product"]),
      category: findHeader(["category"]),
      batchNumber: findHeader([
        "batchNum",
        "batchNumber",
        "batchNo",
        "batch_number",
      ]),
      supplier: findHeader(["supplier", "supplierName", "supplier_name"]),
      quantity: findHeader(["quantity", "qty"]),
      date: findHeader(["date"]),
      availableQty: findHeader(["availableQty", "available_qty", "available"]),
      damageQty: findHeader(["damageQty", "damage_qty", "damage"]),
      displayQty: findHeader([
        "displayQty",
        "display_qty",
        "display",
        "nilQty",
        "nil_qty",
      ]),
      description: findHeader(["description", "desc", "notes", "narration"]),
      isNil: findHeader(["isNil", "is_nil", "nil"]),
      isCancelled: findHeader(["isCancelled", "is_cancelled", "cancelled"]),
    };

    if (
      !mapKeys.productName ||
      !mapKeys.category ||
      (!mapKeys.availableQty && !mapKeys.quantity)
    ) {
      toast({
        title: "Invalid template",
        description:
          "Template must include columns for productName, category, and availableQty (or quantity).",
        variant: "destructive",
      });
      return;
    }

    let created = 0;
    let updated = 0;
    const existingByKey = new Set(
      allBatches.map(
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
      damageQty: number;
      displayQty: number;
      description: string;
      isNil: boolean;
      isCancelled: boolean;
    }

    const parsedRows: ParsedRow[] = [];

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
      const description = mapKeys.description
        ? row[mapKeys.description]?.trim() || ""
        : "";
      const isNil = mapKeys.isNil
        ? String(row[mapKeys.isNil] || "").toLowerCase() === "true"
        : false;
      const isCancelled = mapKeys.isCancelled
        ? String(row[mapKeys.isCancelled] || "").toLowerCase() === "true"
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
          damageQty: dmgForBatch,
          displayQty: dispForBatch,
          description,
          isNil,
          isCancelled,
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
        if (row.isNil) existing.isNil = true;
        if (row.isCancelled) existing.isCancelled = true;
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
          damageQty: row.damageQty,
          displayQty: row.displayQty,
          description: row.description,
          isNil: row.isNil,
          isCancelled: row.isCancelled,
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
            onClick={() => {
              let csvContent = "";

              const brands: Record<string, Record<string, any[]>> = {};
              batches.forEach((b) => {
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
                csvContent += `Brand: ${brand},,,,,,,,\n`;
                csvContent += `Product Name,Product Number,Date,Quantity,Available,Hold,Display,Damaged,Description\n`;

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
                      csvContent += `"${prefix}","${item.parsedSuffix}","${item.date || ""}","${item.quantity || 0}","${item.availableQty || 0}","${item.holdQty || 0}","${item.displayQty || 0}","${item.damageQty || 0}","${cleanDesc}"\n`;
                    });
                  // Empty row between groups
                  csvContent += `,,,,,,,,,\n`;
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
              {allBatches
                .reduce(
                  (acc, b) =>
                    acc +
                    Math.max(
                      0,
                      b.quantity -
                        b.availableQty -
                        (b.displayQty || 0) -
                        (b.damageQty || 0) -
                        (b.holdQty || 0),
                    ),
                  0,
                )
                .toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/10 border-emerald-500/20">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-muted-foreground">
              Available Stock
            </div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {allBatches
                .reduce((acc, b) => acc + (b.availableQty || 0), 0)
                .toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-purple-500/10 border-purple-500/20">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-muted-foreground">
              Total Display Qty
            </div>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {allBatches
                .reduce((acc, b) => acc + (b.displayQty || 0), 0)
                .toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-rose-500/10 border-rose-500/20">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-muted-foreground">
              Total Damage Qty
            </div>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">
              {allBatches
                .reduce((acc, b) => acc + (b.damageQty || 0), 0)
                .toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search product, category or batch..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-[220px]">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger>
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categoriesList.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Card>
        <CardContent className="p-0" id="stock-table">
          <Table className="border-collapse border-2 border-slate-300" wrapperClassName="max-h-[calc(100vh-250px)]">
            <TableHeader className="sticky top-0 bg-slate-100 z-10 shadow-2xs border-b-2 border-slate-300">
              <TableRow>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800">Product</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800">Category</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800">Batch</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800 text-right">Sold</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800 text-right">Available</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-amber-700 text-right">Hold</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800 text-right">Display</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800 text-right">Damaged</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800">Description</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800">Updated</TableHead>
                <TableHead className="border-2 border-slate-300 px-4 py-3 font-bold text-slate-800 text-right no-print">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={11}
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
                      {categoriesList.map((c) => (
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
                      Nil
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
                      Cancelled
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
                      DeadStock
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
