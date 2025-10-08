export function generateSimpleSKU(productName: string): string {
  const cleanName = productName
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .substring(0, 6);

  const timestamp = Date.now().toString().slice(-6);

  return `${cleanName}${timestamp}`;
}
