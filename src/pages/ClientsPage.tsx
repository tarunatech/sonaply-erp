import { useState, useEffect, useCallback } from "react";
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

const PRICE_CATEGORIES = ['0-10000', '10000-20000', '20000-50000', '50000-100000', 'Above 100000'];

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [filter, setFilter] = useState('');
   const [newClient, setNewClient] = useState({ name: '', phone: '', priceCategory: '0-10000' });
  const [showAddDialog, setShowAddDialog] = useState(false);
  const { toast } = useToast();

  const refresh = useCallback(() => getClients().then(setClients), []);
  useEffect(() => { refresh(); }, [refresh]);

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
    setNewClient({ name: '', phone: '', priceCategory: '0-10000' });
    toast({ title: "New client profile created" });
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
                  <Input 
                    placeholder="Enter client name" 
                    value={newClient.name} 
                    onChange={e => setNewClient({...newClient, name: e.target.value})} 
                  />
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
                    value={newClient.priceCategory} 
                    onValueChange={v => setNewClient({...newClient, priceCategory: v})}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRICE_CATEGORIES.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                      <TableCell>{new Date(c.createdAt).toLocaleDateString()}</TableCell>
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
                                  <Select value={editingClient?.priceCategory || ''} onValueChange={v => setEditingClient({...editingClient, priceCategory: v})}>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {PRICE_CATEGORIES.map(cat => (
                                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
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
