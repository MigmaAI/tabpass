/** Follows the system light/dark setting, the way shadcn/ui expects (a `dark` class on <html>). */
export function followSystemTheme(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (): void => {
    document.documentElement.classList.toggle('dark', query.matches);
  };
  apply();
  query.addEventListener('change', apply);
}
