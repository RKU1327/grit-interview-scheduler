import type { Metadata } from "next";
import Link from "next/link";
import { Award, ShieldOff } from "lucide-react";
import { EmptyState, PageHeader, Panel, Pill, tableCls } from "@/components/app/ui";
import { NullifyButton } from "@/components/staff/nullify-button";
import { getDb } from "@/db";
import { listAwards } from "@/domain/queries";
import { fmtStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Badges" };

export default async function BadgesPage() {
  const awards = (await listAwards((await getDb())));
  return (
    <>
      <PageHeader
        title="Badges"
        description="Every Track Badge issued after a passed interview. Nullifying a badge for confirmed malpractice is a separate action from failing an interview and keeps the full history."
      />
      <Panel title="Issued badges" description={`${awards.filter((a) => a.status === "active").length} active · ${awards.filter((a) => a.status === "nullified").length} nullified`} bodyClassName="p-0">
        {awards.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<Award />} title="No badges issued yet">
              A badge is issued automatically when an interviewer records a pass.
            </EmptyState>
          </div>
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table} data-testid="awards-table">
              <caption className="sr-only">Issued badges</caption>
              <thead>
                <tr>
                  {["Student", "Badge", "Awarded", "Status", "Action"].map((h) => (
                    <th key={h} scope="col" className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {awards.map((a) => (
                  <tr key={a.id} data-testid="award-row" data-student={a.studentId} data-status={a.status}>
                    <td className={tableCls.td}>
                      <Link href={`/team/students/${a.studentId}`} className="rounded font-medium hover:text-primary hover:underline">
                        {a.studentName}
                      </Link>
                    </td>
                    <td className={tableCls.td}>{a.badgeName}</td>
                    <td className={cn(tableCls.td, "whitespace-nowrap text-muted-foreground")}>{fmtStamp(a.awardedAt)}</td>
                    <td className={tableCls.td}>
                      {a.status === "active" ? (
                        <Pill tone="success">
                          <Award /> Earned
                        </Pill>
                      ) : (
                        <>
                          <Pill tone="danger">
                            <ShieldOff /> Nullified
                          </Pill>
                          <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                            {a.nullifiedAt && fmtStamp(a.nullifiedAt)} · {a.nullifiedBy}
                            <br />
                            Reason: {a.nullifyReason}
                          </p>
                        </>
                      )}
                    </td>
                    <td className={tableCls.td}>
                      {a.status === "active" ? (
                        <NullifyButton awardId={a.id} studentName={a.studentName} badgeName={a.badgeName} />
                      ) : (
                        <span className="text-xs text-muted-foreground">History preserved</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
