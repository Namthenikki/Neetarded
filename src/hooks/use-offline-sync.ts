"use client";

import { useEffect } from "react";
import { db } from "@/lib/firebase/config";
import { collection, doc, addDoc, writeBatch, query, where, getDocs } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";

/**
 * Hook that listens for the browser coming back online and
 * automatically submits any quiz attempts that were queued
 * while the student was offline.
 */
export function useOfflineSync() {
    const { toast } = useToast();

    useEffect(() => {
        const syncPendingSubmissions = async () => {
            const keys = Object.keys(localStorage).filter((k) =>
                k.startsWith("pending_submission_")
            );

            if (keys.length === 0) return;

            for (const key of keys) {
                try {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;

                    const attemptData = JSON.parse(raw);

                    const batch = writeBatch(db);
                    const attemptRef = doc(collection(db, "attempts"));
                    batch.set(attemptRef, attemptData);

                    // Also mark assignment as completed if one exists
                    if (attemptData.quizId && attemptData.studentId) {
                        const assignmentQuery = query(
                            collection(db, "assigned_quizzes"),
                            where("quizId", "==", attemptData.quizId),
                            where("studentId", "==", attemptData.studentId),
                            where("status", "==", "pending")
                        );
                        const assignmentSnapshot = await getDocs(assignmentQuery);
                        if (!assignmentSnapshot.empty) {
                            batch.update(assignmentSnapshot.docs[0].ref, { status: "completed" });
                        }
                    }

                    await batch.commit();
                    localStorage.removeItem(key);

                    toast({
                        title: "✅ Offline quiz submitted!",
                        description: `Your results for "${attemptData.quizTitle}" have been synced.`,
                    });
                } catch (error) {
                    console.error(`Failed to sync pending submission ${key}:`, error);
                    // Keep it in localStorage for next retry
                }
            }
        };

        // Try immediately on mount (e.g. if the user refreshed while online)
        syncPendingSubmissions();

        // Also listen for the browser coming back online
        const handleOnline = () => {
            console.log("Browser came online, syncing pending submissions...");
            syncPendingSubmissions();
        };

        window.addEventListener("online", handleOnline);
        return () => window.removeEventListener("online", handleOnline);
    }, [toast]);
}
