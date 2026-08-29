import { ReportView } from "@/components/report-view";

interface ReportPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { id } = await params;
  return <ReportView taskId={id} />;
}
