export interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export type JwtSignPayload = Omit<JwtPayload, 'iat' | 'exp'>;

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    emailVerified: boolean;
  };
}
