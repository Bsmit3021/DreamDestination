import type { Metadata } from "next";
import Link from "next/link";

import { SignInForm } from "@/app/auth/sign-in/sign-in-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  const { redirectTo, signup } = await searchParams;

  // Sanitised here rather than trusted: an unchecked ?redirectTo would make
  // this form an open redirect.
  const target = safeRedirectPath(
    typeof redirectTo === "string" ? redirectTo : null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-lg">
          Sign in
        </CardTitle>
        <CardDescription>
          Welcome back. Sign in to continue your city research.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {signup === "success" && (
          <Alert role="status">
            <AlertTitle>Account created</AlertTitle>
            <AlertDescription>
              Sign in with the email and password you just chose.
            </AlertDescription>
          </Alert>
        )}
        {signup === "confirmation-required" && (
          <Alert role="status">
            <AlertTitle>Email confirmation is still required</AlertTitle>
            <AlertDescription>
              This service currently requires email confirmation before you can
              sign in. Check your inbox and spam folder for a confirmation link.
            </AlertDescription>
          </Alert>
        )}
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
