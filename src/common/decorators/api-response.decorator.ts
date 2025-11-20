import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse, ApiExtraModels, getSchemaPath } from '@nestjs/swagger';
import { ApiBaseResponse } from '../dto/response.decorator';

export const ApiResponseWrapper = (model: any) => {
  return applyDecorators(
    ApiExtraModels(ApiBaseResponse),
    ApiExtraModels(model),

    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiBaseResponse) },
          {
            properties: {
              data: { $ref: getSchemaPath(model) },
            },
          },
        ],
      },
    }),
  );
};
