# Image Editing Recommendation (TipTap)

## Current Implementation

The editor now supports:

- Image upload to `/api/upload` from the toolbar.
- Image insert by URL.
- Quick image resize presets (25%, 50%, 75%, 100%) when an image is selected.
- Image removal from the selected node.

## Recommended Next Steps (Production Roadmap)

1. **Server-side image pipeline**
   - Move uploads from `public/uploads` to an app-data path (especially for Electron).
   - Add server-side image validation (mime sniffing + file signature checks).
   - Generate derivatives (thumbnail + optimized web variant) with `sharp`.

2. **Real crop workflow**
   - Introduce an image-edit modal with a crop rectangle and rotation.
   - Persist crop as either:
     - non-destructive metadata (`x/y/width/height/rotation`) + CSS/object-position render, or
     - destructive cropped derivative generated server-side.

3. **Resize UX upgrades**
   - Add drag-resize handles directly on selected images in the editor.
   - Keep aspect-ratio lock by default, optional unlock toggle.

4. **Reliability and storage hygiene**
   - Add orphan-file cleanup job for deleted/replaced images.
   - Add upload retry and explicit progress UI for large images.
   - Add max dimensions and automatic downscaling before upload.

5. **Security hardening**
   - Restrict accepted formats (e.g., jpg/png/webp/avif).
   - Strip metadata (EXIF) for privacy by default.
   - Add optional signed URLs if cloud/object storage is introduced later.
