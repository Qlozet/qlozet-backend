export function capitalizeFirstLetter(input: string): string {
  return input.toLowerCase().replace(/(?:^|\s)\S/g, (char) => char.toUpperCase());
}
