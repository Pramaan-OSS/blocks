# File upload (`upload`)

Drag and drop files, watch each one upload with its own progress bar, then see, open and delete what
you uploaded. Each file goes straight from the browser to storage, so large files never pass
through your app. Licence: MIT.

## Install

```bash
npx shadcn@4.23.0 add https://raw.githubusercontent.com/Pramaan-OSS/blocks/main/public/r/upload.json
```

It adds the files below, the shadcn `button`, `alert-dialog` and `badge` components, and the
`@pramaan/sdk` and `server-only` packages. No other dependency. Set `PRAMAAN_API_KEY` on the server.

## Look

The block reads the Pramaan theme (`theme.json`). Install it once and load its fonts with
`pramaanFonts` on `<html>`; steps are in the repo README.

## Use

```tsx
import { UploadDropzone, UploadedFiles } from "@/components/pramaan/upload/uploader";

<UploadDropzone onUploaded={(f) => console.log(f.fileId, f.filename)} />
<UploadedFiles />
```

| Component | Prop | Default | What it does |
|---|---|---|---|
| `UploadDropzone` | `onUploaded` | none | called with `fileId`, `filename`, `contentType`, `sizeBytes` once a file is checked and ready; pass the id to other blocks, for example `e-sign` |
| `UploadDropzone` | `accept` | any | the file picker's `accept` filter |
| `UploadedFiles` | `pollMs` | 30000 | how often to refresh |

## What it shows

- A drop area and a "Choose files" button. Several files at once, each with its own progress bar
  and a plain state: uploading, checking, uploaded, didn't upload (with a Try again button).
- Images, audio, video, PDF, CSV, JSON and text files. Images up to 20 MB, audio, PDF and data up to
  100 MB, video up to 500 MB. A file that is too large, empty or of another type is refused before
  anything is sent, in plain words.
- A list of what was uploaded, with type, size, when it was uploaded and when it is deleted (files
  are kept 7 days). Open shows the file; Delete asks first and removes it at once.
- File names: the service keeps none, so the list shows the names this browser uploaded and a
  plain type label for the rest.

## Calls it makes

Server only, from `app/api/pramaan/uploads/`, with `PRAMAAN_API_KEY`:

| Route in your app | Pramaan call |
|---|---|
| `POST /api/pramaan/uploads` | `POST /v1/files/uploads` (starts the upload, returns a short-lived storage link) |
| `POST /api/pramaan/uploads/[id]/finish` | `POST /v1/files/{id}/finish` |
| `GET /api/pramaan/uploads` | `GET /v1/files?origin=upload` |
| `DELETE /api/pramaan/uploads/[id]` | `DELETE /v1/files/{id}` |

The browser sends the bytes to the storage link with a `PUT` and never holds your key. The storage
link must accept a cross-origin `PUT` from your app's address. **Put your own sign-in check in front
of these routes:** uploads use your storage. Try it on the fake with `PRAMAAN_FAKE=1 pnpm dev` and
open `/upload`; a demo route stands in for storage.

## Files

| File | Part |
|---|---|
| `lib/pramaan/upload.ts` | server logic |
| `app/api/pramaan/uploads/**/route.ts` | route handlers |
| `components/pramaan/upload/uploader.tsx` | the drop area, progress and the file list |
| `lib/pramaan/*`, `components/pramaan/*` | shared by every block |
