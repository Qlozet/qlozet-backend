import * as argon from 'argon2';

export class HashManager {
  static async createHash(value: string) {
    const hashedValue = await argon.hash(value);
    return hashedValue;
  }

  static async compareHash(incomingValue: string, currentValue: string) {
    const compare = await argon.verify(incomingValue, currentValue);
    return compare;
  }
}
