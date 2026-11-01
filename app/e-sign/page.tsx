import { PageTitle } from "@/components/pramaan/parts";
import { SendForSignature, SigningList } from "@/components/pramaan/signing/signing-flow";
import { DEMO_DOCUMENT_ID } from "@/lib/pramaan/fake-wave3";
import { SignerStandIn } from "./stand-in";

// Read per request so the demo stand-in follows PRAMAAN_FAKE at run time, not build time.
export const dynamic = "force-dynamic";

const documents = [{ fileId: DEMO_DOCUMENT_ID, filename: "sample-agreement.pdf", label: "Sample agreement" }];

export default function Page() {
  return (
    <div className="space-y-8">
      <PageTitle title="E-signature">Send a document to be signed, see who has signed, and get the signed copy.</PageTitle>
      <SendForSignature documents={documents} />
      <section className="space-y-3">
        <h2>Sent for signing</h2>
        <SigningList />
      </section>
      {process.env.PRAMAAN_FAKE === "1" && <SignerStandIn />}
    </div>
  );
}
