import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getClients, addClient, updateClient, deleteClient, exportCSV, Client } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Pencil, Trash2, UserCircle, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

const PRICE_CATEGORIES = ['Regular', 'Premium', 'Only Cash'];

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [filter, setFilter] = useState('');
  const [newClient, setNewClient] = useState({ name: '', phone: '', priceCategory: 'Regular' });
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
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
    </div>
  );
}
