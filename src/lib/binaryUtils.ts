/**
 * Generates a unique 6-digit binary code that is not in the list of existing codes.
 * It starts from "000001" and increments.
 * @param existingCodes - An array of binary codes that are already in use.
 * @returns A new, unique 6-digit binary code.
 */
export function generateBinaryCode(existingCodes: string[]): string {
  let nextNumber = 1;
  let newCode: string;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    newCode = nextNumber.toString(2).padStart(6, '0');
    if (!existingCodes.includes(newCode)) {
      return newCode;
    }
    nextNumber++;
  }
}
