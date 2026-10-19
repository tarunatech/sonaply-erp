import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getChallans, getSales, exportCSV, Challan, Sale, formatLocalDate, getLocalDateString } from "@/lib/store";
import { format } from "date-fns";
import { printElement } from "@/lib/print";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Printer, Search, Pencil } from "lucide-react";

const renderCustomer = (customerName: string) => {
  const match = customerName.match(/(.*?)\s*\(([^)]+)\)$/);
  if (match) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold text-slate-900 leading-tight">{match[1]}</span>
        <span className="text-[11px] text-slate-500 font-medium leading-none mt-0.5">({match[2]})</span>
      </div>
    );
  }
  return <span className="font-semibold text-slate-900 leading-tight">{customerName}</span>;
};

export default function DeliveredDeliveries() {
  const navigate = useNavigate();
  const [challans, setChallans] = useState<Challan[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [filter, setFilter] = useState("");

  const [page, setPage] = useState(1);
  const pageSize = 25;

  const refresh = useCallback(async () => {
    const [c, s] = await Promise.all([getChallans(), getSales()]);
    // Only include non-cancelled Delivered challans with quantity > 0
    setChallans(c.filter(challan => challan.status === "Delivered" && !challan.isCancelled && Number(challan.quantity) > 0));
    setSales(s);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const salesMap = useMemo(() => {
    const map = new Map<string, Sale>();
    for (let i = 0; i < sales.length; i++) {
      map.set(sales[i].id, sales[i]);
    }
    return map;
  }, [sales]);

  const filteredChallans = useMemo(() => {
    const sorted = [...challans].sort((a, b) => {
      const saleA = salesMap.get(a.salesId);
      const saleB = salesMap.get(b.salesId);
      const dateA = a.deliveredAt || a.deliveryDate || saleA?.deliveredAt || saleA?.updatedAt || a.createdAt || "";
      const dateB = b.deliveredAt || b.deliveryDate || saleB?.deliveredAt || saleB?.updatedAt || b.createdAt || "";
      const dateCompare = String(dateB).localeCompare(String(dateA));
      if (dateCompare !== 0) return dateCompare;
      return (b.challanNo || '').localeCompare(a.challanNo || '', undefined, { numeric: true, sensitivity: "base" });
    });
    if (!filter) return sorted;
    const f = filter.toLowerCase().trim();
    return sorted.filter(c => {
      const sale = salesMap.get(c.salesId);
      const orderNo = sale?.orderNo || "";
      const billNo = c.billNo || "";
      const delDateStr = c.deliveryDate || (c.deliveredAt ? String(c.deliveredAt).slice(0, 10) : "");
      const formattedDelDate = delDateStr ? formatLocalDate(delDateStr) : "";
      const challanDateStr = c.createdAt ? String(c.createdAt).slice(0, 10) : "";
      const formattedChallanDate = challanDateStr ? formatLocalDate(challanDateStr) : "";

      return (c.customer || '').toLowerCase().includes(f) ||
             (c.product || '').toLowerCase().includes(f) ||
             (c.challanNo || '').toLowerCase().includes(f) ||
             billNo.toLowerCase().includes(f) ||
             orderNo.toLowerCase().includes(f) ||
             delDateStr.toLowerCase().includes(f) ||
             formattedDelDate.toLowerCase().includes(f) ||
             challanDateStr.toLowerCase().includes(f) ||
             formattedChallanDate.toLowerCase().includes(f);
    });
  }, [challans, salesMap, filter]);

  const groupedChallans = useMemo(() => {
    const groups: Record<string, Challan[]> = {};
    filteredChallans.forEach((c) => {
      if (Number(c.quantity) <= 0) return;
      if (!groups[c.challanNo]) groups[c.challanNo] = [];
      groups[c.challanNo].push(c);
    });
    return Object.entries(groups)
      .filter(([_, items]) => items.length > 0)
      .map(([challanNo, items]) => {
        const itemWithDeliveryDate = items.find((i) => i.deliveryDate);
        const itemWithDeliveredAt = items.find((i) => i.deliveredAt);
        const relatedSale = salesMap.get(items[0].salesId);

        const rawDeliveredAt = itemWithDeliveredAt?.deliveredAt || relatedSale?.deliveredAt || items[0].updatedAt || items[0].createdAt;
        const rawDeliveryDate = itemWithDeliveryDate?.deliveryDate || (rawDeliveredAt ? String(rawDeliveredAt).slice(0, 10) : undefined);

        return {
          challanNo,
          customer: items[0].customer,
          clientPhone: items[0].clientPhone,
          createdAt: items[0].createdAt,
          deliveryDate: rawDeliveryDate,
          deliveredAt: rawDeliveredAt,
          billNo: items.find((i) => i.billNo)?.billNo || "",
          items: items,
          salesId: items[0].salesId,
        };
      })
      .sort((a, b) => {
        const getGroupLatestTime = (group: typeof a) => {
          let maxTime = 0;
          const candidateDates = [
            group.deliveredAt,
            group.deliveryDate,
            group.createdAt,
          ];
          for (const item of group.items) {
            if (item.deliveredAt) candidateDates.push(item.deliveredAt);
            if (item.deliveryDate) candidateDates.push(item.deliveryDate);
            if (item.updatedAt) candidateDates.push(item.updatedAt);
            if (item.createdAt) candidateDates.push(item.createdAt);
          }
          for (const d of candidateDates) {
            if (d) {
              const t = new Date(d).getTime();
              if (!isNaN(t) && t > maxTime) maxTime = t;
            }
          }
          return maxTime;
        };

        const timeA = getGroupLatestTime(a);
        const timeB = getGroupLatestTime(b);
        if (timeA !== timeB) return timeB - timeA;
        return b.challanNo.localeCompare(a.challanNo, undefined, { numeric: true, sensitivity: "base" });
      });
  }, [filteredChallans, salesMap]);

  const totalPages = Math.max(1, Math.ceil(groupedChallans.length / pageSize));

  const paginatedGroupedChallans = useMemo(() => {
    const start = (page - 1) * pageSize;
    return groupedChallans.slice(start, start + pageSize);
  }, [groupedChallans, page, pageSize]);

  const handleExportCSV = () => {
    const exportData = filteredChallans.map((c) => {
      const sale = salesMap.get(c.salesId);
      const delDate = c.deliveryDate || (c.deliveredAt ? String(c.deliveredAt).slice(0, 10) : (c.updatedAt ? String(c.updatedAt).slice(0, 10) : String(c.createdAt).slice(0, 10)));
      return {
        "Challan No": c.challanNo,
        "Bill No": c.billNo || "",
        "Order No": sale?.orderNo || "",
        "Delivered Date": formatLocalDate(delDate),
        "Challan Date": formatLocalDate(c.createdAt),
        "Customer": c.customer,
        "Phone": c.clientPhone || "",
        "Product": c.product,
        "Batch No": c.batchNo || "0",
        "Quantity": c.quantity,
        "Stock Category": c.stockCategory || "Available",
        "Status": c.status,
        "Narration": c.notes || sale?.remarks || "",
      };
    });
    exportCSV(exportData, `delivered-orders-${getLocalDateString()}.csv`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-green-600">Delivered Orders</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customer, product or challan/order #..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCSV}><Download className="mr-1 h-4 w-4" />Export</Button>
          <Button variant="outline" size="sm" onClick={() => printElement("delivered-table")}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0" id="delivered-table">
          <Table className="border-collapse border-2 border-slate-300 w-full" wrapperClassName="max-h-[calc(100vh-130px)]">
            <TableHeader className="sticky top-0 bg-slate-100 z-10 shadow-2xs border-b-2 border-slate-300">
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Delivered / Challan Date</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Challan / Bill No</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Client</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 w-2/5">Items / Quantities</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3">Status</TableHead>
                <TableHead className="border-2 border-slate-300 text-xs font-bold text-slate-600 px-4 py-3 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
              <TableBody>
                {paginatedGroupedChallans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="border-2 border-slate-300 text-center text-muted-foreground py-8">
                      No delivered orders found.
                    </TableCell>
                  </TableRow>
                ) : paginatedGroupedChallans.map(group => {
                  return (
                    <TableRow key={group.challanNo} className="hover:bg-slate-50/40">
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm text-slate-700 font-medium whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded shadow-2xs">
                              Delivered
                            </span>
                            <span className="font-semibold text-slate-900">
                              {formatLocalDate(group.deliveryDate || group.deliveredAt || group.createdAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <span className="text-[10px] font-medium text-slate-400">Challan:</span>
                            <span>{formatLocalDate(group.createdAt)}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 font-medium">
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 w-fit">
                            {group.challanNo}
                          </span>
                          {group.billNo && (
                            <span className="font-mono text-[10px] font-bold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 w-fit">
                              Bill: {group.billNo}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-sm min-w-[150px] max-w-[220px] break-words">
                        {renderCustomer(group.customer)}
                        <div className="text-[10px] text-muted-foreground mt-1">{group.clientPhone}</div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3">
                        <div className="text-sm space-y-2">
                          {group.items.map((item: any, idx: number) => {
                            return (
                              <div key={idx} className="border-b border-slate-100 last:border-0 pb-2 last:pb-0">
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-semibold text-slate-900">{item.product}</span>
                                    {item.batchNo && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                        Batch: {item.batchNo}
                                      </span>
                                    )}
                                    {item.stockCategory && (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                        item.stockCategory === 'Display' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                                        item.stockCategory === 'Damage' ? 'bg-red-50 text-red-800 border border-red-200' :
                                        'bg-blue-50 text-blue-800 border border-blue-200'
                                      }`}>
                                        {item.stockCategory}
                                      </span>
                                    )}
                                  </div>
 
                                  <span className="font-bold text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200">
                                    {item.quantity} Qty
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          {/* Show group-level narration one time only */}
                          {(() => {
                            const firstWithNotes = group.items.find(i => i.notes);
                            if (firstWithNotes && firstWithNotes.notes) {
                              return (
                                <div className="text-[10px] text-orange-600 font-semibold mt-2 bg-orange-50 px-2 py-1 rounded border border-orange-100 w-fit">
                                  Narration: {firstWithNotes.notes}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 align-middle">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                          🚚 Delivered
                        </span>
                      </TableCell>
                      <TableCell className="border-2 border-slate-300 px-4 py-3 text-right align-middle no-print">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs font-semibold text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700 gap-1.5 shadow-2xs"
                          onClick={() => {
                            const parentSale = sales.find(s => s.id === group.salesId);
                            navigate("/sales", {
                              state: {
                                editDeliveredOrder: {
                                  challanNumber: group.challanNo,
                                  orderNo: parentSale?.orderNo || group.challanNo,
                                  customer: group.customer,
                                  clientPhone: group.clientPhone,
                                  category: parentSale?.category || "Regular",
                                  orderDate: group.createdAt ? (typeof group.createdAt === 'string' ? group.createdAt.slice(0, 10) : format(new Date(group.createdAt), "yyyy-MM-dd")) : getLocalDateString(),
                                  notes: group.items.find(i => i.notes)?.notes || parentSale?.remarks || "",
                                  items: group.items.map(i => ({
                                    id: i.id,
                                    salesId: i.salesId,
                                    productName: i.product,
                                    quantity: Number(i.quantity),
                                    batchNo: i.batchNo || "0",
                                    stockCategory: i.stockCategory || "Available",
                                    notes: i.notes || "",
                                  })),
                                  returnTo: "/delivered-orders",
                                },
                              },
                            });
                          }}
                          title="Edit delivered products (replace product/quantity)"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {groupedChallans.length > 0 && (
              <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between p-3 border-t bg-slate-50 text-xs gap-2 no-print shadow-xs">
                <span className="text-muted-foreground">
                  Showing <strong>{(page - 1) * pageSize + 1}</strong> to{" "}
                  <strong>{Math.min(page * pageSize, groupedChallans.length)}</strong> of{" "}
                  <strong>{groupedChallans.length}</strong> delivered orders
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <span className="font-semibold text-slate-700 min-w-[70px] text-center">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
