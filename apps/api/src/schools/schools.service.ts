import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { School, type SchoolDocument } from './school.schema';

export interface UpsertSchoolInput {
  name: string;
  shortName?: string;
  cct?: string;
  city?: string;
  state?: string;
}

@Injectable()
export class SchoolsService {
  constructor(@InjectModel(School.name) private readonly schoolModel: Model<School>) {}

  /** Creates the school or updates it when one with the same name exists (used by the seed). */
  async upsertByName(input: UpsertSchoolInput): Promise<SchoolDocument> {
    return this.schoolModel.findOneAndUpdate(
      { name: input.name },
      { $set: input },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}
