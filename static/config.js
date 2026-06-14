/* Fill these in with your own values, then redeploy.
   Find SUPABASE_URL and SUPABASE_ANON_KEY in your Supabase dashboard under
   Settings → API. The anon key is designed to be embedded in frontend code. */
window.CONFIG = {
  SUPABASE_URL: "https://cudfaekewgonzzgpqnqh.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_vcLCsMHBDItKWvDDzFGjWA_DtUni8Qz",

  // Where the processing page sends YouTube links to be analyzed.
  // "" = same origin (correct when Flask serves this page on your Mac).
  // Only the processing page uses this; the practice page never analyzes.
  ANALYZE_API: "",
};
