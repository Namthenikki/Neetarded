'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { collection, query, where, getDocs, setDoc, doc } from 'firebase/firestore';

import { db } from '@/lib/firebase/config';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';


const loginSchema = z.object({
  studentId: z.string().min(1, { message: 'ID cannot be empty.' }),
});
const registerSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
});

const ADMIN_KEY = 'neetarded_crack';

export default function AuthPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { studentId: '' },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '' },
  });

  const processId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

  async function handleLogin(values: z.infer<typeof loginSchema>) {
    setIsLoading(true);
    const inputId = processId(values.studentId);

    if (inputId === processId(ADMIN_KEY)) {
      login({ studentId: 'admin', name: 'Admin', role: 'admin' });
      toast({ title: 'Admin Access Granted.' });
      router.push('/dashboard/admin');
      return;
    }

    try {
      const q = query(collection(db, 'users'), where('studentId', '==', inputId));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        toast({ variant: 'destructive', title: 'Login Failed', description: 'Student ID not found.' });
        setIsLoading(false);
      } else {
        const userDoc = querySnapshot.docs[0].data();
        login({ studentId: userDoc.studentId, name: userDoc.name, role: 'student' });
        toast({ title: `Welcome back, ${userDoc.name}!` });
        router.push('/dashboard');
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      setIsLoading(false);
    }
  }

  async function handleRegister(values: z.infer<typeof registerSchema>) {
    setIsLoading(true);
    const studentId = processId(values.name);
    if (!studentId) {
        toast({variant: 'destructive', title: 'Invalid Name'});
        setIsLoading(false);
        return;
    }

    try {
        const q = query(collection(db, 'users'), where('studentId', '==', studentId));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            toast({ variant: 'destructive', title: 'Registration Failed', description: 'This name is already taken. Please try logging in.' });
            setIsLoading(false);
        } else {
            const newUser = {
                studentId,
                name: values.name.trim(),
                createdAt: new Date(),
            };
            await setDoc(doc(db, 'users', studentId), newUser);
            login({ studentId: newUser.studentId, name: newUser.name, role: 'student' });
            toast({ title: 'Account Created!', description: `Welcome, ${newUser.name}!` });
            router.push('/dashboard');
        }
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
        setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-white p-4">
      <Card className="w-full max-w-md rounded-2xl shadow-2xl bg-slate-50/80 backdrop-blur-lg border-slate-200">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-slate-900">Neetarded</CardTitle>
          <CardDescription className="text-slate-600">Your personal quiz performance engine.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-slate-200">
              <TabsTrigger value="login" className="text-slate-800 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-md">Log In</TabsTrigger>
              <TabsTrigger value="register" className="text-slate-800 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-md">Register</TabsTrigger>
            </TabsList>
            <TabsContent value="login" className="mt-6">
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="studentId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-800">Student ID or Admin Key</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. sourav"
                            {...field}
                            className="h-12 rounded-xl text-center text-lg text-slate-900 bg-white border-slate-300 focus:ring-slate-900"
                            onChange={(e) => field.onChange(e.target.value)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full h-12 rounded-xl bg-slate-900 text-white hover:bg-slate-800" disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : 'Enter'}
                  </Button>
                </form>
              </Form>
            </TabsContent>
            <TabsContent value="register" className="mt-6">
               <Form {...registerForm}>
                <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
                  <FormField
                    control={registerForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-800">Full Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Sourav Ganguly" {...field} className="h-12 rounded-xl text-center text-lg text-slate-900 bg-white border-slate-300 focus:ring-slate-900" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full h-12 rounded-xl bg-slate-900 text-white hover:bg-slate-800" disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : 'Create Account'}
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
