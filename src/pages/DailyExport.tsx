import { useState, useEffect, useMemo } from "react";
import {
  getSales,
  getPurchases,
  getBatches,
  exportCSV,
  deleteSale,
  deletePurchase,
  deleteBatch,
  getSalesReturns,
  getChallans,
  StockBatch,
  Sale,
  Purchase,
  SaleReturn,
  Challan,
  getLocalDateString,
  CATEGORIES,
} from "@/lib/store";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Download,
  Search,
  RefreshCw,
  Layers,
  Eye,
  Trash2,
  Filter,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
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
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface LedgerTransaction {
  id: string;
  date: string;
  type: "Addition" | "Subtraction";
  qty: number;
  description: string;
  source:
    | "purchase"
    | "batch"
    | "sale"
    | "sales_return"
    | "challan_cancel"
    | "delivered_challan";
  isNil?: boolean;
  isCancelled?: boolean;
  isDeadStock?: boolean;
}

const formatDateDDMMYYYY = (dateStr: string) => {
  if (!dateStr) return "";
  const parts = dateStr.slice(0, 10).split("-");
  if (parts.length === 3 && parts[0].length === 4) {
    const [year, month, day] = parts;
    return `${day}-${month}-${year}`;
  }
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch (e) {}
  return dateStr;
};

/**
 * Safely extracts YYYY-MM-DD in local time from any date, timestamp, or string
 * ensuring full 24-hour inclusion (including transactions at 11:00 PM).
 */
const extractDateOnly = (val: any): string => {
  if (!val) return "";
  if (val instanceof Date) {
    return getLocalDateString(val);
  }
  const str = String(val).trim();
  if (!str) return "";

  // If ISO string with timezone or time (e.g. 2026-09-25T23:00:00 or with Z)
  if (str.includes("T")) {
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return getLocalDateString(d);
      }
    } catch (e) {}
  }

  // If format is YYYY-MM-DD (e.g. "2026-09-25" or "2026-09-25 23:00:00")
  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
  }

  // If format is DD-MM-YYYY (e.g. "25-09-2026")
  const dmyMatch = str.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  return str.slice(0, 10);
};

const isDateInRange = (dateVal: any, start: string, end: string): boolean => {
  const d = extractDateOnly(dateVal);
  if (!d) return false;
  const s = extractDateOnly(start);
  const e = extractDateOnly(end);
  return d >= s && d <= e;
};

export interface ProductStockSnapshot {
  productName: string;
  category: string;
  supplier: string;
  status: string;
  purchasedQty: number;
  soldQty: number;
  salesReturnQty: number;
  openingStock: number;
  availableQty: number;
  holdQty: number;
  displayQty: number;
  damageQty: number;
  totalStock: number;
  batchNumbers: Set<string>;
  description: string;
  currentAvailableQty: number;
  currentTotalStock: number;
}

export interface ProductIndex {
  normToDisplayName: Map<string, string>;
  productCategories: Map<string, string>;
  batchesByProduct: Map<string, StockBatch[]>;
  purchasesByProduct: Map<string, Purchase[]>;
  salesByProduct: Map<string, Sale[]>;
  returnsByProduct: Map<string, SaleReturn[]>;
  purchaseBatchKeys: Set<string>;
}

export function buildProductIndex(
  allBatches: StockBatch[],
  allPurchases: Purchase[],
  allSales: Sale[],
  allSalesReturns: SaleReturn[]
): ProductIndex {
  const normToDisplayName = new Map<string, string>();
  const productCategories = new Map<string, string>();
  const batchesByProduct = new Map<string, StockBatch[]>();
  const purchasesByProduct = new Map<string, Purchase[]>();
  const salesByProduct = new Map<string, Sale[]>();
  const returnsByProduct = new Map<string, SaleReturn[]>();
  const purchaseBatchKeys = new Set<string>();

  // 1. Index Batches
  for (let i = 0; i < allBatches.length; i++) {
    const b = allBatches[i];
    if (!b.productName) continue;
    const norm = b.productName.toLowerCase().trim();
    if (!norm) continue;

    if (!normToDisplayName.has(norm)) {
      normToDisplayName.set(norm, b.productName.trim());
    }
    if (b.category?.trim() && !productCategories.has(norm)) {
      productCategories.set(norm, b.category.trim());
    }

    let arr = batchesByProduct.get(norm);
    if (!arr) {
      arr = [];
      batchesByProduct.set(norm, arr);
    }
    arr.push(b);
  }

  // 2. Index Purchases
  for (let i = 0; i < allPurchases.length; i++) {
    const p = allPurchases[i];
    if (!p.productName) continue;
    const norm = p.productName.toLowerCase().trim();
    if (!norm) continue;

    if (!normToDisplayName.has(norm)) {
      normToDisplayName.set(norm, p.productName.trim());
    }
    if (p.category?.trim() && !productCategories.has(norm)) {
      productCategories.set(norm, p.category.trim());
    }

    let arr = purchasesByProduct.get(norm);
    if (!arr) {
      arr = [];
      purchasesByProduct.set(norm, arr);
    }
    arr.push(p);

    const bNum = p.batchNumber ? String(p.batchNumber).trim() : "0";
    purchaseBatchKeys.add(`${norm}:::${bNum}`);
  }

  // 3. Index Sales
  for (let i = 0; i < allSales.length; i++) {
    const s = allSales[i];
    if (!s.product) continue;
    const norm = s.product.toLowerCase().trim();
    if (!norm) continue;

    if (!normToDisplayName.has(norm)) {
      normToDisplayName.set(norm, s.product.trim());
    }
    if (s.category?.trim() && s.category !== "Regular" && !productCategories.has(norm)) {
      productCategories.set(norm, s.category.trim());
    }

    let arr = salesByProduct.get(norm);
    if (!arr) {
      arr = [];
      salesByProduct.set(norm, arr);
    }
    arr.push(s);
  }

  // 4. Index Returns
  for (let i = 0; i < allSalesReturns.length; i++) {
    const r = allSalesReturns[i];
    if (!r.productName) continue;
    const norm = r.productName.toLowerCase().trim();
    if (!norm) continue;

    if (!normToDisplayName.has(norm)) {
      normToDisplayName.set(norm, r.productName.trim());
    }

    let arr = returnsByProduct.get(norm);
    if (!arr) {
      arr = [];
      returnsByProduct.set(norm, arr);
    }
    arr.push(r);
  }

  return {
    normToDisplayName,
    productCategories,
    batchesByProduct,
    purchasesByProduct,
    salesByProduct,
    returnsByProduct,
    purchaseBatchKeys,
  };
}

/**
 * Calculates historical closing stock for a given product in O(product transactions) using pre-built indexes.
 */
export function computeClosingStockForProductIndexed({
  normName,
  targetDate,
  index,
}: {
  normName: string;
  targetDate: string;
  index: ProductIndex;
}) {
  const productBatches = index.batchesByProduct.get(normName) || [];
  let currentAvailable = 0;
  let currentHold = 0;
  let currentDisplay = 0;
  let currentDamage = 0;

  for (let i = 0; i < productBatches.length; i++) {
    const b = productBatches[i];
    currentAvailable += Number(b.availableQty || 0);
    currentHold += Number(b.holdQty || 0);
    currentDisplay += Number(b.displayQty || 0);
    currentDamage += Number(b.damageQty || 0);
  }
  const currentTotalStock = currentAvailable + currentHold + currentDisplay + currentDamage;

  const tDate = extractDateOnly(targetDate);
  if (!tDate) {
    return {
      currentAvailable,
      currentHold,
      currentDisplay,
      currentDamage,
      currentTotalStock,
      closingTotalStock: currentTotalStock,
      closingAvailableQty: currentAvailable,
      closingHoldQty: currentHold,
      closingDisplayQty: currentDisplay,
      closingDamageQty: currentDamage,
    };
  }

  // Transactions strictly AFTER targetDate
  let purchasedAfter = 0;
  const purchases = index.purchasesByProduct.get(normName);
  if (purchases) {
    for (let i = 0; i < purchases.length; i++) {
      const p = purchases[i];
      if (extractDateOnly(p.date) > tDate) {
        purchasedAfter += Number(p.quantity || 0);
      }
    }
  }

  let manualBatchesAfter = 0;
  for (let i = 0; i < productBatches.length; i++) {
    const b = productBatches[i];
    if (extractDateOnly(b.date) > tDate) {
      const bNum = b.batchNumber ? String(b.batchNumber).trim() : "0";
      if (!index.purchaseBatchKeys.has(`${normName}:::${bNum}`)) {
        manualBatchesAfter += Number(b.quantity || 0);
      }
    }
  }

  let returnsAfter = 0;
  const returns = index.returnsByProduct.get(normName);
  if (returns) {
    for (let i = 0; i < returns.length; i++) {
      const r = returns[i];
      if (extractDateOnly(r.receiveDate) > tDate) {
        returnsAfter += Number(r.quantity || 0);
      }
    }
  }

  let soldAfter = 0;
  let cancelledAfterForPriorSales = 0;
  const sales = index.salesByProduct.get(normName);
  if (sales) {
    for (let i = 0; i < sales.length; i++) {
      const s = sales[i];
      const sDate = extractDateOnly(s.orderDate || s.estimatedDeliveryDate || s.createdAt);
      if (s.status !== "Cancelled") {
        if (sDate > tDate) {
          soldAfter += Number(s.orderedQty || 0);
        }
      } else {
        const cancelDate = extractDateOnly(s.updatedAt || s.orderDate);
        if (sDate <= tDate && cancelDate > tDate) {
          cancelledAfterForPriorSales += Number(s.orderedQty || 0);
        }
      }
    }
  }

  const netAdditionsAfter = purchasedAfter + manualBatchesAfter + returnsAfter + cancelledAfterForPriorSales;
  const netSubtractionsAfter = soldAfter;

  const closingTotalStock = Math.max(0, currentTotalStock - netAdditionsAfter + netSubtractionsAfter);
  const closingHoldQty = Math.min(currentHold, closingTotalStock);
  const closingDisplayQty = Math.min(currentDisplay, Math.max(0, closingTotalStock - closingHoldQty));
  const closingDamageQty = Math.min(currentDamage, Math.max(0, closingTotalStock - closingHoldQty - closingDisplayQty));
  const closingAvailableQty = Math.max(0, closingTotalStock - closingHoldQty - closingDisplayQty - closingDamageQty);

  return {
    currentAvailable,
    currentHold,
    currentDisplay,
    currentDamage,
    currentTotalStock,
    closingTotalStock,
    closingAvailableQty,
    closingHoldQty,
    closingDisplayQty,
    closingDamageQty,
  };
}

/**
 * Computes full category stock snapshots (Opening, Purchases, Sales, Returns, Closing Stock)
 * using pre-indexed lookup maps in O(products) time.
 */
export function computeStockSnapshotsHelper({
  allBatches,
  allPurchases,
  allSales,
  allSalesReturns,
  startDate,
  endDate,
  categoryFilter,
  index,
}: {
  allBatches: StockBatch[];
  allPurchases: Purchase[];
  allSales: Sale[];
  allSalesReturns: SaleReturn[];
  startDate: string;
  endDate: string;
  categoryFilter?: string;
  index?: ProductIndex;
}) {
  const prodIndex = index || buildProductIndex(allBatches, allPurchases, allSales, allSalesReturns);
  const isCatFiltered = categoryFilter && categoryFilter !== "all";
  const targetCat = isCatFiltered ? categoryFilter.toLowerCase().trim() : "";

  const products: ProductStockSnapshot[] = [];

  prodIndex.normToDisplayName.forEach((originalName, normName) => {
    const category = prodIndex.productCategories.get(normName) || "Other";
    if (isCatFiltered && category.toLowerCase().trim() !== targetCat) return;

    const productBatches = prodIndex.batchesByProduct.get(normName) || [];
    const stockSnap = computeClosingStockForProductIndexed({
      normName,
      targetDate: endDate,
      index: prodIndex,
    });

    const batchNumbers = new Set<string>();
    for (let i = 0; i < productBatches.length; i++) {
      const b = productBatches[i];
      if (b.batchNumber) batchNumbers.add(String(b.batchNumber).trim());
    }
    const productPurchases = prodIndex.purchasesByProduct.get(normName) || [];
    for (let i = 0; i < productPurchases.length; i++) {
      const p = productPurchases[i];
      if (p.batchNumber) batchNumbers.add(String(p.batchNumber).trim());
    }

    const supplier =
      productBatches.find((b) => b.supplier)?.supplier ||
      productPurchases.find((p) => p.supplierName)?.supplierName ||
      "";

    const description =
      productBatches.find((b) => b.description)?.description ||
      productPurchases.find((p) => p.description)?.description ||
      "";

    const isInactive = productBatches.length > 0 && productBatches.every((b) => b.status === "Inactive");
    const status = isInactive ? "Inactive" : "Active";

    // Period transactions [startDate, endDate]
    let purchasedQty = 0;
    for (let i = 0; i < productPurchases.length; i++) {
      const p = productPurchases[i];
      if (isDateInRange(p.date, startDate, endDate)) {
        purchasedQty += Number(p.quantity || 0);
      }
    }

    for (let i = 0; i < productBatches.length; i++) {
      const b = productBatches[i];
      if (isDateInRange(b.date, startDate, endDate)) {
        const bNum = b.batchNumber ? String(b.batchNumber).trim() : "0";
        if (!prodIndex.purchaseBatchKeys.has(`${normName}:::${bNum}`)) {
          purchasedQty += Number(b.quantity || 0);
        }
      }
    }

    let soldQty = 0;
    const productSales = prodIndex.salesByProduct.get(normName) || [];
    for (let i = 0; i < productSales.length; i++) {
      const s = productSales[i];
      if (s.status !== "Cancelled") {
        const sDate = s.orderDate || s.estimatedDeliveryDate || s.createdAt;
        if (isDateInRange(sDate, startDate, endDate)) {
          soldQty += Number(s.orderedQty || 0);
        }
      }
    }

    let salesReturnQty = 0;
    const productReturns = prodIndex.returnsByProduct.get(normName) || [];
    for (let i = 0; i < productReturns.length; i++) {
      const r = productReturns[i];
      if (isDateInRange(r.receiveDate, startDate, endDate)) {
        salesReturnQty += Number(r.quantity || 0);
      }
    }

    const openingStock = Math.max(0, stockSnap.closingTotalStock - purchasedQty - salesReturnQty + soldQty);

    const hasAnyActivity =
      stockSnap.closingTotalStock > 0 ||
      openingStock > 0 ||
      purchasedQty > 0 ||
      soldQty > 0 ||
      salesReturnQty > 0 ||
      stockSnap.currentTotalStock > 0 ||
      productBatches.length > 0;

    if (hasAnyActivity) {
      products.push({
        productName: originalName,
        category,
        supplier,
        status,
        purchasedQty,
        soldQty,
        salesReturnQty,
        openingStock,
        availableQty: stockSnap.closingAvailableQty,
        holdQty: stockSnap.closingHoldQty,
        displayQty: stockSnap.closingDisplayQty,
        damageQty: stockSnap.closingDamageQty,
        totalStock: stockSnap.closingTotalStock,
        batchNumbers,
        description,
        currentAvailableQty: stockSnap.currentAvailable,
        currentTotalStock: stockSnap.currentTotalStock,
      });
    }
  });

  products.sort((a, b) =>
    a.productName.localeCompare(b.productName, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

  const totals = products.reduce(
    (acc, item) => {
      acc.opening += item.openingStock;
      acc.purchased += item.purchasedQty;
      acc.sold += item.soldQty;
      acc.returns += item.salesReturnQty;
      acc.available += item.availableQty;
      acc.hold += item.holdQty;
      acc.display += item.displayQty;
      acc.damage += item.damageQty;
      acc.totalStock += item.totalStock;
      return acc;
    },
    {
      opening: 0,
      purchased: 0,
      sold: 0,
      returns: 0,
      available: 0,
      hold: 0,
      display: 0,
      damage: 0,
      totalStock: 0,
    }
  );

  return { products, totals };
}

export default function DailyExport() {
  const { toast } = useToast();

  // Daily Export State (single date for daily sales, purchases, stock exports)
  const [date, setDate] = useState(getLocalDateString());

  // Stock Ledger Date Range States (for user selection)
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return getLocalDateString(d);
  });
  const [toDate, setToDate] = useState(() => getLocalDateString());

  // Applied Date Range States for Stock Ledger
  const [appliedFromDate, setAppliedFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return getLocalDateString(d);
  });
  const [appliedToDate, setAppliedToDate] = useState(() =>
    getLocalDateString(),
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Category Export Period State: Single Date Only (full 24 hrs) or Custom Range
  const [periodMode, setPeriodMode] = useState<"singleDate" | "custom">(
    "singleDate",
  );
  const [customFromDate, setCustomFromDate] = useState(() =>
    getLocalDateString(),
  );
  const [customToDate, setCustomToDate] = useState(() => getLocalDateString());
  const [showCategoryPreview, setShowCategoryPreview] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");

  const categoryStartDate = useMemo(() => {
    if (periodMode === "singleDate") return extractDateOnly(date);
    return extractDateOnly(customFromDate);
  }, [periodMode, date, customFromDate]);

  const categoryEndDate = useMemo(() => {
    if (periodMode === "singleDate") return extractDateOnly(date);
    return extractDateOnly(customToDate);
  }, [periodMode, date, customToDate]);

  // DB States
  const [allBatches, setAllBatches] = useState<StockBatch[]>([]);
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [allPurchases, setAllPurchases] = useState<Purchase[]>([]);
  const [allSalesReturns, setAllSalesReturns] = useState<SaleReturn[]>([]);
  const [allChallans, setAllChallans] = useState<Challan[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modal State for viewing specific product's transactions
  const [activeLedgerProduct, setActiveLedgerProduct] = useState<string | null>(
    null,
  );

  const loadLedgerData = async () => {
    setIsLoading(true);
    try {
      const [b, s, p, r, c] = await Promise.all([
        getBatches(),
        getSales(),
        getPurchases(),
        getSalesReturns(),
        getChallans(),
      ]);
      setAllBatches(b);
      setAllSales(s);
      setAllPurchases(p);
      setAllSalesReturns(r);
      setAllChallans(c);
    } catch (e) {
      console.error("Failed to load export data", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLedgerData();
  }, []);

  const productIndex = useMemo(() => {
    return buildProductIndex(allBatches, allPurchases, allSales, allSalesReturns);
  }, [allBatches, allPurchases, allSales, allSalesReturns]);

  const handleApplyLedgerFilter = () => {
    setAppliedFromDate(fromDate);
    setAppliedToDate(toDate);
    toast({
      title: "Stock Ledger Filtered",
      description: `Showing ledger records from ${fromDate} to ${toDate}`,
    });
  };

  const doExport = async (type: string) => {
    const d = date;
    let data: any[] = [];
    const batches = await getBatches();
    const isCategoryFiltered = selectedCategory && selectedCategory !== "all";
    const catName = isCategoryFiltered
      ? selectedCategory.toLowerCase().trim()
      : "";
    const catSuffix = isCategoryFiltered
      ? `-${selectedCategory.replace(/[^a-zA-Z0-9_-]/g, "_")}`
      : "";

    switch (type) {
      case "sales": {
        let rawSales = (await getSales()).filter((s) =>
          isDateInRange(
            s.orderDate || s.estimatedDeliveryDate || s.createdAt,
            d,
            d,
          ),
        );
        if (isCategoryFiltered) {
          rawSales = rawSales.filter((s) => {
            const batchMatch = batches.find(
              (b) =>
                b.productName?.toLowerCase().trim() ===
                s.product?.toLowerCase().trim(),
            );
            const sCat = (
              s.category && s.category !== "Regular"
                ? s.category
                : batchMatch?.category || ""
            )
              .toLowerCase()
              .trim();
            return sCat === catName;
          });
        }
        data = rawSales.map((s) => {
          const matchingBatch = batches.find(
            (b) =>
              b.productName === s.product ||
              (s.batchNo && b.batchNumber === s.batchNo),
          );
          const description =
            s.description || s.remarks || matchingBatch?.description || "";
          const isCancelled =
            s.status === "Cancelled" || matchingBatch?.isCancelled || false;
          const isNil =
            !isCancelled &&
            (s.orderedQty === 0 || matchingBatch?.isNil || false);
          const isDeadStock = matchingBatch?.isDeadStock || false;
          const status = isCancelled
            ? "Dead Stock"
            : isNil
              ? "Not next Folder"
              : isDeadStock
                ? "Nil"
                : s.status;
          return {
            "Customer Name": s.customer,
            Product: s.product,
            Category: s.category,
            Ordered: s.orderedQty,
            Delivered: s.deliveredQty || 0,
            Pending: s.pendingQty || 0,
            "Phone No": s.clientPhone || "",
            "Order No": s.orderNo,
            "Order Date": s.orderDate,
            Description: description,
            "Stock Category": s.stockCategory || "Available",
            "Is Not next Folder": isNil ? "Yes" : "No",
            "Is Dead Stock": isCancelled ? "Yes" : "No",
            "Is Nil": isDeadStock ? "Yes" : "No",
            Status: status,
          };
        });
        break;
      }
      case "purchases": {
        let rawPurchases = (await getPurchases()).filter((p) =>
          isDateInRange(p.date, d, d),
        );
        if (isCategoryFiltered) {
          rawPurchases = rawPurchases.filter(
            (p) => (p.category || "").toLowerCase().trim() === catName,
          );
        }
        data = rawPurchases.map((p) => {
          const matchingBatch = batches.find(
            (b) =>
              (b.productName?.toLowerCase().trim() ===
                p.productName?.toLowerCase().trim() &&
                b.batchNumber === p.batchNumber) ||
              b.batchNumber === p.batchNumber,
          );
          const description = p.description || matchingBatch?.description || "";
          const isCancelled = matchingBatch?.isCancelled || false;
          const isNil = matchingBatch?.isNil || false;
          const isDeadStock = matchingBatch?.isDeadStock || false;
          const status = isCancelled
            ? "Dead Stock"
            : isNil
              ? "Not next Folder"
              : isDeadStock
                ? "Nil"
                : "Active";
          return {
            Date: p.date,
            "Supplier Name": p.supplierName,
            "Supplier Phone": p.supplierPhone || "",
            "Product Name": p.productName,
            Category: p.category,
            "Batch Number": p.batchNumber,
            Quantity: p.quantity,
            Rate: p.rate || 0,
            "Total Amount": p.totalAmount || 0,
            Description: description,
            "Is Not next Folder": isNil ? "Yes" : "No",
            "Is Dead Stock": isCancelled ? "Yes" : "No",
            "Is Nil": isDeadStock ? "Yes" : "No",
            Status: status,
          };
        });
        break;
      }
      case "stock": {
        const snapshots = computeStockSnapshotsHelper({
          allBatches,
          allPurchases,
          allSales,
          allSalesReturns,
          startDate: d,
          endDate: d,
          categoryFilter: selectedCategory,
          index: productIndex,
        });

        if (!snapshots.products.length) {
          toast({
            title: "No Data Available",
            description: isCategoryFiltered
              ? `No stock records found for category "${selectedCategory}" on ${formatDateDDMMYYYY(d)}.`
              : `No stock records found on ${formatDateDDMMYYYY(d)}.`,
            variant: "destructive",
          });
          return;
        }

        data = snapshots.products.map((p) => ({
          Date: formatDateDDMMYYYY(d),
          "Product Name": p.productName,
          Category: p.category,
          "Opening Stock": p.openingStock,
          "Purchased Qty": p.purchasedQty,
          "Sold Qty": p.soldQty,
          "Sales Return Qty": p.salesReturnQty,
          "Closing Available Qty": p.availableQty,
          "Hold Qty": p.holdQty,
          "Display Qty": p.displayQty,
          "Damage Qty": p.damageQty,
          "Total Closing Stock": p.totalStock,
          Status: p.status,
          Batches: Array.from(p.batchNumbers).join("; "),
          Supplier: p.supplier,
          Description: p.description || "",
        }));
        exportCSV(data, `daily-closing-stock${catSuffix}-${d}.csv`);
        return;
      }
    }
    if (!data.length) {
      toast({
        title: "No Data Available",
        description: isCategoryFiltered
          ? `No ${type} records found for category "${selectedCategory}" on ${formatDateDDMMYYYY(d)}.`
          : `No ${type} records found on ${formatDateDDMMYYYY(d)}.`,
        variant: "destructive",
      });
      return;
    }
    exportCSV(data, `daily-${type}${catSuffix}-${d}.csv`);
  };

  // Compile transactions and ledger dynamically based on appliedFromDate & appliedToDate
  const ledgerData = useMemo(() => {
    return Array.from(productIndex.normToDisplayName.entries())
      .map(([normName, productName]) => {
        const category = productIndex.productCategories.get(normName) || "Other";
        const transactions: LedgerTransaction[] = [];
        const productBatches = productIndex.batchesByProduct.get(normName) || [];
        const productPurchases = productIndex.purchasesByProduct.get(normName) || [];
        const productSales = productIndex.salesByProduct.get(normName) || [];
        const productReturns = productIndex.returnsByProduct.get(normName) || [];

        let currentAvailable = 0;
        let isProductDeadStock = false;
        let isProductCancelled = false;
        let isProductNil = false;

        const batchByNumber = new Map<string, StockBatch>();
        for (let i = 0; i < productBatches.length; i++) {
          const b = productBatches[i];
          currentAvailable +=
            Number(b.availableQty || 0) +
            Number(b.displayQty || 0) +
            Number(b.damageQty || 0);
          if (b.isDeadStock) isProductDeadStock = true;
          if (b.isCancelled) isProductCancelled = true;
          if (b.isNil) isProductNil = true;
          if (b.batchNumber) {
            batchByNumber.set(String(b.batchNumber).trim(), b);
          }
        }
        if (isProductDeadStock) {
          isProductCancelled = false;
          isProductNil = false;
        } else if (isProductCancelled) {
          isProductNil = false;
        }

        // A. Purchases (Stock Addition)
        for (let i = 0; i < productPurchases.length; i++) {
          const p = productPurchases[i];
          const pDate = extractDateOnly(p.date);
          if (pDate >= appliedFromDate && pDate <= appliedToDate) {
            const bNum = p.batchNumber ? String(p.batchNumber).trim() : "0";
            const matchingBatch = batchByNumber.get(bNum);
            const desc = p.description || matchingBatch?.description || "";
            const isNil = matchingBatch?.isNil || false;
            const isCancelled = matchingBatch?.isCancelled || false;
            const isDeadStock = matchingBatch?.isDeadStock || false;
            const statusStr = isCancelled
              ? " [Dead Stock]"
              : isNil
                ? " [Not next Folder]"
                : isDeadStock
                  ? " [Nil]"
                  : "";
            transactions.push({
              id: p.id,
              date: p.date,
              type: "Addition",
              qty: Number(p.quantity || 0),
              description: `Purchase (Supplier: ${p.supplierName}, Batch: ${p.batchNumber}${statusStr}${desc ? `, Desc: ${desc}` : ""})`,
              source: "purchase",
              isNil,
              isCancelled,
              isDeadStock,
            });
          }
        }

        // B. Manual Batches / Initial Stock (Stock Addition)
        for (let i = 0; i < productBatches.length; i++) {
          const b = productBatches[i];
          const bDate = extractDateOnly(b.date);
          if (bDate >= appliedFromDate && bDate <= appliedToDate) {
            const bNum = b.batchNumber ? String(b.batchNumber).trim() : "0";
            const hasPurchase = productIndex.purchaseBatchKeys.has(`${normName}:::${bNum}`);
            if (!hasPurchase) {
              const desc = b.description || "";
              const isNil = b.isNil || false;
              const isCancelled = b.isCancelled || false;
              const isDeadStock = b.isDeadStock || false;
              const statusStr = isCancelled
                ? " [Dead Stock]"
                : isNil
                  ? " [Not next Folder]"
                  : isDeadStock
                    ? " [Nil]"
                    : "";
              transactions.push({
                id: b.id,
                date: b.date,
                type: "Addition",
                qty: Number(b.quantity || 0),
                description: `Initial Stock / Manual Entry (Batch: ${b.batchNumber}, Supplier: ${b.supplier}${statusStr}${desc ? `, Desc: ${desc}` : ""})`,
                source: "batch",
                isNil,
                isCancelled,
                isDeadStock,
              });
            }
          }
        }

        // C. Sales Recorded (Stock Subtraction) & Cancellations (Stock Addition)
        for (let i = 0; i < productSales.length; i++) {
          const s = productSales[i];
          const bNum = s.batchNo ? String(s.batchNo).trim() : "";
          const matchingBatch = bNum ? batchByNumber.get(bNum) : productBatches[0];
          const desc =
            s.description || s.remarks || matchingBatch?.description || "";
          const isCancelled =
            s.status === "Cancelled" || matchingBatch?.isCancelled || false;
          const isNil = !isCancelled && (matchingBatch?.isNil || false);
          const isDeadStock = matchingBatch?.isDeadStock || false;
          const orderStatus = isCancelled
            ? "Dead Stock"
            : isNil
              ? "Not next Folder"
              : isDeadStock
                ? "Nil"
                : s.status;

          const sDate = extractDateOnly(
            s.orderDate || s.estimatedDeliveryDate || s.createdAt
          );

          // 1. Record the sale subtraction
          if (sDate >= appliedFromDate && sDate <= appliedToDate) {
            transactions.push({
              id: s.id,
              date: s.orderDate || sDate,
              type: "Subtraction",
              qty: Number(s.orderedQty || 0),
              description: `Sale Recorded (Order: ${s.orderNo}, Customer: ${s.customer}, Batch: ${s.batchNo || "0"}, Status: ${orderStatus}${desc ? `, Desc: ${desc}` : ""})`,
              source: "sale",
              isNil,
              isCancelled,
              isDeadStock,
            });
          }

          // 2. If cancelled, record the cancellation addition
          if (s.status === "Cancelled") {
            const cancelDate = extractDateOnly(s.updatedAt || s.orderDate);
            if (cancelDate >= appliedFromDate && cancelDate <= appliedToDate) {
              transactions.push({
                id: `${s.id}-cancel`,
                date: cancelDate,
                type: "Addition",
                qty: Number(s.orderedQty || 0),
                description: `Sale Cancelled / Restored (Order: ${s.orderNo}, Customer: ${s.customer}, Status: Cancelled${desc ? `, Desc: ${desc}` : ""})`,
                source: "challan_cancel",
                isCancelled: true,
              });
            }
          }
        }

        // D. Sales Returns (Stock Addition)
        for (let i = 0; i < productReturns.length; i++) {
          const r = productReturns[i];
          const rDate = extractDateOnly(r.receiveDate);
          if (rDate >= appliedFromDate && rDate <= appliedToDate) {
            transactions.push({
              id: r.id,
              date: r.receiveDate,
              type: "Addition",
              qty: Number(r.quantity || 0),
              description: `Sales Return (Client: ${r.clientName}, Batch: ${r.batchNo || "N/A"}, Notes: ${r.notes || ""})`,
              source: "sales_return",
            });
          }
        }

        // Sort chronologically
        transactions.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateA - dateB;
        });

        let totalAdditions = 0;
        let totalSubtractions = 0;
        for (let i = 0; i < transactions.length; i++) {
          const t = transactions[i];
          if (t.type === "Addition") {
            totalAdditions += t.qty;
          } else {
            totalSubtractions += t.qty;
          }
        }

        // Format sequence like "2+ 5- 4+"
        const sequence = transactions
          .map((t) => `${t.qty}${t.type === "Addition" ? "+" : "-"}`)
          .join(" ");

        const stockSnap = computeClosingStockForProductIndexed({
          normName,
          targetDate: appliedToDate,
          index: productIndex,
        });

        const details = transactions
          .map(
            (t) =>
              `[${t.date}] ${t.qty}${t.type === "Addition" ? "+" : "-"} (${t.description})`,
          )
          .join("; ");

        return {
          productName,
          category,
          isDeadStock: isProductDeadStock,
          isNil: isProductNil,
          isCancelled: isProductCancelled,
          currentAvailable,
          closingStockAtEnd: stockSnap.closingTotalStock,
          closingAvailableAtEnd: stockSnap.closingAvailableQty,
          totalAdditions,
          totalSubtractions,
          netChange: totalAdditions - totalSubtractions,
          sequence: sequence || "-",
          details: details || "No transactions in range",
          transactions,
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }, [
    productIndex,
    appliedFromDate,
    appliedToDate,
  ]);

  // List of all categories available in the system
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    CATEGORIES.forEach((c) => cats.add(c));
    productIndex.productCategories.forEach((cat) => {
      if (cat?.trim()) cats.add(cat.trim());
    });
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [productIndex]);

  // Comprehensive Category Report Data: Computes Opening, Sold, Purchased, Closing Available, Hold, Display, Damaged, Closing Total for each product
  const categoryReportData = useMemo(() => {
    return computeStockSnapshotsHelper({
      allBatches,
      allPurchases,
      allSales,
      allSalesReturns,
      startDate: categoryStartDate,
      endDate: categoryEndDate,
      categoryFilter: selectedCategory,
      index: productIndex,
    });
  }, [
    productIndex,
    selectedCategory,
    categoryStartDate,
    categoryEndDate,
  ]);

  const filteredCategoryProducts = useMemo(() => {
    if (!categorySearch.trim()) return categoryReportData.products;
    const q = categorySearch.toLowerCase().trim();
    return categoryReportData.products.filter(
      (p) =>
        p.productName.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
  }, [categoryReportData.products, categorySearch]);

  const handleExportCategorySummary = () => {
    const { products, totals } = categoryReportData;
    if (products.length === 0) {
      toast({
        title: "No Data Found",
        description:
          selectedCategory !== "all"
            ? `No products found for category "${selectedCategory}" within ${formatDateDDMMYYYY(categoryStartDate)} to ${formatDateDDMMYYYY(categoryEndDate)}.`
            : `No products found within ${formatDateDDMMYYYY(categoryStartDate)} to ${formatDateDDMMYYYY(categoryEndDate)}.`,
        variant: "destructive",
      });
      return;
    }

    const catLabel =
      selectedCategory !== "all" ? selectedCategory : "All Categories";
    const isSingleDay = categoryStartDate === categoryEndDate;
    const periodLabel = isSingleDay
      ? `${formatDateDDMMYYYY(categoryStartDate)} (Closing Stock of Date)`
      : `${formatDateDDMMYYYY(categoryStartDate)} to ${formatDateDDMMYYYY(categoryEndDate)}`;
    const rows: string[] = [];

    // Title and Meta Information
    rows.push(`Category Stock Summary: ${catLabel},,,,,,,,,,,`);
    rows.push(
      `Period: ${periodLabel},Generated On: ${formatDateDDMMYYYY(getLocalDateString())},,,,,,,,,,`,
    );
    rows.push(
      `SUMMARY TOTALS: Opening Stock: ${totals.opening},Total Purchased: ${totals.purchased},Total Sold: ${totals.sold},Closing Available Stock: ${totals.available},Hold Qty: ${totals.hold},Display Qty: ${totals.display},Damage Qty: ${totals.damage},Total Closing Stock: ${totals.totalStock},,,,,`,
    );
    rows.push(``);

    // CSV Headers
    rows.push(
      `Product Name,Category,Opening Stock,Purchased Qty (Period),Sold Qty (Period),Closing Available Qty,Hold Qty,Display Qty,Damage Qty,Total Closing Stock,Status,Supplier,Batches,Description`,
    );

    // Data rows
    products.forEach((p) => {
      const cleanName = p.productName.replace(/"/g, '""');
      const cleanCat = p.category.replace(/"/g, '""');
      const cleanSupplier = (p.supplier || "").replace(/"/g, '""');
      const batchList = Array.from(p.batchNumbers)
        .join("; ")
        .replace(/"/g, '""');
      const desc = (p.description || "").replace(/"/g, '""');

      rows.push(
        `"${cleanName}","${cleanCat}","${p.openingStock}","${p.purchasedQty}","${p.soldQty}","${p.availableQty}","${p.holdQty}","${p.displayQty}","${p.damageQty}","${p.totalStock}","${p.status}","${cleanSupplier}","${batchList}","${desc}"`,
      );
    });

    // Summary Footer Row
    rows.push(``);
    rows.push(
      `"TOTALS","${catLabel}","${totals.opening}","${totals.purchased}","${totals.sold}","${totals.available}","${totals.hold}","${totals.display}","${totals.damage}","${totals.totalStock}","","","",""`,
    );

    const csvContent = rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const catSlug =
      selectedCategory !== "all"
        ? selectedCategory.replace(/[^a-zA-Z0-9_-]/g, "_")
        : "All_Categories";
    a.download = isSingleDay
      ? `category-closing-stock-${catSlug}-${categoryStartDate}.csv`
      : `category-closing-stock-${catSlug}-${categoryStartDate}-to-${categoryEndDate}.csv`;
    a.click();

    toast({
      title: "Export Successful",
      description: `Downloaded ${products.length} product records with closing stock for ${catLabel}.`,
    });
  };

  // Filtered ledger data for live category & search preview
  const filteredLedger = useMemo(() => {
    let list = ledgerData;
    if (selectedCategory && selectedCategory !== "all") {
      list = list.filter(
        (item) =>
          item.category?.toLowerCase().trim() ===
          selectedCategory.toLowerCase().trim(),
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((item) => item.productName.toLowerCase().includes(q));
    }
    return list;
  }, [ledgerData, selectedCategory, searchQuery]);

  // Find the selected product's calculated details live so modal stays synced after deletes
  const selectedProductLedger = useMemo(() => {
    if (!activeLedgerProduct) return null;
    return (
      ledgerData.find((item) => item.productName === activeLedgerProduct) ||
      null
    );
  }, [ledgerData, activeLedgerProduct]);

  const handleExportLedger = () => {
    if (!filteredLedger.length) {
      alert("No data available to export.");
      return;
    }
    const formatted = filteredLedger.map((item) => ({
      "Product Name": item.productName,
      Category: item.category,
      "Is Not next Folder": item.isNil ? "Yes" : "No",
      "Is Dead Stock": item.isCancelled ? "Yes" : "No",
      "Is Nil": item.isDeadStock ? "Yes" : "No",
      Status: item.isDeadStock
        ? "Nil"
        : item.isCancelled
          ? "Dead Stock"
          : item.isNil
            ? "Not next Folder"
            : "Active",
      [`Closing Stock (as of ${formatDateDDMMYYYY(appliedToDate)})`]:
        item.closingStockAtEnd,
      "Current Physical Stock": item.currentAvailable,
      "Total Additions (+)": item.totalAdditions,
      "Total Subtractions (-)": item.totalSubtractions,
      "Net Change": item.netChange,
      "Transaction Sequence": item.sequence,
      "Detailed History": item.details,
    }));
    exportCSV(
      formatted as any[],
      `stock-ledger-totals-${appliedFromDate}-to-${appliedToDate}.csv`,
    );
  };

  // Revert and delete a single transaction from the ledger
  const handleDeleteTransaction = async (t: LedgerTransaction) => {
    const password = window.prompt(
      "Please enter admin password to delete this transaction:",
    );
    if (password !== "admin") {
      if (password !== null)
        toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }

    const typeStr =
      t.type === "Addition" ? "Stock Addition" : "Stock Subtraction";
    const formattedDate = formatDateDDMMYYYY(t.date);
    if (
      window.confirm(
        `Are you sure you want to delete this transaction?\n[${formattedDate}] - ${typeStr}: ${t.qty} units\nDescription: "${t.description}"\n\nThis will permanently update/revert stock values.`,
      )
    ) {
      try {
        if (t.source === "purchase") {
          await deletePurchase(t.id);
        } else if (t.source === "sale") {
          await deleteSale(t.id);
        } else if (t.source === "batch") {
          await deleteBatch(t.id);
        }

        toast({
          title: "Transaction Deleted",
          description:
            "The transaction record has been removed and stock reverted.",
        });
        await loadLedgerData();
      } catch (err: any) {
        toast({
          title: "Failed to Delete",
          description: err.message,
          variant: "destructive",
        });
      }
    }
  };

  const exports = [
    {
      key: "sales",
      title: "Daily Sales",
      desc: "Export all sales for the selected date",
    },
    {
      key: "purchases",
      title: "Daily Purchases",
      desc: "Export all purchases for the selected date",
    },
    {
      key: "stock",
      title: "Daily Stock Updates",
      desc: "Export stock entries for the selected date",
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-2 sm:px-4 pb-12">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Daily Export & Category Summary
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Export daily sales, purchases, stock updates, or generate complete
            category inventory reports.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={loadLedgerData}
          disabled={isLoading}
          title="Reload Data"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card className="border border-slate-200/80 shadow-sm">
        <CardContent className="pt-6 space-y-5">
          {/* Top Filter Controls: Date, Category, Period Selection */}
          <div className="flex flex-wrap items-end gap-3 sm:gap-4 p-4 bg-slate-50/80 border rounded-xl">
            <div className="w-full sm:w-48 space-y-1.5">
              <Label className="font-semibold text-slate-800 text-xs">
                Select Date
              </Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-white h-9"
              />
            </div>

            <div className="w-full sm:w-56 space-y-1.5">
              <Label className="font-semibold text-slate-800 text-xs">
                Select Category
              </Label>
              <Select
                value={selectedCategory}
                onValueChange={setSelectedCategory}
              >
                <SelectTrigger className="bg-white h-9">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {allCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[220px] space-y-1.5">
              <Label className="font-semibold text-slate-800 text-xs">
                Category Calculation Period
              </Label>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  type="button"
                  variant={periodMode === "singleDate" ? "default" : "outline"}
                  size="sm"
                  className={`h-9 text-xs px-3.5 font-semibold transition-colors ${
                    periodMode === "singleDate"
                      ? "bg-blue-600 text-white hover:bg-blue-700 shadow-xs"
                      : "bg-white hover:bg-slate-100 text-slate-700"
                  }`}
                  onClick={() => setPeriodMode("singleDate")}
                >
                  Single Date Only (24 Hrs)
                </Button>
                <Button
                  type="button"
                  variant={periodMode === "custom" ? "default" : "outline"}
                  size="sm"
                  className={`h-9 text-xs px-3.5 font-semibold transition-colors ${
                    periodMode === "custom"
                      ? "bg-blue-600 text-white hover:bg-blue-700 shadow-xs"
                      : "bg-white hover:bg-slate-100 text-slate-700"
                  }`}
                  onClick={() => setPeriodMode("custom")}
                >
                  Custom Range
                </Button>
              </div>
            </div>

            {periodMode === "custom" && (
              <div className="flex items-end gap-2 w-full sm:w-auto pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500 font-medium">
                    From Date
                  </Label>
                  <Input
                    type="date"
                    value={customFromDate}
                    onChange={(e) => setCustomFromDate(e.target.value)}
                    className="h-9 text-xs bg-white w-36"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500 font-medium">
                    To Date
                  </Label>
                  <Input
                    type="date"
                    value={customToDate}
                    onChange={(e) => setCustomToDate(e.target.value)}
                    className="h-9 text-xs bg-white w-36"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 4 Export Action Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* 1. Daily Sales */}
            <Card className="bg-slate-50/50 border-slate-200 hover:border-slate-300 transition-all flex flex-col justify-between">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center justify-between">
                  <span>Daily Sales</span>
                  {selectedCategory !== "all" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold text-blue-700 bg-blue-50 border-blue-200"
                    >
                      {selectedCategory}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground mb-3">
                  {selectedCategory !== "all"
                    ? `Export sales of ${selectedCategory} for ${formatDateDDMMYYYY(date)}`
                    : `Export all sales for ${formatDateDDMMYYYY(date)}`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => doExport("sales")}
                  className="w-full"
                >
                  <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
              </CardContent>
            </Card>

            {/* 2. Daily Purchases */}
            <Card className="bg-slate-50/50 border-slate-200 hover:border-slate-300 transition-all flex flex-col justify-between">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center justify-between">
                  <span>Daily Purchases</span>
                  {selectedCategory !== "all" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold text-purple-700 bg-purple-50 border-purple-200"
                    >
                      {selectedCategory}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground mb-3">
                  {selectedCategory !== "all"
                    ? `Export purchases of ${selectedCategory} for ${formatDateDDMMYYYY(date)}`
                    : `Export all purchases for ${formatDateDDMMYYYY(date)}`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => doExport("purchases")}
                  className="w-full"
                >
                  <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
              </CardContent>
            </Card>

            {/* 3. Daily Stock Updates / Closing Stock */}
            <Card className="bg-slate-50/50 border-slate-200 hover:border-slate-300 transition-all flex flex-col justify-between">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center justify-between">
                  <span>Daily Closing Stock</span>
                  {selectedCategory !== "all" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border-emerald-200"
                    >
                      {selectedCategory}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground mb-3">
                  {selectedCategory !== "all"
                    ? `Export closing stock of ${selectedCategory} for ${formatDateDDMMYYYY(date)}`
                    : `Export closing stock for ${formatDateDDMMYYYY(date)}`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => doExport("stock")}
                  className="w-full"
                >
                  <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
              </CardContent>
            </Card>

            {/* 4. Complete Category Summary Report */}
            <Card className="bg-gradient-to-br from-blue-50/70 via-indigo-50/40 to-white border-2 border-blue-300/80 shadow-xs hover:shadow-sm transition-all flex flex-col justify-between">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-blue-900 flex items-center justify-between">
                  <span>Category Summary</span>
                  <Badge className="bg-blue-600 hover:bg-blue-600 text-[10px] text-white font-bold">
                    Full Report
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-slate-600 mb-3">
                  {periodMode === "singleDate"
                    ? `Complete Opening, Sold, Purchased & Closing stock statement for ${selectedCategory !== "all" ? selectedCategory : "all categories"} on ${formatDateDDMMYYYY(categoryStartDate)} (Closing Stock of Date).`
                    : `Complete Opening, Sold, Purchased & Closing stock statement for ${selectedCategory !== "all" ? selectedCategory : "all categories"} (${formatDateDDMMYYYY(categoryStartDate)} to ${formatDateDDMMYYYY(categoryEndDate)}).`}
                </p>
                <Button
                  size="sm"
                  onClick={handleExportCategorySummary}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs"
                >
                  <Download className="mr-2 h-4 w-4" /> Export Category CSV
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Live Category Summary Banner */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 pb-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-700">
                  Category Overview:
                </span>
                <Badge
                  variant="outline"
                  className="font-bold text-xs bg-white text-blue-800 border-blue-300 shadow-2xs"
                >
                  {selectedCategory !== "all"
                    ? selectedCategory
                    : "All Categories"}
                </Badge>
                <span className="text-xs text-slate-500 font-medium">
                  (
                  {categoryStartDate === categoryEndDate
                    ? `${formatDateDDMMYYYY(categoryStartDate)} • Closing Stock`
                    : `${formatDateDDMMYYYY(categoryStartDate)} to ${formatDateDDMMYYYY(categoryEndDate)}`}
                  )
                </span>
                <span className="text-xs text-slate-400">
                  • {categoryReportData.products.length} products found
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCategoryPreview(!showCategoryPreview)}
                  className="h-7 text-xs text-blue-700 hover:bg-blue-100/60 font-semibold"
                >
                  {showCategoryPreview ? (
                    <>
                      <ChevronUp className="mr-1 h-3.5 w-3.5" /> Hide Products
                    </>
                  ) : (
                    <>
                      <ChevronDown className="mr-1 h-3.5 w-3.5" /> View Products
                      ({categoryReportData.products.length})
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={handleExportCategorySummary}
                  className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-3"
                >
                  <Download className="mr-1 h-3.5 w-3.5" /> Download CSV
                </Button>
              </div>
            </div>

            {/* Stat metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 pt-1">
              <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-600">
                  Opening Stock
                </div>
                <div className="text-lg font-bold text-slate-900 font-mono">
                  {categoryReportData.totals.opening.toLocaleString()}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-white border border-purple-100 shadow-2xs">
                <div className="text-[11px] font-medium text-purple-600">
                  Total Purchased
                </div>
                <div className="text-lg font-bold text-purple-900 font-mono">
                  {categoryReportData.totals.purchased.toLocaleString()}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-white border border-blue-100 shadow-2xs">
                <div className="text-[11px] font-medium text-blue-600">
                  Total Sold
                </div>
                <div className="text-lg font-bold text-blue-900 font-mono">
                  {categoryReportData.totals.sold.toLocaleString()}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-white border border-emerald-100 shadow-2xs">
                <div className="text-[11px] font-medium text-emerald-600">
                  Closing Available
                </div>
                <div className="text-lg font-bold text-emerald-900 font-mono">
                  {categoryReportData.totals.available.toLocaleString()}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-white border border-amber-100 shadow-2xs">
                <div className="text-[11px] font-medium text-amber-600">
                  Total Hold
                </div>
                <div className="text-lg font-bold text-amber-900 font-mono">
                  {categoryReportData.totals.hold.toLocaleString()}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-white border border-indigo-100 shadow-2xs">
                <div className="text-[11px] font-medium text-indigo-600">
                  Total Display
                </div>
                <div className="text-lg font-bold text-indigo-900 font-mono">
                  {categoryReportData.totals.display.toLocaleString()}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-white border border-rose-100 shadow-2xs">
                <div className="text-[11px] font-medium text-rose-600">
                  Total Damaged
                </div>
                <div className="text-lg font-bold text-rose-900 font-mono">
                  {categoryReportData.totals.damage.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Optional Collapsible Products Table Preview */}
            {showCategoryPreview && (
              <div className="border rounded-lg bg-white mt-3 overflow-hidden shadow-2xs">
                <div className="p-2 bg-slate-50 border-b flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">
                    Product List Breakdown:
                  </span>
                  <div className="relative w-48">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search in category..."
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                      className="h-7 text-xs pl-7 bg-white"
                    />
                  </div>
                </div>
                <div className="max-h-[260px] overflow-y-auto">
                  <Table>
                    <TableHeader className="bg-slate-50/80 sticky top-0 z-10 text-[11px]">
                      <TableRow>
                        <TableHead>Product Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Opening</TableHead>
                        <TableHead className="text-right">
                          Purchased (+)
                        </TableHead>
                        <TableHead className="text-right">Sold (-)</TableHead>
                        <TableHead className="text-right font-bold text-emerald-700">
                          Closing Available
                        </TableHead>
                        <TableHead className="text-right">Hold</TableHead>
                        <TableHead className="text-right">Display</TableHead>
                        <TableHead className="text-right">Damaged</TableHead>
                        <TableHead className="text-right font-bold">
                          Total Closing Stock
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      {filteredCategoryProducts.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={10}
                            className="text-center text-muted-foreground py-6"
                          >
                            No products found in this category.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredCategoryProducts.map((p) => (
                          <TableRow
                            key={p.productName}
                            className="hover:bg-slate-50/80"
                          >
                            <TableCell className="font-semibold text-slate-800">
                              {p.productName}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-[11px]">
                              {p.category}
                            </TableCell>
                            <TableCell className="text-right font-mono text-slate-600">
                              {p.openingStock}
                            </TableCell>
                            <TableCell className="text-right font-mono text-purple-700">
                              {p.purchasedQty > 0 ? `+${p.purchasedQty}` : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-blue-700">
                              {p.soldQty > 0 ? `-${p.soldQty}` : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold text-emerald-700">
                              {p.availableQty}
                            </TableCell>
                            <TableCell className="text-right font-mono text-amber-700">
                              {p.holdQty || "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-indigo-700">
                              {p.displayQty || "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-rose-700">
                              {p.damageQty || "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold text-slate-900">
                              {p.totalStock}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="border-t my-6" />

      {/* Date Range Stock Ledger & Totals Section */}
      <Card className="border-2 border-primary/20 shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <Layers className="h-5 w-5" />
            <CardTitle>Date Range Stock Ledger & Totals</CardTitle>
          </div>
          <CardDescription>
            Compute chronological additions (+), subtractions (-), net changes,
            and current available stocks for all products within a custom date
            range. Enter Start Date & End Date, then click{" "}
            <strong>Filter</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-end gap-4 p-4 bg-muted/30 rounded-lg border">
            <div className="space-y-1.5 flex-1 min-w-[140px]">
              <Label className="font-semibold text-slate-800">From Date</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[140px]">
              <Label className="font-semibold text-slate-800">To Date</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <Button
              onClick={handleApplyLedgerFilter}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 shadow-sm gap-2"
            >
              <Filter className="h-4 w-4" /> Filter
            </Button>
            <div className="space-y-1.5 flex-1 min-w-[180px]">
              <Label className="font-semibold text-slate-800">Category</Label>
              <Select
                value={selectedCategory}
                onValueChange={setSelectedCategory}
              >
                <SelectTrigger className="w-full bg-white">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {allCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 flex-1 min-w-[180px] relative">
              <Label className="font-semibold text-slate-800">
                Search Product
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={
                    selectedCategory && selectedCategory !== "all"
                      ? `Search product in ${selectedCategory}...`
                      : "Search product..."
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 bg-white"
                />
              </div>
            </div>
            <Button
              onClick={handleExportLedger}
              className="w-full sm:w-auto bg-primary hover:bg-primary/95 text-primary-foreground font-semibold shadow-sm"
            >
              <Download className="mr-2 h-4 w-4" /> Export Ledger Totals
            </Button>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>
              Showing Stock Ledger from:{" "}
              <strong className="text-slate-900 font-mono">
                {appliedFromDate}
              </strong>{" "}
              to{" "}
              <strong className="text-slate-900 font-mono">
                {appliedToDate}
              </strong>
            </span>
            {(appliedFromDate !== fromDate || appliedToDate !== toDate) && (
              <span className="text-amber-700 font-semibold animate-pulse">
                ⚠️ Click "Filter" to apply selected dates
              </span>
            )}
          </div>

          {/* Interactive Preview Table */}
          <div className="border rounded-md">
            <div className="max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-center font-bold">
                      Stock Sequence
                    </TableHead>
                    <TableHead className="text-right text-success-700">
                      Add (+)
                    </TableHead>
                    <TableHead className="text-right text-destructive-700">
                      Sub (-)
                    </TableHead>
                    <TableHead className="text-right">Net Change</TableHead>
                    <TableHead className="text-right font-black">
                      Closing Stock ({formatDateDDMMYYYY(appliedToDate)})
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center text-muted-foreground py-8"
                      >
                        Loading transaction data...
                      </TableCell>
                    </TableRow>
                  ) : filteredLedger.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center text-muted-foreground py-8"
                      >
                        No product matches found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLedger.map((item) => (
                      <TableRow
                        key={item.productName}
                        className={`transition-colors ${
                          item.isDeadStock
                            ? "bg-slate-400/90 text-slate-900 hover:bg-slate-500/90 border-slate-300"
                            : item.isCancelled
                              ? "bg-red-200/90 text-red-950 hover:bg-red-300/90 border-red-300"
                              : item.isNil
                                ? "bg-blue-200/90 text-blue-950 hover:bg-blue-300/90 border-blue-300"
                                : "hover:bg-slate-50/50"
                        }`}
                      >
                        <TableCell
                          className={`font-semibold ${item.isCancelled ? "text-red-950" : item.isNil ? "text-blue-950" : "text-slate-800"}`}
                        >
                          <div className="flex items-center gap-2">
                            <span>{item.productName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.category}
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className="font-mono text-xs px-2 py-1 rounded border inline-block max-w-[150px] truncate bg-slate-100 border-slate-200 text-slate-700"
                            title={item.sequence}
                          >
                            {item.sequence}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium font-mono text-green-600">
                          +{item.totalAdditions}
                        </TableCell>
                        <TableCell className="text-right font-medium font-mono text-red-600">
                          -{item.totalSubtractions}
                        </TableCell>
                        <TableCell
                          className={`text-right font-bold font-mono ${item.netChange > 0 ? "text-green-600" : item.netChange < 0 ? "text-red-600" : "text-slate-600"}`}
                        >
                          {item.netChange > 0
                            ? `+${item.netChange}`
                            : item.netChange}
                        </TableCell>
                        <TableCell className="text-right font-black font-mono text-sm bg-blue-50/50 text-blue-700">
                          {item.closingStockAtEnd}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-primary hover:bg-primary/10 gap-1"
                            onClick={() =>
                              setActiveLedgerProduct(item.productName)
                            }
                          >
                            <Eye className="h-4 w-4" /> View / Clean
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="p-2.5 bg-muted/20 text-xs text-muted-foreground border-t text-right">
              Showing {filteredLedger.length} of {ledgerData.length} unique
              products
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transaction History & Cleaning Dialog */}
      <Dialog
        open={!!activeLedgerProduct}
        onOpenChange={(open) => !open && setActiveLedgerProduct(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Transaction Ledger: {selectedProductLedger?.productName}
            </DialogTitle>
            <DialogDescription>
              Chronological log of transactions in the selected date range.
              Revert incorrect entries securely using the red delete buttons.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-muted/50 p-2.5 rounded border">
              <div>
                <span className="font-bold">Total Additions:</span>{" "}
                <span className="font-mono text-green-600 font-bold">
                  +{selectedProductLedger?.totalAdditions}
                </span>
              </div>
              <div>
                <span className="font-bold">Total Subtractions:</span>{" "}
                <span className="font-mono text-red-600 font-bold">
                  -{selectedProductLedger?.totalSubtractions}
                </span>
              </div>
              <div>
                <span className="font-bold">
                  Closing Stock ({formatDateDDMMYYYY(appliedToDate)}):
                </span>{" "}
                <span className="font-mono text-blue-700 font-bold">
                  {selectedProductLedger?.closingStockAtEnd}
                </span>
              </div>
              <div>
                <span className="font-bold">Current Physical Stock:</span>{" "}
                <span className="font-mono text-slate-700 font-bold">
                  {selectedProductLedger?.currentAvailable}
                </span>
              </div>
            </div>

            <div className="border rounded-md max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader className="bg-muted/30 sticky top-0">
                  <TableRow>
                    <TableHead className="w-28 whitespace-nowrap">
                      Date
                    </TableHead>
                    <TableHead className="w-24 text-center">Change</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right w-16">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!selectedProductLedger?.transactions.length ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center text-muted-foreground py-6"
                      >
                        No transactions found inside this date range
                      </TableCell>
                    </TableRow>
                  ) : (
                    selectedProductLedger.transactions.map((t) => {
                      const isCanc =
                        t.isCancelled ||
                        t.description.includes("[Dead Stock]") ||
                        t.description.includes("Status: Dead Stock");
                      const isNilItem =
                        t.isNil ||
                        t.description.includes("[Not next Folder]") ||
                        t.description.includes("Status: Not next Folder");
                      const isDeadItem =
                        t.isDeadStock ||
                        t.description.includes("[Nil]") ||
                        t.description.includes("Status: Nil");
                      return (
                        <TableRow
                          key={t.id}
                          className={`transition-colors ${
                            isCanc
                              ? "bg-red-50/80 hover:bg-red-100/80"
                              : isNilItem
                                ? "bg-blue-50/80 hover:bg-blue-100/80"
                                : isDeadItem
                                  ? "bg-slate-100/80 hover:bg-slate-200/80"
                                  : "hover:bg-muted/10"
                          }`}
                        >
                          <TableCell className="text-xs font-medium font-mono whitespace-nowrap">
                            {formatDateDDMMYYYY(t.date)}
                          </TableCell>
                          <TableCell className="text-center font-mono font-bold">
                            <span
                              className={`px-2 py-0.5 rounded text-xs ${t.type === "Addition" ? "bg-green-100 text-green-700 border border-green-200" : "bg-red-100 text-red-700 border border-red-200"}`}
                            >
                              {t.type === "Addition"
                                ? `+${t.qty}`
                                : `-${t.qty}`}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs leading-snug">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isCanc && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-800 border border-red-200">
                                  Dead Stock
                                </span>
                              )}
                              {isNilItem && !isCanc && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-800 border border-blue-200">
                                  Not next Folder
                                </span>
                              )}
                              {isDeadItem && !isCanc && !isNilItem && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-200 text-slate-800 border border-slate-300">
                                  Nil
                                </span>
                              )}
                              <span
                                className={
                                  isCanc
                                    ? "text-red-950 font-medium"
                                    : isNilItem
                                      ? "text-blue-950 font-medium"
                                      : isDeadItem
                                        ? "text-slate-900 font-medium"
                                        : "text-slate-700"
                                }
                              >
                                {t.description}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {t.source === "purchase" || t.source === "batch" ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-red-700 hover:bg-red-50"
                                onClick={() => handleDeleteTransaction(t)}
                                title="Delete Transaction & Revert Stock"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic px-2">
                                System-locked
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
