import { NextRequest, NextResponse } from 'next/server';
import { adminMessaging, adminDb } from '@/lib/firebase/admin';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { quizId, quizTitle, studentIds, adminId } = body;

        // Basic validation
        if (!quizId || !quizTitle || !studentIds || !adminId) {
            return NextResponse.json(
                { error: 'Missing required fields: quizId, quizTitle, studentIds, adminId' },
                { status: 400 }
            );
        }

        // Verify the requester is an admin
        const adminDoc = await adminDb.collection('users').doc(adminId).get();
        if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
            return NextResponse.json({ error: 'Unauthorized: Only admins can send notifications.' }, { status: 403 });
        }

        // Collect FCM tokens for all target students
        const allTokens: string[] = [];
        const invalidStudentIds: string[] = [];

        for (const studentId of studentIds as string[]) {
            const studentDoc = await adminDb.collection('users').doc(studentId).get();
            if (studentDoc.exists) {
                const tokens = studentDoc.data()?.fcmTokens;
                if (Array.isArray(tokens) && tokens.length > 0) {
                    allTokens.push(...tokens);
                }
            } else {
                invalidStudentIds.push(studentId);
            }
        }

        if (allTokens.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No students have notifications enabled. Quiz deployed but no push notifications sent.',
                invalidStudentIds,
            });
        }

        // Send multicast notification
        const message = {
            notification: {
                title: '📝 New Quiz Assigned!',
                body: `You have been assigned "${quizTitle}". Tap to start.`,
            },
            data: {
                quizId: quizId,
                type: 'quiz_assigned',
            },
            tokens: allTokens,
        };

        const response = await adminMessaging.sendEachForMulticast(message);

        console.log(`Notifications sent: ${response.successCount} success, ${response.failureCount} failed`);

        // Clean up invalid tokens
        if (response.failureCount > 0) {
            const invalidTokens: string[] = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errorCode = resp.error?.code;
                    if (
                        errorCode === 'messaging/invalid-registration-token' ||
                        errorCode === 'messaging/registration-token-not-registered'
                    ) {
                        invalidTokens.push(allTokens[idx]);
                    }
                }
            });

            // Remove invalid tokens from Firestore
            if (invalidTokens.length > 0) {
                console.log(`Cleaning up ${invalidTokens.length} invalid FCM tokens.`);
                // We iterate through students and remove any invalid tokens
                for (const studentId of studentIds as string[]) {
                    const studentRef = adminDb.collection('users').doc(studentId);
                    const studentDoc = await studentRef.get();
                    if (studentDoc.exists) {
                        const currentTokens = studentDoc.data()?.fcmTokens || [];
                        const cleanedTokens = currentTokens.filter((t: string) => !invalidTokens.includes(t));
                        await studentRef.update({ fcmTokens: cleanedTokens });
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            message: `Notifications sent to ${response.successCount} device(s).`,
            failureCount: response.failureCount,
            invalidStudentIds,
        });
    } catch (error: any) {
        console.error('Error sending notifications:', error);
        return NextResponse.json(
            { error: 'Failed to send notifications', details: error.message },
            { status: 500 }
        );
    }
}
