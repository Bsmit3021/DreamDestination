export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
      <div className="max-w-2xl min-w-0 space-y-2">
        {eyebrow && (
          <p className="text-xs font-medium tracking-widest text-primary uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h1>
        <div className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </div>
      </div>
      {actions && (
        <div className="flex max-w-sm shrink-0 flex-wrap items-start gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
