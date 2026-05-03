export const auth = async (): Promise<{ userId: string } | null> => null;
export const currentUser = async (): Promise<{ id: string } | null> => null;
export const requireUserSession = async (): Promise<void> => {
  // throws if no session
};
export const verifyAdminAccess = async (): Promise<void> => {
  // throws if not admin
};
