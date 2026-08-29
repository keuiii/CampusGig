import type { UserRole, UserStatus } from "@prisma/client";

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  roles: UserRole[];
};

export type AccessTokenPayload = {
  sub: string;
  email: string;
  roles: UserRole[];
};
