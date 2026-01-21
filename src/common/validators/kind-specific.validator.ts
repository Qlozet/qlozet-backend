// kind-specific.validator.ts
import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Validator for required fields based on kind
@ValidatorConstraint({ async: false })
export class RequiredForKindConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    const [allowedKinds] = args.constraints;
    const object = args.object as any;

    // If the current kind requires this field, it must be provided and not empty
    if (allowedKinds.includes(object.kind)) {
      return value !== undefined && value !== null && value !== '';
    }

    // If the current kind doesn't require this field, it's optional
    return true;
  }

  defaultMessage(args: ValidationArguments) {
    const [allowedKinds] = args.constraints;
    return `${args.property} is required when kind is ${allowedKinds.join(' or ')}`;
  }
}

export function RequiredForKind(
  allowedKinds: string[],
  validationOptions?: ValidationOptions,
) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [allowedKinds],
      validator: RequiredForKindConstraint,
    });
  };
}

// Validator to forbid fields based on kind
@ValidatorConstraint({ async: false })
export class ForbiddenForKindConstraint
  implements ValidatorConstraintInterface
{
  validate(value: any, args: ValidationArguments) {
    const [forbiddenKinds] = args.constraints;
    const object = args.object as any;

    // If the current kind forbids this field, it must not be provided
    if (forbiddenKinds.includes(object.kind)) {
      return value === undefined || value === null || value === '';
    }

    // If the current kind allows this field, it's optional
    return true;
  }

  defaultMessage(args: ValidationArguments) {
    const [forbiddenKinds] = args.constraints;
    return `${args.property} should not be provided when kind is ${forbiddenKinds.join(' or ')}`;
  }
}

export function ForbiddenForKind(
  forbiddenKinds: string[],
  validationOptions?: ValidationOptions,
) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [forbiddenKinds],
      validator: ForbiddenForKindConstraint,
    });
  };
}
