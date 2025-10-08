import {
  Injectable,
  ExecutionContext,
  CallHandler,
  HttpException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { customExceptionFactory } from '../factories/custom.factory.exception';

@Injectable()
export class CustomResponseInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data) => {
        const messageFromData = data?.message || null;

        return {
          statusCode,
          message: messageFromData || (statusCode >= 400 ? 'Error' : 'Success'), // Use message from data if available
          error: statusCode >= 400 ? response.message : null,
          timestamp: Date.now(),
          version: 'v1',
          path: request.url,
          data: messageFromData ? { ...data.data, message: undefined } : data, // Remove message from data if it was promoted
        };
      }),
      catchError((err) => {
        const statusCode = err instanceof HttpException ? err.getStatus() : 500;
        let errorResponse = {
          statusCode,
          message: null,
          error: null,
          timestamp: Date.now(),
          version: 'v1',
          path: request.url,
          data: null,
        };

        const messageFilter = Array.isArray(err?.response?.message)
          ? customExceptionFactory(err?.response?.message)
          : err.message || 'Internal server error';
        errorResponse.message = messageFilter;
        errorResponse.error = err?.response?.error || err.name;
        return throwError(() => new HttpException(errorResponse, statusCode));
      }),
    );
  }
}
