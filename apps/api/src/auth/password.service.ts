import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

/** OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane). */
const ARGON2_OPTIONS: argon2.HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService implements OnModuleInit {
  /** Hash verified when the email does not exist, so both paths take the same time. */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('contraseña-de-relleno-para-tiempo-constante');
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash || this.dummyHash, password);
    } catch {
      return false;
    }
  }

  /** Burns the same time as a real verification. */
  async verifyDummy(password: string): Promise<void> {
    await this.verify(this.dummyHash, password);
  }
}
