export function authorizeStorefront(role: string): boolean {
  return role === 'storefront' || role === 'operator';
}
