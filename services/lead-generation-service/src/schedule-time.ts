/** Supported five-field cron syntax: numbers, lists, ranges and steps. */
export function computeNextRunAt(
  expression: string,
  fromDate = new Date(),
  timezone = "UTC",
): Date {
  if (!Number.isFinite(fromDate.getTime())) throw new Error("Invalid schedule date");
  const aliases: Record<string, string> = {
    "@hourly": "0 * * * *",
    hourly: "0 * * * *",
    "@daily": "0 9 * * *",
    daily: "0 9 * * *",
    "@weekly": "0 9 * * 1",
    weekly: "0 9 * * 1",
  };
  const normalized = expression.trim().toLowerCase();
  const parts = (aliases[normalized] ?? normalized).split(/\s+/);
  if (parts.length !== 5) throw new Error("Schedule requires five cron fields");
  const bounds = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  const fields = parts.map((part, index) => {
    const [min, max] = bounds[index];
    const values = new Set<number>();
    for (const segment of part.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(segment);
      if (!match) throw new Error("Unsupported cron expression");
      const step = match[2] ? Number(match[2]) : 1;
      if (!Number.isSafeInteger(step) || step < 1 || step > max + 1)
        throw new Error("Invalid cron step");
      const range = match[1] === "*" ? [min, max] : match[1].split("-").map(Number);
      const start = range[0];
      const end = range[1] ?? (match[2] ? max : start);
      if (start < min || end > max || start > end) throw new Error("Cron field outside range");
      for (let value = start; value <= end; value += step)
        values.add(index === 4 && value === 7 ? 0 : value);
    }
    return values;
  });
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  // Bound the search. Rare schedules beyond the horizon are rejected, never silently changed to daily.
  const candidate = new Date(Math.floor(fromDate.getTime() / 60000) * 60000 + 60000);
  for (
    let index = 0;
    index < 366 * 24 * 60;
    index++, candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  ) {
    const local = Object.fromEntries(
      formatter.formatToParts(candidate).map((p) => [p.type, p.value]),
    );
    if (
      !fields[0].has(Number(local.minute)) ||
      !fields[1].has(Number(local.hour)) ||
      !fields[3].has(Number(local.month))
    )
      continue;
    const dow = new Date(
      Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)),
    ).getUTCDay();
    const domMatches = fields[2].has(Number(local.day));
    const dowMatches = fields[4].has(dow);
    const dayMatches =
      parts[2] === "*" ? dowMatches : parts[4] === "*" ? domMatches : domMatches || dowMatches;
    if (dayMatches) return new Date(candidate);
  }
  throw new Error("Schedule has no occurrence within the supported 366-day horizon");
}
