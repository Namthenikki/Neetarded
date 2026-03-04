import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, unlink, mkdir, readFile } from "fs/promises";
import path from "path";
import os from "os";

export const maxDuration = 300; // 5 minutes

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("pdf") as File;
        const source = formData.get("source") as string;
        const dryRun = formData.get("dryRun") === "true";
        const noImages = formData.get("noImages") === "true";

        if (!file || !source) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        if (!file.name.endsWith(".pdf")) {
            return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
        }

        // Save uploaded file to temp directory
        const tempDir = path.join(os.tmpdir(), "neetarded-uploads");
        await mkdir(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `upload_${Date.now()}.pdf`);
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(tempPath, buffer);

        // Build the command arguments
        const scriptPath = path.join(process.cwd(), "scripts", "ingest_paper.py");
        const args = [scriptPath, tempPath, "--source", source];
        if (dryRun) args.push("--dry-run");
        if (noImages) args.push("--no-images");

        // Create SSE stream
        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();

                const sendEvent = (data: any) => {
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                    } catch (e) {
                        // Stream might be closed
                    }
                };

                const proc = spawn("python", args, {
                    env: { ...process.env, PYTHONUNBUFFERED: "1" },
                    cwd: process.cwd(),
                });

                let fullStdout = "";
                let fullStderr = "";

                proc.stdout.on("data", (data) => {
                    const text = data.toString();
                    fullStdout += text;
                    sendEvent({ type: "log", text });
                });

                proc.stderr.on("data", (data) => {
                    const text = data.toString();
                    fullStderr += text;
                    sendEvent({ type: "log", text, isError: true });
                });

                proc.on("close", async (code) => {
                    // Try to clean up temp file
                    try { await unlink(tempPath); } catch { }

                    // Parse key metrics from stdout
                    const questionsMatch = fullStdout.match(/Total questions parsed:\s*(\d+)/);
                    const dedupMatch = fullStdout.match(/After dedup:\s*(\d+)/);
                    const imagesMatch = fullStdout.match(/(\d+) questions now have( cropped figure)? images/);
                    const pushedMatch = fullStdout.match(/Pushed (\d+) documents/);
                    const dryRunMatch = fullStdout.match(/Saved full output to:\s*(.+)/);

                    const questionsParsed = dedupMatch ? parseInt(dedupMatch[1]) : (questionsMatch ? parseInt(questionsMatch[1]) : 0);

                    const metrics = {
                        questionsParsed,
                        imagesAttached: imagesMatch ? parseInt(imagesMatch[1]) : 0,
                        documentsPushed: pushedMatch ? parseInt(pushedMatch[1]) : 0,
                        dryRunOutput: dryRunMatch ? dryRunMatch[1].trim() : null,
                    };

                    let parsedQuestions: any[] = [];
                    if (dryRun && metrics.dryRunOutput) {
                        try {
                            const jsonContent = await readFile(metrics.dryRunOutput, "utf-8");
                            parsedQuestions = JSON.parse(jsonContent);
                        } catch (e) { }
                    }

                    const success = questionsParsed > 0;

                    sendEvent({
                        type: "done",
                        success,
                        metrics,
                        exitCode: code,
                        parsedQuestions: dryRun ? parsedQuestions : [],
                    });

                    try { controller.close(); } catch { }
                });

                proc.on("error", (err) => {
                    sendEvent({ type: "error", message: err.message });
                    try { controller.close(); } catch { }
                });
            }
        });

        return new NextResponse(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
