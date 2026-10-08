// Centralized API Configuration for Pharmora POS
// Automatically routes to production Render backend in production, or localhost in development

export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://pharmora-pos-api.onrender.com' : 'http://localhost:4000');
