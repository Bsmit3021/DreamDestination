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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {profile ? "Edit your profile" : "Tell us about your situation"}
        </CardTitle>
        <CardDescription>
          This is the structured picture of your life that future matching will
          work from. You can change any of it later.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ProfileForm profile={profile} />
      </CardContent>
    </Card>
  );
}
