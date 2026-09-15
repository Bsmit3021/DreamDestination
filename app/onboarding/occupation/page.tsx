import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  OccupationForm,
  type OccupationChoice,
} from "@/app/onboarding/occupation/occupation-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getCurrentUserCareerTarget,
  loadOccupationTitleIndex,
} from "@/lib/data/career-targets";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { resolveOccupation } from "@/lib/occupations/resolver";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Confirm your occupation · DreamDestination",
};

/**
 * Occupation confirmation step.
 *
 * The resolver ranks candidates deterministically; this page exists for the
 * cases it deliberately refuses to decide alone. Nothing is stored until the
 * user chooses, so a weak guess never becomes a saved fact.
 */
export default async function OccupationPage() {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect(ROUTES.onboardingProfile);

  const [index, existing] = await Promise.all([
    loadOccupationTitleIndex(),
    getCurrentUserCareerTarget(),
  ]);

  const resolution = resolveOccupation(profile.occupation, index);

  const candidates: OccupationChoice[] = resolution.candidates.map(
    (candidate) => ({
      socCode: candidate.socCode,
      title: candidate.title,
      matchedTitle: candidate.matchedTitle,
      confidence: candidate.confidence,
      matchType: candidate.matchType,
    }),
  );

  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader className="border-b">
        <CardTitle as="h1" className="text-2xl">
          Confirm your occupation
        </CardTitle>
        <CardDescription>
          Career statistics come from the U.S. Bureau of Labor Statistics, which
          organises jobs by standard occupation code. Matching your job title to
          the right code is done by exact and published-title comparison — no
          model guesses at it — so where it is uncertain, you decide.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {existing && (
          <p className="text-sm text-muted-foreground">
            Currently set to{" "}
            <span className="font-medium text-foreground">
              {existing.title}
            </span>{" "}
            (SOC {existing.socCode})
            {existing.confirmedByUser ? ", confirmed by you." : "."}
          </p>
        )}

        {candidates.length === 0 ? (
          <p className="text-sm">
            No standard occupation matched &ldquo;{profile.occupation}&rdquo;.
            You can{" "}
            <Link
              href={ROUTES.onboardingProfile}
              className="font-medium underline underline-offset-4"
            >
              edit your profile
            </Link>{" "}
            to describe your work differently. Housing intelligence still works
            without an occupation.
          </p>
        ) : (
          <OccupationForm
            sourceText={profile.occupation}
            candidates={candidates}
            selectedSocCode={existing?.socCode ?? null}
          />
        )}

        <p className="text-xs text-muted-foreground">
          Occupation data: O*NET 30.3, U.S. Department of Labor / Employment and
          Training Administration, used under CC BY 4.0.
        </p>
      </CardContent>
    </Card>
  );
}
