import { AssessmentHub } from "@/components/pramaan/assessment/assessment-hub";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Assessments">Build a proctored test, invite candidates, and read their results.</PageTitle>
      <AssessmentHub approvalsHref="/" pollMs={15_000} />
    </div>
  );
}
