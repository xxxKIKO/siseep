import { Injectable, type PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';
import { Errors } from './app.exception';

/** Validates `:id` route params. An invalid id is answered as "not found". */
@Injectable()
export class ObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (
      !Types.ObjectId.isValid(value) ||
      String(new Types.ObjectId(value)) !== value.toLowerCase()
    ) {
      throw Errors.notFound();
    }
    return value;
  }
}
