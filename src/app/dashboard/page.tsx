"use client";

import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from 'next/link';
import { Book, BarChart3, PlusCircle } from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, {user?.name}!
        </h1>
        <p className="text-muted-foreground">This is your command center. Let's get started.</p>
      </div>

      <div className="mb-8">
        <Card className="shadow-lg border-primary/20">
            <CardHeader>
                <CardTitle>Create a New Quiz</CardTitle>
                <CardDescription>Start building your next test in minutes with our AI-powered creator.</CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild size="lg">
                    <Link href="/dashboard/create">
                        <PlusCircle className="mr-2 h-5 w-5" />
                        Create New Quiz
                    </Link>
                </Button>
            </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-medium">My Quizzes</CardTitle>
            <Book className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
             <p className="text-sm text-muted-foreground">
              View, edit, and manage all the quizzes you've created.
            </p>
          </CardContent>
          <CardContent>
              <Button asChild variant="outline">
                <Link href="/dashboard/quizzes">View All Quizzes</Link>
              </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-medium">Performance Analytics</CardTitle>
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
             <p className="text-sm text-muted-foreground">
              Check leaderboards and statistics for your published quizzes.
            </p>
          </CardContent>
          <CardContent>
              <Button asChild variant="outline">
                <Link href="/dashboard/quizzes">View Stats</Link>
              </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
