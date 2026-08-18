import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DestinationComparisonRow } from "@/lib/opportunity/service";

/**
 * Side-by-side comparison of the user's recommendations.
 *
 * Row order is the stored Phase 3 rank — wages and rents are columns, never
 * sort keys. Re-ranking on salary would quietly substitute our priorities for
 * the user's.
 *
 * Desktop gets a table; narrow screens get stacked cards, because a six-column
 * table at 375px is either unreadable or overflows.
 */
export function DestinationComparison({
  rows,
  occupation,
}: {
  rows: DestinationComparisonRow[];
  occupation: { socCode: string; title: string } | null;
}) {
  if (rows.length === 0) return null;

  const money = (value: number | null) =>
    value === null ? "—" : `$${Math.round(value).toLocaleString("en-US")}`;

  const budget = (value: number | null) => {
    if (value === null) return "—";
    const amount = `$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
    return value >= 0 ? `+${amount}` : `−${amount}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Compare your matches</CardTitle>
        <CardDescription>
          {occupation
            ? `Wages are the metro median for ${occupation.title}.`
            : "Confirm your occupation to add wage columns."}{" "}
          Ordered by your DreamDestination Fit — not by wage or rent.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Desktop */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Fit score, occupation wage and rent for each recommended metro
            </caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="pb-2 font-medium">
                  Metro
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Fit
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Median wage
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Median rent
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Budget gap
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cityId} className="border-t border-border/60">
                  <th scope="row" className="py-2 pr-2 text-left font-normal">
                    <Link
                      href={`/recommendations/${row.cityId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.rank}. {row.name}
                    </Link>
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {Math.round(row.fitScore)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(row.medianWage)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(row.medianRent)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {budget(row.budgetDifference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <ul className="flex flex-col gap-4 sm:hidden">
          {rows.map((row) => (
            <li
              key={row.cityId}
              className="border-t border-border/60 pt-3 first:border-0 first:pt-0"
            >
              <Link
                href={`/recommendations/${row.cityId}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {row.rank}. {row.name}
              </Link>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Fit</dt>
                <dd className="text-right tabular-nums">
                  {Math.round(row.fitScore)} / 100
                </dd>
                <dt className="text-muted-foreground">Median wage</dt>
                <dd className="text-right tabular-nums">
                  {money(row.medianWage)}
                </dd>
                <dt className="text-muted-foreground">Median rent</dt>
                <dd className="text-right tabular-nums">
                  {money(row.medianRent)}
                </dd>
                <dt className="text-muted-foreground">Budget gap</dt>
                <dd className="text-right tabular-nums">
                  {budget(row.budgetDifference)}
                </dd>
              </dl>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs text-muted-foreground">
          Wage and rent figures are metro-wide estimates from BLS OEWS and
          Census ACS. They describe the market, not an offer or an available
          home.
        </p>
      </CardContent>
    </Card>
  );
}
