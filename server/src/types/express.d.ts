declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        role: string;
        shopId: string;
        shopName?: string;
      };
    }
  }
}

export {};
