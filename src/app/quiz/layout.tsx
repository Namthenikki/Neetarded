
// This layout provides a full-screen, distraction-free environment for quiz taking.
export default function QuizLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
