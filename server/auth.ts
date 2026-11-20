import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../src/engine/types';

const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (
  isProduction
    ? (() => { throw new Error('JWT_SECRET must be set in production.'); })()
    : 'stockmind-local-development-secret-only'
);

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: string[];
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      permissions: user.permissions,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

export function requireRoles(allowedRoles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.user.role === 'Admin' || allowedRoles.includes(req.user.role)) {
      next();
      return;
    }
    res.status(403).json({
      error: `Role '${req.user.role}' is not authorized for this operation. Required: ${allowedRoles.join(', ')}.`,
    });
  };
}
