import type { Metadata } from "next";
import Link from "next/link";

import { SignInForm } from "@/app/auth/sign-in/sign-in-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROUTES, safeRedirectPath } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Sign in · DreamDestination",
};

export default async function SignInPage({
  searchParams,
}: PageProps<"/auth/sign-in">) {
  const { redirectTo } = await searchParams;

  // Sanitised here rather than trusted: an unchecked ?redirectTo would make
  // this form an open redirect.
  const target = safeRedirectPath(
    typeof redirectTo === "string" ? redirectTo : null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sign in</CardTitle>
        <CardDescription>
          Welcome back. Sign in to continue your DreamDestination profile.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <SignInForm redirectTo={target} />

        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href={ROUTES.signUp}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
