export function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

export function evaluateCondition(fieldValue, operator, conditionValue) {
  switch (operator) {
    case 'equals':
      return fieldValue === conditionValue;
    case 'not_equals':
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
