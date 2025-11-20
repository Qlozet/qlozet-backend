// common/dto/response.decorator.ts
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { BaseResponseDto } from './base-response.dto';

export const ApiBaseResponse = <TModel extends new (...args: any[]) => any>(
  model: TModel,
) => {
  return (target: any, key: string, descriptor: PropertyDescriptor) => {
    ApiExtraModels(model)(target, key, descriptor);
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(BaseResponseDto) },
          {
            properties: {
              data: { $ref: getSchemaPath(model) },
            },
          },
        ],
      },
    })(target, key, descriptor);
  };
};
