"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

interface FigureCropEditorProps {
    /** The full page image URL to crop from */
    sourcePageUrl: string;
    /** The current crop bbox in pixels {left, top, right, bottom} */
    currentBbox?: { left: number; top: number; right: number; bottom: number } | null;
    /** The page dimensions from ingestion */
    pageWidth?: number;
    pageHeight?: number;
    /** Called when user applies the crop, returns {croppedBlob, bbox} */
    onApply: (result: {
        croppedBlob: Blob;
        bbox: { left: number; top: number; right: number; bottom: number };
    }) => void;
    /** Called when user cancels */
    onCancel: () => void;
}

export default function FigureCropEditor({
    sourcePageUrl,
    currentBbox,
    pageWidth,
    pageHeight,
    onApply,
    onCancel,
}: FigureCropEditorProps) {
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const imgRef = useRef<HTMLImageElement>(null);
    const [imgLoaded, setImgLoaded] = useState(false);
    const [applying, setApplying] = useState(false);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);

    // Fetch image as blob to avoid CORS issues with crossOrigin
    useEffect(() => {
        let cancelled = false;
        async function fetchImage() {
            try {
                const resp = await fetch(sourcePageUrl);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const blob = await resp.blob();
                if (!cancelled) {
                    const url = URL.createObjectURL(blob);
                    setBlobUrl(url);
                }
            } catch (err) {
                console.error("Failed to load page image:", err);
                if (!cancelled) setLoadError(true);
            }
        }
        fetchImage();
        return () => {
            cancelled = true;
            if (blobUrl) URL.revokeObjectURL(blobUrl);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourcePageUrl]);

    // When the image loads, set the initial crop from currentBbox
    const onImageLoad = useCallback(
        (e: React.SyntheticEvent<HTMLImageElement>) => {
            const img = e.currentTarget;
            setImgLoaded(true);

            if (currentBbox && pageWidth && pageHeight) {
                // Convert pixel bbox from original page to percentage of displayed image
                const xScale = 100 / pageWidth;
                const yScale = 100 / pageHeight;

                const initialCrop: Crop = {
                    unit: "%",
                    x: currentBbox.left * xScale,
                    y: currentBbox.top * yScale,
                    width: (currentBbox.right - currentBbox.left) * xScale,
                    height: (currentBbox.bottom - currentBbox.top) * yScale,
                };
                setCrop(initialCrop);
            } else {
                // Default: center crop at 40% of image
                setCrop({
                    unit: "%",
                    x: 10,
                    y: 20,
                    width: 40,
                    height: 40,
                });
            }
        },
        [currentBbox, pageWidth, pageHeight]
    );

    // Enhance the cropped image: boost contrast and sharpness
    function enhanceCrop(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number
    ) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Boost contrast: stretch histogram
        const contrast = 1.3; // 30% more contrast
        const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));

        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));     // R
            data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128)); // G
            data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128)); // B
        }

        ctx.putImageData(imageData, 0, 0);

        // Sharpen using a simple unsharp mask  approach:
        // Draw the image slightly blurred and subtract
        // Actually, CSS filter approach is simpler via a second canvas pass
        // For now the contrast boost is the main enhancement
    }

    // Crop the image using Canvas API and return as Blob
    async function handleApply() {
        if (!completedCrop || !imgRef.current) return;
        setApplying(true);

        try {
            const img = imgRef.current;
            const canvas = document.createElement("canvas");

            // The displayed image may be scaled, so we need the ratio
            const scaleX = img.naturalWidth / img.width;
            const scaleY = img.naturalHeight / img.height;

            const cropX = completedCrop.x * scaleX;
            const cropY = completedCrop.y * scaleY;
            const cropW = completedCrop.width * scaleX;
            const cropH = completedCrop.height * scaleY;

            canvas.width = cropW;
            canvas.height = cropH;
            const ctx = canvas.getContext("2d")!;

            ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

            // Apply enhancement (contrast boost)
            enhanceCrop(ctx, canvas.width, canvas.height);

            // Convert canvas to blob
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
                    "image/png",
                    1.0
                );
            });

            onApply({
                croppedBlob: blob,
                bbox: {
                    left: Math.round(cropX),
                    top: Math.round(cropY),
                    right: Math.round(cropX + cropW),
                    bottom: Math.round(cropY + cropH),
                },
            });
        } catch (err) {
            console.error("Crop failed:", err);
            alert("Failed to crop the image. Please try again.");
        } finally {
            setApplying(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-[#12121a] rounded-2xl border border-white/10 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                    <div>
                        <h2 className="text-lg font-bold text-white">
                            ✂️ Adjust Figure Crop
                        </h2>
                        <p className="text-xs text-gray-400 mt-1">
                            Drag the crop handles to select just the figure. Cropped images get auto-enhanced.
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="text-gray-400 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10 transition-all text-sm"
                    >
                        ✕
                    </button>
                </div>

                {/* Crop Area */}
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[#0a0a0f]">
                    {loadError && (
                        <div className="text-red-400 text-sm text-center">
                            <p className="mb-2">❌ Failed to load the page image.</p>
                            <p className="text-xs text-gray-500">
                                The full page image may not have been uploaded for this question.<br />
                                Try re-ingesting the PDF to generate page images.
                            </p>
                        </div>
                    )}
                    {!blobUrl && !loadError && (
                        <div className="text-gray-400 text-sm animate-pulse">
                            Loading page image...
                        </div>
                    )}
                    {blobUrl && (
                        <ReactCrop
                            crop={crop}
                            onChange={(c) => setCrop(c)}
                            onComplete={(c) => setCompletedCrop(c)}
                            className="max-h-[65vh]"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                ref={imgRef}
                                src={blobUrl}
                                alt="Full page for cropping"
                                onLoad={onImageLoad}
                                style={{
                                    maxHeight: "65vh",
                                    maxWidth: "100%",
                                    objectFit: "contain",
                                }}
                            />
                        </ReactCrop>
                    )}
                </div>

                {/* Preview + Actions */}
                <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                    <div className="text-xs text-gray-500">
                        {completedCrop && (
                            <span>
                                Crop: {Math.round(completedCrop.width)}×
                                {Math.round(completedCrop.height)}px
                                {" · "}
                                <span className="text-emerald-400">+ enhanced</span>
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 rounded-lg text-sm bg-white/5 text-gray-400 hover:bg-white/10 transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleApply}
                            disabled={!completedCrop || applying}
                            className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            {applying ? "Cropping & Enhancing..." : "✅ Apply Crop"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
