import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PreferencesForm } from "@/app/onboarding/preferences/preferences-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUserPreferences } from "@/lib/data/preferences";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Your priorities · DreamDestination",
};

export default async function OnboardingPreferencesPage() {
  const profile = await getCurrentUserProfile();

  // Preferences hang off a profile, so there is nothing to attach them to yet.
  if (!profile) {
    redirect(ROUTES.onboardingProfile);
  }

  const preferences = await getCurrentUserPreferences();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">What matters most to you?</CardTitle>
        <CardDescription>
          Move each slider to say how much weight a factor should carry. There
          are no wrong answers — this is about your priorities, not a ranking of
          cities.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <PreferencesForm weights={preferences?.weights ?? null} />
      </CardContent>
    </Card>
  );
}
