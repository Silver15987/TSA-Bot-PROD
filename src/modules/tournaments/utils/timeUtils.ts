/**
 * Time utilities for tournaments, especially IST daily windows.
 */

/**
 * Get UTC start/end for a given local IST date (YYYY-MM-DD) covering 00:00–23:59:59.999.
 */
export function getIstDayWindowUtc(date: Date): { startUtc: Date; endUtc: Date } {
  const istOffsetMinutes = 5 * 60 + 30;
  const istMillis = date.getTime() + istOffsetMinutes * 60 * 1000;
  const istDate = new Date(istMillis);

  const year = istDate.getUTCFullYear();
  const month = istDate.getUTCMonth();
  const day = istDate.getUTCDate();

  // Construct IST-local start/end, then convert back to UTC by subtracting offset
  const startIst = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const endIst = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

  const startUtc = new Date(startIst.getTime() - istOffsetMinutes * 60 * 1000);
  const endUtc = new Date(endIst.getTime() - istOffsetMinutes * 60 * 1000);

  return { startUtc, endUtc };
}

