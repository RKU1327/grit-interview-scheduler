import { ShieldOff } from "lucide-react";
import { nullifyBadgeAction } from "@/app/actions";
import { ActionButton } from "@/components/app/action-button";
import { POLICY } from "@/domain/policy";

/** Malpractice nullification. Deliberately separate from, and worded differently to, failing an interview. */
export function NullifyButton({
  awardId,
  studentName,
  badgeName,
  size = "sm",
}: {
  awardId: string;
  studentName: string;
  badgeName: string;
  size?: "sm" | "default";
}) {
  return (
    <ActionButton
      action={nullifyBadgeAction.bind(null, awardId)}
      variant="outline"
      size={size}
      className="border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
      testId={`nullify-${awardId}`}
      confirm={{
        title: `Nullify ${studentName}'s badge for malpractice?`,
        description: (
          <div className="space-y-2">
            <p>
              This removes the earned status of <strong>{badgeName}</strong> because malpractice has been confirmed after the badge
              was issued.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>It is not an interview result. The original pass and the award stay in the history.</li>
              <li>The student sees a clear “badge nullified” status and cannot book this badge again.</li>
              <li>It cannot be undone in this prototype.</li>
            </ul>
          </div>
        ),
        confirmLabel: "Nullify badge",
        destructive: true,
        reason: {
          label: "What malpractice was confirmed?",
          placeholder: "e.g. Review of the recording confirmed a second person was answering",
          minLength: POLICY.minReasonLength,
        },
        acknowledge: "I confirm the malpractice has been investigated and confirmed, not just suspected.",
      }}
    >
      <ShieldOff aria-hidden /> Nullify for malpractice
    </ActionButton>
  );
}
