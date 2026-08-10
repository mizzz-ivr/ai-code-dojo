export type Role = 'admin' | 'editor' | 'viewer';
export type AccessLevel = 'blocked' | 'full' | 'write' | 'read';

export interface UserAccess {
  roles: Role[];
  suspended: boolean;
}

export function getAccessLevel(_user: UserAccess): AccessLevel {
  return 'read';
}
