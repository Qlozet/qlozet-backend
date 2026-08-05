// utils/objectId.utils.ts
import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';

export class ObjectIdUtils {
  /**
   * Safely create ObjectId from string with validation
   */
  static create(id: string): Types.ObjectId {
    if (!id) {
      throw new BadRequestException('ObjectId cannot be empty');
    }
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
    return new Types.ObjectId(id);
  }

  /**
   * Create array of ObjectIds from string array
   */
  static createArray(ids: string[] | undefined): Types.ObjectId[] {
    if (!ids || !Array.isArray(ids)) return [];
    return ids.map((id) => this.create(id));
  }

  /**
   * Convert single ID or array of IDs to ObjectId array
   */
  static toArray(idOrIds: string | string[] | undefined): Types.ObjectId[] {
    if (!idOrIds) return [];

    if (Array.isArray(idOrIds)) {
      return this.createArray(idOrIds);
    }

    return [this.create(idOrIds)];
  }

  /**
   * Validate if string is a valid ObjectId
   */
  static isValid(id: string): boolean {
    return Types.ObjectId.isValid(id);
  }

  /**
   * Lenient coercion for persisting ref fields. Accepts an ObjectId, a string
   * id (e.g. `req.user.id`, which comes off the JWT as a string), or a nullish
   * value, and returns a real ObjectId (or undefined). Use this when WRITING a
   * ref field so it is never stored as a BSON string — string-typed refs are
   * silently missed by ObjectId-equality queries and `populate()`.
   */
  static toObjectId(
    value: string | Types.ObjectId | null | undefined,
  ): Types.ObjectId | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (value instanceof Types.ObjectId) return value;
    const str = String(value);
    return Types.ObjectId.isValid(str) ? new Types.ObjectId(str) : undefined;
  }

  /**
   * Create ObjectId from timestamp (replacement for deprecated constructor)
   */
  static createFromTime(timestamp: number): Types.ObjectId {
    return Types.ObjectId.createFromTime(timestamp);
  }

  /**
   * Generate new ObjectId
   */
  static generate(): Types.ObjectId {
    return new Types.ObjectId();
  }
}
