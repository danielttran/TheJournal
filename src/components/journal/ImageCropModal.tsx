"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactCrop, {
    type Crop,
    type PixelCrop,
    centerCrop,
    makeAspectCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { X, Check, Loader } from 'lucide-react';

interface ImageCropModalProps {
    /** src attribute of the image node currently selected in the editor. */
    imageSrc: string;
    onConfirm: (newUrl: string) => void;
    onClose: () => void;
}

/** Draw the completed crop onto an off-screen canvas and return a Blob. */
async function cropToBlob(img: HTMLImageElement, pixelCrop: PixelCrop): Promise<Blob> {
    const canvas = document.createElement('canvas');
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;

    canvas.width = Math.round(pixelCrop.width * scaleX);
    canvas.height = Math.round(pixelCrop.height * scaleY);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    ctx.drawImage(
        img,
        pixelCrop.x * scaleX,
        pixelCrop.y * scaleY,
        pixelCrop.width * scaleX,
        pixelCrop.height * scaleY,
        0, 0,
        canvas.width,
        canvas.height,
    );

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null')), 'image/png');
    });
}

export default function ImageCropModal({ imageSrc, onConfirm, onClose }: ImageCropModalProps) {
    // objectUrl holds either a blob URL (for /api/attachment/) or the original src
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [isImageLoading, setIsImageLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const imgRef = useRef<HTMLImageElement>(null);
    const objectUrlRef = useRef<string | null>(null);

    // Load the image. For /api/attachment/ URLs, fetch with credentials so the
    // auth cookie is sent, then create an object URL for the <img> element.
    // For external URLs, use the src directly (cross-origin canvas will be blocked at draw time).
    useEffect(() => {
        let cancelled = false;
        setIsImageLoading(true);
        setLoadError(false);

        const load = async () => {
            if (imageSrc.startsWith('/api/attachment/')) {
                try {
                    const res = await fetch(imageSrc, { credentials: 'same-origin' });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const blob = await res.blob();
                    if (cancelled) return;
                    const url = URL.createObjectURL(blob);
                    objectUrlRef.current = url;
                    setObjectUrl(url);
                } catch {
                    if (!cancelled) setLoadError(true);
                }
            } else {
                // External image — set directly; canvas crop will fail if cross-origin
                if (!cancelled) setObjectUrl(imageSrc);
            }
        };

        load();
        return () => {
            cancelled = true;
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = null;
            }
        };
    }, [imageSrc]);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        setIsImageLoading(false);
        const { naturalWidth, naturalHeight } = e.currentTarget;
        // Start with a centered 80% width selection keeping the image's aspect ratio
        const initial = centerCrop(
            makeAspectCrop(
                { unit: '%', width: 80 },
                naturalWidth / naturalHeight,
                naturalWidth,
                naturalHeight,
            ),
            naturalWidth,
            naturalHeight,
        );
        setCrop(initial);
    };

    const handleConfirm = useCallback(async () => {
        if (!completedCrop || !imgRef.current) return;
        setIsSaving(true);
        try {
            const blob = await cropToBlob(imgRef.current, completedCrop);
            const formData = new FormData();
            formData.append('file', blob, 'cropped.png');
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
            onConfirm(data.url);
        } catch (err) {
            console.error('[ImageCropModal] crop upload failed:', err);
            window.alert('Crop failed. Please try again.');
        } finally {
            setIsSaving(false);
        }
    }, [completedCrop, onConfirm]);

    const hasCrop = completedCrop && completedCrop.width > 0 && completedCrop.height > 0;

    return (
        <div
            className="fixed inset-0 z-[600] bg-black/70 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-bg-card border border-border-primary rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border-primary flex-shrink-0">
                    <h2 className="font-semibold text-text-primary">Crop Image</h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleConfirm}
                            disabled={!hasCrop || isSaving}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-accent-primary/80 transition-colors"
                        >
                            {isSaving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            {isSaving ? 'Saving…' : 'Apply Crop'}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Crop area */}
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[#0a0a0a] min-h-[300px]">
                    {(isImageLoading || !objectUrl) && !loadError && (
                        <div className="flex items-center gap-2 text-text-muted">
                            <Loader className="w-4 h-4 animate-spin" />
                            <span className="text-sm">Loading image…</span>
                        </div>
                    )}
                    {loadError && (
                        <p className="text-red-400 text-sm">Failed to load image.</p>
                    )}
                    {objectUrl && !loadError && (
                        <ReactCrop
                            crop={crop}
                            onChange={c => setCrop(c)}
                            onComplete={c => setCompletedCrop(c)}
                            keepSelection
                            minWidth={10}
                            minHeight={10}
                        >
                            <img
                                ref={imgRef}
                                src={objectUrl}
                                onLoad={onImageLoad}
                                onError={() => { setLoadError(true); setIsImageLoading(false); }}
                                style={{
                                    maxHeight: '60vh',
                                    maxWidth: '100%',
                                    display: isImageLoading ? 'none' : 'block',
                                }}
                                alt="Crop preview"
                                crossOrigin={imageSrc.startsWith('/') ? undefined : 'anonymous'}
                            />
                        </ReactCrop>
                    )}
                </div>

                <p className="text-center text-xs text-text-muted px-4 py-2 border-t border-border-primary flex-shrink-0">
                    Drag corners to select the crop area. The result is saved as a new image attachment.
                </p>
            </div>
        </div>
    );
}
