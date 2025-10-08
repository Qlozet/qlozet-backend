export class Utils {
  static async getPagination(
    page: number = 1,
    size: number = 10,
  ): Promise<{ take: number; skip: number }> {
    const validatedPage = Number.isInteger(page) && page > 0 ? page : 1;
    const validatedSize = Number.isInteger(size) && size > 0 ? size : 10;

    const take = validatedSize;
    const skip = (validatedPage - 1) * validatedSize;

    return { take, skip };
  }

  static async getPagingData<T>(
    details: { count: number; rows: T[] },
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    totalItems: number;
    data: T[];
    totalPages: number;
    currentPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    pageSize: number;
  }> {
    const totalItems = Number(details.count) || 0;
    const data = Array.isArray(details.rows) ? details.rows : [];
    const currentPage = Number.isInteger(page) && page > 0 ? page : 1;
    const pageSize = Number.isInteger(limit) && limit > 0 ? limit : 10;
    const totalPages = Math.ceil(totalItems / pageSize);

    const hasNextPage = currentPage < totalPages;
    const hasPreviousPage = currentPage > 1;

    return {
      totalItems,
      data,
      totalPages: totalPages || 0,
      currentPage,
      hasNextPage,
      hasPreviousPage,
      pageSize,
    };
  }
}
