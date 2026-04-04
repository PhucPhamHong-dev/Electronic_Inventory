import type { AuthenticatedUser, RequestContext } from "./index";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      context?: RequestContext;
    }
  }
}

export {};
