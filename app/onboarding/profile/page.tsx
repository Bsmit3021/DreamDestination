import type { Metadata } from "next";

import { ProfileForm } from "@/app/onboarding/profile/profile-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUserProfile } from "@/lib/data/profiles";

export const metadata: Metadata = {
  title: "Your profile · DreamDestination",
};

export default async function OnboardingProfilePage() {
  // Reads as the signed-in user, so RLS guarantees this can only ever be their
  // own profile.
  const profile = await getCurrentUserProfile();

  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader className="border-b">
        <CardTitle as="h1" className="text-2xl">
          {profile ? "Edit your profile" : "Tell us about your situation"}
        </CardTitle>
        <CardDescription>
          The circumstances, budget, and goals behind your matches. You can
          change any of these details as your plans evolve.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ProfileForm profile={profile} />
      </CardContent>
    </Card>
  );
}
