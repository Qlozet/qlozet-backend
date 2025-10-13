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
    total_items: number;
    data: T[];
    total_pages: number;
    current_page: number;
    has_next_page: boolean;
    has_previous_page: boolean;
    page_size: number;
  }> {
    const total_items = Number(details.count) || 0;
    const data = Array.isArray(details.rows) ? details.rows : [];
    const current_page = Number.isInteger(page) && page > 0 ? page : 1;
    const page_size = Number.isInteger(limit) && limit > 0 ? limit : 10;
    const total_pages = Math.ceil(total_items / page_size);

    const has_next_page = current_page < total_pages;
    const has_previous_page = current_page > 1;

    return {
      total_items,
      data,
      total_pages: total_pages || 0,
      current_page,
      has_next_page,
      has_previous_page,
      page_size,
    };
  }
}
