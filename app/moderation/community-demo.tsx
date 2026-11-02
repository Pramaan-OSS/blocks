"use client";
import { useResource } from "@/lib/pramaan/client";
import { SafetyActions } from "@/components/pramaan/moderation/moderation-panel";
export function CommunityDemo() {
  const { data, error, loading } = useResource<{ itemVisible: boolean; personVisible: boolean }>("/api/demo/community");
  if (loading) return <p>Loading community examples…</p>;
  if (error) return null;
  return <div className="grid gap-4 md:grid-cols-2">
    {data?.itemVisible ? <SafetyActions kind="item" target="demo-item" label="Sample community post" /> : <p>The sample post is hidden.</p>}
    {data?.personVisible ? <SafetyActions kind="person" target="mbr_sample" label="Sample community member" /> : <p>You blocked the sample community member.</p>}
  </div>;
}
