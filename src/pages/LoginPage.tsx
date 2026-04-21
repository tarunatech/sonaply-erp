import { useState } from "react";
import { login } from "@/lib/store";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn } from "lucide-react";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    const user = login(email, password);
    if (user) { onLogin(); }
    else { setError("Invalid email or password"); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">🪵 Plywood ERP</CardTitle>
          <p className="text-muted-foreground text-sm">Sign in to manage your inventory</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <Input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <Button className="w-full" onClick={handleLogin}><LogIn className="mr-2 h-4 w-4" />Sign In</Button>
          <p className="text-xs text-muted-foreground text-center">Demo: admin@erp.com / admin123 or staff@erp.com / staff123</p>
        </CardContent>
      </Card>
    </div>
  );
}
