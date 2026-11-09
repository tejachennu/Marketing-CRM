/// Settings passed at build time with --dart-define. No secrets live in the code:
///   API_BASE           where the WAMA CRM web app runs (default: production)
///   SUPABASE_URL       the Supabase project URL (for signing in)
///   SUPABASE_ANON_KEY  the Supabase public (anon) key
///   DEMO=true          run on sample data, no account needed (for previews and screenshots)
class AppConfig {
  static const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://wamacrm.magnetora.in');
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const demo = bool.fromEnvironment('DEMO');
}
