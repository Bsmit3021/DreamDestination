import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getOnboardingStatus } from "@/lib/data/preferences";
import { resolveOnboardingDestination } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Onboarding · DreamDestination",
};

/**
 * Onboarding hub.
 *
 * Sends the user to whichever step is still outstanding; once both are done it
 * continues to matches, with editing available through workspace navigation.
 */
export default async function OnboardingPage() {
  const status = await getOnboardingStatus();
  redirect(resolveOnboardingDestination(status));
}
