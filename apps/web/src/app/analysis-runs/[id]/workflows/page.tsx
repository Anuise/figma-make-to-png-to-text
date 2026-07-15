import { WorkflowReview } from "./workflow-review";

export default async function WorkflowsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkflowReview analysisRunId={id} />;
}
