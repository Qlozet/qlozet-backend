export const percentageChange = (current: number, previous: number): string => {
  if (previous === 0 && current === 0) return '0%';
  if (previous === 0) return '+100%';

  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
};
