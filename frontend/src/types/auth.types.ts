export const Role = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  USER: 'USER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  role: Role | null;
  token: string | null;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  token: string;
}
