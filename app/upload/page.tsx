import { PageTitle } from "@/components/pramaan/parts";
import { UploadDropzone, UploadedFiles } from "@/components/pramaan/upload/uploader";

export default function Page() {
  return (
    <div className="space-y-8">
      <PageTitle title="Upload">Add files and keep track of what you've uploaded. Files are kept for 7 days.</PageTitle>
      <UploadDropzone />
      <section className="space-y-3">
        <h2>Your files</h2>
        <UploadedFiles />
      </section>
    </div>
  );
}
