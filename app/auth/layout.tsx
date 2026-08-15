import Link from "next/link";

import { ROUTES } from "@/lib/routes";

export default function AuthLayout({ children }: LayoutProps<"/auth">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link
          href={ROUTES.home}
          className="font-heading text-2xl font-semibold tracking-tight"
        >
          DreamDestination
        </Link>
        <p className="text-sm text-muted-foreground">
          Find the place that fits the life you want.
        </p>
      </div>

      {children}
    </main>
  );
}
