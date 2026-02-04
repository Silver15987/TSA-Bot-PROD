/**
 * Time utilities for tournaments, especially IST daily windows.
 */

/**
 * Get UTC start/end for a given local IST date (YYYY-MM-DD) covering 00:00–23:59:59.999.
 */
export function getIstDayWindowUtc(date: Date): { startUtc: Date; endUtc: Date } {
  // Clone input date and force to midnight IST
  const istYear = date.getFullYear();
  const istMonth = date.getMonth();
  const istDate = date.getDate();

  // Construct a Date as if in IST by subtracting offset
  const istOffsetMinutes = 5 * 60 + 30;

  const startIst = new Date(Date.UTC(istYear, istMonth, istDate, 0, 0, 0, 0));
  const endIst = new Date(Date.UTC(istYear, istMonth, istDate, 23, 59, 59, 999));

  // Convert IST to UTC by subtracting offset
  const startUtc = new Date(startIst.getTime() - istOffsetMinutes * 60 * 1000);
  const endUtc = new Date(endIst.getTime() - istOffsetMinutes * 60 * 1000);

  return { startUtc, endUtc };
}

