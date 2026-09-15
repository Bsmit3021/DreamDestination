"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { recalculateRecommendationsAction } from "@/app/recommendations/actions";
import { FormAlert, SubmitButton } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE } from "@/lib/forms";
import type { RecommendationView } from "@/lib/matching/snapshot";
import { ROUTES, recommendationsViewPath } from "@/lib/routes";

/**
 * The two recommendation actions, deliberately different in kind.
 *
 * Recalculating is a mutation: a form posting to a server action that reruns
 * the engine and replaces the stored snapshot. It sends no payload — the server
 * derives the profile from the session — and its submit button disables itself
 * while running, so a double submission cannot race on the unique
 * (profile_id, rank) constraint.
 *
 * Exploring is navigation only: a link to the alternatives view of the same
 * stored snapshot. It never rescores, deletes or replaces anything.
 */
export function RecommendationActions({
  hasExisting,
  view,
}: {
  hasExisting: boolean;
  view: RecommendationView;
}) {
  const [state, formAction] = useActionState(
    recalculateRecommendationsAction,
    IDLE_FORM_STATE,
  );

  return (
    <div className="flex flex-col gap-3">
      <FormAlert state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <form action={formAction}>
          <SubmitButton
            pendingLabel={hasExisting ? "Recalculating…" : "Scoring cities…"}
          >
            {hasExisting ? "Recalculate best matches" : "Find my matches"}
          </SubmitButton>
          <PendingAnnouncement />
        </form>

        {hasExisting && (
          <Button variant="outline" size="lg" asChild>
            {view === "alternatives" ? (
              <Link href={ROUTES.recommendations}>Back to best matches</Link>
            ) : (
              <Link href={recommendationsViewPath("alternatives")}>
                Explore different places
              </Link>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Tells screen-reader users the recalculation is running, not just visually. */
function PendingAnnouncement() {
  const { pending } = useFormStatus();

  return (
    <span role="status" className="sr-only">
      {pending ? "Recalculating your matches…" : ""}
    </span>
  );
}
