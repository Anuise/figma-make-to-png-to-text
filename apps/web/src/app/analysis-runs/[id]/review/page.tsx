import { ScreenReview } from "./screen-review";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ScreenReview analysisRunId={id} />;
}
