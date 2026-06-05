import type { User as PrismaUser } from '@prisma/client';

// Augment Express's Request with the user set by JwtAuthGuard.
declare global {
  namespace Express {
    interface Request {
      user?: PrismaUser;
    }
  }
}

export {};
