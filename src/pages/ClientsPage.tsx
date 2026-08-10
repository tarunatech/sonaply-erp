import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getClients, addClient, updateClient, deleteClient, exportCSV, addClientBulk, downloadClientTemplate, Client } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Pencil, Trash2, UserCircle, UserPlus, FileSpreadsheet, Upload, FileDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import * as XLSX from "xlsx";

const PRICE_CATEGORIES = ['Regular', 'Premium', 'Only Cash'];

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [filter, setFilter] = useState('');
  const [newClient, setNewClient] = useState({ name: '', phone: '', priceCategory: 'Regular' });
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importedClients, setImportedClients] = useState<Array<{ name: string; phone: string; priceCategory: string }>>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const refresh = useCallback(() => getClients().then(setClients), []);
  useEffect(() => { refresh(); }, [refresh]);

  const nameSuggestions = useMemo(() => {
    const q = newClient.name.toLowerCase().trim();
    if (!q) return clients.slice(0, 10);
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.priceCategory || '').toLowerCase().includes(q)
    ).slice(0, 10);
  }, [clients, newClient.name]);

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(filter.toLowerCase()) ||
    c.phone.includes(filter)
  );

  const handleDelete = async (id: string) => {
    const password = window.prompt("Please enter admin password to delete:");
    if (password !== 'admin') {
      if (password !== null) toast({ title: "Incorrect password", variant: "destructive" });
      return;
    }
    if (window.confirm("Are you sure you want to delete this client profile?")) {
      await deleteClient(id);
      refresh();
      toast({ title: "Client deleted" });
    }
  };

  const handleEditSave = async () => {
    if (!editingClient) return;
    await updateClient(editingClient.id, editingClient);
    refresh();
    setEditingClient(null);
    toast({ title: "Client profile updated" });
  };
  const handleAddClient = async () => {
    if (!newClient.name) {
      toast({ title: "Please enter client name", variant: "destructive" });
      return;
    }
    await addClient(newClient);
    refresh();
    setShowAddDialog(false);
    setNewClient({ name: '', phone: '', priceCategory: 'Regular' });
    toast({ title: "New client profile created" });
  };

  const pickClientSuggestion = (client: Client) => {
    setNewClient({
      name: client.name,
      phone: client.phone || '',
      priceCategory: client.priceCategory || 'Regular',
    });
    setShowNameSuggestions(false);
    setSelectedSuggestionIndex(-1);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'array' });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

        if (!rawData || rawData.length === 0) {
          toast({ title: "No data found in the Excel file", variant: "destructive" });
          return;
        }

        const parsed: Array<{ name: string; phone: string; priceCategory: string }> = [];

        rawData.forEach((row) => {
          let name = '';
          let phone = '';
          let priceCategory = 'Regular';

          for (const key of Object.keys(row)) {
            const k = key.trim().toLowerCase();
            const val = String(row[key] ?? '').trim();
            if (['name', 'client name', 'client_name', 'full name', 'fullname'].includes(k)) {
              name = val;
            } else if (['phone', 'phone number', 'phonenumber', 'mobile', 'contact', 'client_phone', 'phone no'].includes(k)) {
              phone = val;
            } else if (['price category', 'pricecategory', 'price_category', 'category'].includes(k)) {
              if (val) priceCategory = val;
            }
          }

          if (name) {
            parsed.push({ name, phone, priceCategory });
          }
        });

        if (parsed.length === 0) {
          toast({ title: "No valid client rows with names found in Excel file", variant: "destructive" });
          return;
        }

        setImportedClients(parsed);
        setShowImportDialog(true);
      } catch (err: any) {
        toast({ title: "Failed to parse Excel file", description: err.message, variant: "destructive" });
      } finally {
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleConfirmImport = async () => {
    if (importedClients.length === 0) return;
    setIsImporting(true);
    try {
      const res = await addClientBulk(importedClients);
      refresh();
      setShowImportDialog(false);
      setImportedClients([]);
      toast({
        title: "Import Successful",
        description: `Successfully stored ${res.count || importedClients.length} clients in the database.`,
      });
    } catch (err: any) {
      toast({
        title: "Import Failed",
        description: err.message || "Failed to store client data in DB.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UserCircle className="h-6 w-6 text-primary" />
          Client Profiles
        </h1>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="w-full sm:w-64">
            <Input 
              placeholder="Search by name or phone..." 
              value={filter} 
              onChange={e => setFilter(e.target.value)} 
              className="h-9"
            />
          </div>
           <Button variant="outline" size="sm" onClick={downloadClientTemplate} title="Download Excel template for client import">
            <FileDown className="mr-1 h-4 w-4 text-emerald-600" /> Template
          </Button>

          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} title="Import clients from Excel / CSV file">
            <Upload className="mr-1 h-4 w-4 text-blue-600" /> Import Excel
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".xlsx, .xls, .csv"
            className="hidden"
            onChange={handleFileImport}
          />

          <Button variant="outline" size="sm" onClick={() => exportCSV(filteredClients as any, `clients-${new Date().toISOString().slice(0,10)}.csv`)}>
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
          
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-primary hover:bg-primary/90">
                <UserPlus className="mr-1 h-4 w-4" /> Add Client
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Client Profile</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Full Name *</Label>
                  <div className="relative">
                    <Input
                      placeholder="Enter client name"
                      value={newClient.name}
                      onChange={e => {
                        setNewClient({ ...newClient, name: e.target.value });
                        setShowNameSuggestions(true);
                      }}
                      onFocus={() => {
                        setShowNameSuggestions(true);
                        setSelectedSuggestionIndex(-1);
                      }}
                      onBlur={() => setTimeout(() => {
                        setShowNameSuggestions(false);
                        setSelectedSuggestionIndex(-1);
                      }, 200)}
                      onKeyDown={e => {
                        if (!showNameSuggestions || nameSuggestions.length === 0) return;
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSelectedSuggestionIndex(prev => (prev < nameSuggestions.length - 1 ? prev + 1 : prev));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSelectedSuggestionIndex(prev => (prev > 0 ? prev - 1 : prev));
                        } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
                          e.preventDefault();
                          pickClientSuggestion(nameSuggestions[selectedSuggestionIndex]);
                        } else if (e.key === 'Escape') {
                          setShowNameSuggestions(false);
                          setSelectedSuggestionIndex(-1);
                        }
                      }}
                      autoComplete="off"
                    />
                    {showNameSuggestions && nameSuggestions.length > 0 && (
                      <div ref={nameContainerRef} className="absolute z-[110] w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {nameSuggestions.map((c, i) => (
                          <div
                            key={c.id}
                            className={`px-3 py-2 cursor-pointer text-sm text-popover-foreground border-b last:border-0 ${selectedSuggestionIndex === i ? 'bg-accent' : 'hover:bg-accent'}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              pickClientSuggestion(c);
                            }}
                          >
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                              <span>{c.phone || 'No phone'}</span>
                              <span>{c.priceCategory || 'No price category'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Phone Number</Label>
                  <Input 
                    placeholder="Enter phone number" 
                    value={newClient.phone} 
                    onChange={e => setNewClient({...newClient, phone: e.target.value})} 
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Price Category</Label>
                  <Select
                    value={PRICE_CATEGORIES.includes(newClient.priceCategory) ? newClient.priceCategory : 'custom'}
                    onValueChange={v => {
                      if (v === 'custom') return;
                      setNewClient({ ...newClient, priceCategory: v });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select a preset" /></SelectTrigger>
                    <SelectContent>
                      {PRICE_CATEGORIES.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                      <SelectItem value="custom">Custom value</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Or type a custom price category"
                    value={PRICE_CATEGORIES.includes(newClient.priceCategory) ? '' : newClient.priceCategory}
                    onChange={e => setNewClient({ ...newClient, priceCategory: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                <Button onClick={handleAddClient}>Create Profile</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Price Category</TableHead>
                  <TableHead>Date Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No client profiles found. Records are added automatically when you record a sale.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredClients.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.phone || '-'}</TableCell>
                      <TableCell>
                        <span className="px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                          {c.priceCategory}
                        </span>
                      </TableCell>
                      <TableCell>{c.createdAt ? format(new Date(c.createdAt), "dd-MM-yyyy") : "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Dialog open={!!editingClient && editingClient.id === c.id} onOpenChange={(open) => !open && setEditingClient(null)}>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => setEditingClient({...c})} title="Edit Profile">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Edit Client Profile</DialogTitle>
                              </DialogHeader>
                              <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                  <Label>Name</Label>
                                  <Input value={editingClient?.name || ''} onChange={e => setEditingClient({...editingClient, name: e.target.value})} />
                                </div>
                                <div className="grid gap-2">
                                  <Label>Phone Number</Label>
                                  <Input value={editingClient?.phone || ''} onChange={e => setEditingClient({...editingClient, phone: e.target.value})} />
                                </div>
                                <div className="grid gap-2">
                                  <Label>Price Category</Label>
                                  <Select
                                    value={PRICE_CATEGORIES.includes(editingClient?.priceCategory) ? editingClient.priceCategory : 'custom'}
                                    onValueChange={v => {
                                      if (v === 'custom') return;
                                      setEditingClient({ ...editingClient, priceCategory: v });
                                    }}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select a preset" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {PRICE_CATEGORIES.map(cat => (
                                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                      ))}
                                      <SelectItem value="custom">Custom value</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <Input
                                    placeholder="Or type a custom price category"
                                    value={PRICE_CATEGORIES.includes(editingClient?.priceCategory) ? '' : editingClient?.priceCategory || ''}
                                    onChange={e => setEditingClient({ ...editingClient, priceCategory: e.target.value })}
                                  />
                                </div>
                              </div>
                              <DialogFooter>
                                <Button onClick={handleEditSave}>Save Changes</Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>

                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(c.id)} title="Delete Profile">
                            <Trash2 className="h-4 w-4" />
                          </Button>
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

      {/* Excel Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <FileSpreadsheet className="h-5 w-5 text-blue-600" />
              Preview Excel Import ({importedClients.length} Clients)
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            Review the clients parsed from your file before saving to database. Duplicate names will be updated automatically.
          </div>
          <div className="overflow-y-auto max-h-[50vh] border rounded-md my-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Price Category</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importedClients.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.phone || "-"}</TableCell>
                    <TableCell>
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                        {item.priceCategory}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowImportDialog(false)} disabled={isImporting}>
              Cancel
            </Button>
            <Button onClick={handleConfirmImport} disabled={isImporting || importedClients.length === 0} className="bg-blue-600 hover:bg-blue-700 text-white">
              {isImporting ? "Saving to Database..." : `Save ${importedClients.length} Clients`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
