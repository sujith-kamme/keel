export const THEME_COOKIE = "keel_theme";

/**
 * Inlined in <head> by the root layout, so it runs before first paint on every full load: sets `dark` on <html>
 * from the keel_theme cookie (light|dark), else from prefers-color-scheme, and keeps following the OS while the
 * preference is system. Client navigations keep the same <html>, so it never needs to run again.
 */
export const themeScript = `(function(){var d=document.documentElement,q=matchMedia("(prefers-color-scheme: dark)");function a(){var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)(?:;|$)/),t=m?m[1]:"system";d.classList.toggle("dark",t==="dark"||(t==="system"&&q.matches))}a();q.addEventListener("change",a)})()`;
