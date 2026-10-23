// Apply the saved theme before first paint to avoid a flash. Kept as a file (not an inline
// script) so the Content-Security-Policy can allow scripts from this site only.
try {
  var t = localStorage.getItem('ts-theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) { document.documentElement.dataset.theme = 'light'; }
