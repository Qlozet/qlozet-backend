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
