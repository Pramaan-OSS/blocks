import { UnsubscribePage } from "@/components/pramaan/consent/consent-manager";
import { PageTitle } from "@/components/pramaan/parts";

// The public page: no sign-in.
export default async function Page({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  return (
    <div className="space-y-6">
      <PageTitle title="Stop hearing from us">Use the signed unsubscribe link from your message.</PageTitle>
      <UnsubscribePage title="Unsubscribe" link={link} />
    </div>
  );
}
