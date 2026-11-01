import { Chat } from "@/components/pramaan/chat/chat-panel";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Chat">Ask a question, or ask for something to be done. Try: "Email sam@example.com."</PageTitle>
      <Chat approvalsHref="/" />
    </div>
  );
}
