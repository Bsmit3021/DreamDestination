import { Scale } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { hasUniformWeights } from "@/lib/matching/weights";
import { ROUTES } from "@/lib/routes";
import type { PreferenceWeights } from "@/types/profile";

/**
 * Says so when every priority slider holds the same value.
 *
 * Equal weighting is a valid choice, but it is also what saving the form
 * untouched produces, and the ranking it yields otherwise looks just as
 * deliberate as one built on varied priorities. This names the situation and
 * links to the sliders. It never re-weights anything or suggests which
 * priorities should matter — that stays the user's call.
 */
export function EqualWeightingNotice({
  weights,
}: {
  weights: PreferenceWeights | null;
}) {
  if (!weights || !hasUniformWeights(weights)) {
    return null;
  }

  return (
    <Alert role="status" className="px-4 py-3">
      <Scale aria-hidden="true" />
      <AlertTitle>Your priorities are weighted equally</AlertTitle>
      <AlertDescription>
        Every priority slider is set to the same value, so no priority counts
        more than another and your matches reflect no particular emphasis. If
        some matter more to you,{" "}
        <Link href={ROUTES.onboardingPreferences}>adjust your priorities</Link>{" "}
        and regenerate your matches.
      </AlertDescription>
    </Alert>
  );
}
