import { useState, useEffect } from "react";
import { getHolds, releaseHold, Hold } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function HoldPage() {
  const [holds, setHolds] = useState<Hold[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchHolds = async () => {
    try {
      const data = await getHolds();
      setHolds(data);
    } catch (error) {
      toast({ title: "Failed to fetch holds", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolds();
  }, []);

  const handleRelease = async (id: string) => {
    try {
      await releaseHold(id);
      toast({ title: "Hold released successfully", description: "Stock returned to available inventory." });
      fetchHolds();
    } catch (error) {
      toast({ title: "Failed to release hold", variant: "destructive" });
    }
  };

  const filteredHolds = holds.filter(h => 
    h.clientName.toLowerCase().includes(search.toLowerCase()) || 
    h.productName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold tracking-tight">Active Holds</h2>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4">
            <Input 
              placeholder="Search by client or product..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              className="max-w-md"
            />
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-4">Loading...</TableCell></TableRow>
                ) : filteredHolds.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground">No active holds found.</TableCell></TableRow>
                ) : (
                  filteredHolds.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>{format(new Date(h.holdDate), 'dd-MM-yyyy')}</TableCell>
                      <TableCell className="font-medium">{h.clientName}</TableCell>
                      <TableCell>{h.clientPhone}</TableCell>
                      <TableCell>{h.productName}</TableCell>
                      <TableCell>{h.batchNo || '-'}</TableCell>
                      <TableCell className="text-right font-medium text-amber-600">{h.quantity}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => handleRelease(h.id)} className="text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700">
                          Release Hold
                        </Button>
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
