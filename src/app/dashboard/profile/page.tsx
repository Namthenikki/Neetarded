"use client";

import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { User, Shield, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProfilePage() {
  const { user, logout } = useAuth();

  const getInitials = (name: string = '') => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  }

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Profile</h1>
      {user && (
        <Card className="max-w-2xl mx-auto shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-6">
              <Avatar className="h-20 w-20 border-2 border-primary">
                <AvatarFallback className="text-3xl bg-primary/20">{getInitials(user.name)}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-3xl font-bold">{user.name}</CardTitle>
                <CardDescription className="text-md">Welcome to your profile page.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="mt-4 space-y-4">
            <div className="flex items-center gap-4 rounded-lg border p-4 bg-background">
              <User className="h-6 w-6 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Full Name</p>
                <p className="font-semibold">{user.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-lg border p-4 bg-background">
              <Shield className="h-6 w-6 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Unique ID</p>
                <p className="font-semibold font-mono tracking-widest">{user.studentId}</p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="pt-6">
            <Button variant="destructive" className="w-full" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Logout</span>
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
