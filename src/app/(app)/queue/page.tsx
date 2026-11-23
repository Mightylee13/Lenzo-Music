"use client";

import { useRouter } from "next/navigation";
import { QueueView } from "@/components/shell/LyricsQueue";

export default function QueuePage() {
  const router = useRouter();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col animate-fade-in">
      <QueueView standalone onClose={() => router.back()} />
    </div>
  );
}
