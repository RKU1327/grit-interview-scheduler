import type { Metadata } from "next";
import { PageHeader, Panel, Timeline } from "@/components/app/ui";
import { getDb } from "@/db";
import { listAudit } from "@/domain/queries";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  const events = (await listAudit((await getDb()), { limit: 150 }));
  return (
    <>
      <PageHeader
        title="Activity"
        description="Append-only audit trail of every state transition: eligibility, bookings, changes, outcomes, corrections, badge awards and nullifications. Latest 150 events."
      />
      <Panel title="All events" description="Each entry records who did it, when, and the state change.">
        <div data-testid="activity-log">
          <Timeline events={events} />
        </div>
      </Panel>
    </>
  );
}
