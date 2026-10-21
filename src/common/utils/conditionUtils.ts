export function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

export function evaluateCondition(fieldValue, operator, conditionValue) {
  switch (operator) {
    case 'equals':
    case 'is_equal_to':
      return fieldValue === conditionValue;
    case 'not_equals':
    case 'not_equal_to':
      return fieldValue !== conditionValue;
    case 'in':
      if (Array.isArray(fieldValue)) {
        return (
          Array.isArray(conditionValue) &&
          conditionValue.some((val) => fieldValue.includes(val))
        );
      } else {
        return (
          Array.isArray(conditionValue) && conditionValue.includes(fieldValue)
        );
      }
    case 'not_in':
      if (Array.isArray(fieldValue)) {
        return (
          Array.isArray(conditionValue) &&
          !conditionValue.some((val) => fieldValue.includes(val))
        );
      } else {
        return (
          Array.isArray(conditionValue) && !conditionValue.includes(fieldValue)
        );
      }
    case 'contains':
      if (Array.isArray(fieldValue)) {
        return fieldValue.some(
          (item) => typeof item === 'string' && item.includes(conditionValue),
        );
      }
      return (
        typeof fieldValue === 'string' && fieldValue.includes(conditionValue)
      );
    case 'starts_with':
      return (
        typeof fieldValue === 'string' && fieldValue.startsWith(conditionValue)
      );
    case 'ends_with':
      return (
        typeof fieldValue === 'string' && fieldValue.endsWith(conditionValue)
      );
    case 'greater_than':
      return typeof fieldValue === 'number' && fieldValue > conditionValue;
    case 'less_than':
      return typeof fieldValue === 'number' && fieldValue < conditionValue;
    case 'greater_equal':
      return typeof fieldValue === 'number' && fieldValue >= conditionValue;
    case 'less_equal':
      return typeof fieldValue === 'number' && fieldValue <= conditionValue;
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;
    default:
      return false;
  }
}

/**
 * A field read that walks through arrays: `clothing.color_variants.name`
 * yields every colour's name. One value comes back bare, several as a list.
 */
function readPath(obj: any, path: string): any {
  let current: any = obj;
  for (const key of path.split('.')) {
    if (Array.isArray(current)) {
      current = current.map((item) => item?.[key]).filter((v) => v !== undefined);
      if (current.length === 0) return undefined;
      if (current.length === 1) current = current[0];
    } else {
      current = current?.[key];
      if (current === undefined) return undefined;
    }
  }
  return current;
}

function compareOne(value: any, operator: string, expected: any): boolean {
  const a = String(value ?? '').toLowerCase();
  const b = String(expected ?? '').toLowerCase();
  switch (operator) {
    case 'is_equal_to':
    case 'equals':
      return a === b;
    case 'contains':
      return a.includes(b);
    case 'starts_with':
      return a.startsWith(b);
    case 'ends_with':
      return a.endsWith(b);
    case 'greater_than':
      return Number(value) > Number(expected);
    case 'less_than':
      return Number(value) < Number(expected);
    default:
      return false;
  }
}

/**
 * Whether a listing meets one rule of a vendor's size guide.
 *
 * The same reading as the vendor app's live preview
 * (pattern/products/hooks/use-product-conditions.ts), so the preview never
 * lists a product the server then leaves out: case-insensitive, and a list
 * field (categories, colours) matches when any entry does. "Is not equal to"
 * on a list means no entry is equal. Keep the two in step.
 */
export function listingMeetsCondition(
  product: any,
  field: string,
  operator: string,
  expected: any,
): boolean {
  const value = readPath(product, field);
  const values = Array.isArray(value) ? value : [value];
  if (operator === 'not_equal_to' || operator === 'not_equals') {
    return !values.some((v) => compareOne(v, 'is_equal_to', expected));
  }
  return values.some((v) => compareOne(v, operator, expected));
}
