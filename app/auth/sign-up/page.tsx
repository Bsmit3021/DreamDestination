import type { Metadata } from "next";
import Link from "next/link";

import { SignUpForm } from "@/app/auth/sign-up/sign-up-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Create account · DreamDestination",
};

export default function SignUpPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-lg">
          Create your account
        </CardTitle>
        <CardDescription>
          Your profile and priorities are saved to your account so you can come
          back and refine them.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <SignUpForm />

        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={ROUTES.signIn}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
