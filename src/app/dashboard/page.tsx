"use client";

import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import Image from "next/image";
import { Book, BarChart3 } from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuth();
  const quizPlaceholder = PlaceHolderImages.find(p => p.id === 'quiz-placeholder');
  const performancePlaceholder = PlaceHolderImages.find(p => p.id === 'performance-placeholder');

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, {user?.name}!
        </h1>
        <p className="text-muted-foreground">Your ID: {user?.uniqueId}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>My Quizzes</CardTitle>
            <Book className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {quizPlaceholder && (
              <div className="relative aspect-[3/2] w-full overflow-hidden rounded-lg">
                <Image
                  src={quizPlaceholder.imageUrl}
                  alt={quizPlaceholder.description}
                  fill
                  className="object-cover"
                  data-ai-hint={quizPlaceholder.imageHint}
                />
              </div>
            )}
            <p className="mt-4 text-center text-muted-foreground">
              Your quizzes will appear here.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Performance</CardTitle>
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {performancePlaceholder && (
              <div className="relative aspect-[3/2] w-full overflow-hidden rounded-lg">
                <Image
                  src={performancePlaceholder.imageUrl}
                  alt={performancePlaceholder.description}
                  fill
                  className="object-cover"
                  data-ai-hint={performancePlaceholder.imageHint}
                />
              </div>
            )}
            <p className="mt-4 text-center text-muted-foreground">
              Your performance analytics will appear here.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
