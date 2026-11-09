import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import 'local_store.dart';

class SignInConfig {
  const SignInConfig(this.url, this.key);
  final String url;
  final String key;
}

/// Where to sign in. Built-in values (--dart-define) win; otherwise the app asks its server
/// (`/api/mobile/config`, public values only) and keeps the answer, so later starts work offline.
Future<SignInConfig?> loadSignInConfig(LocalStore store) async {
  if (AppConfig.supabaseUrl.isNotEmpty && AppConfig.supabaseAnonKey.isNotEmpty) {
    return const SignInConfig(AppConfig.supabaseUrl, AppConfig.supabaseAnonKey);
  }
  SignInConfig? fromJson(Map<String, dynamic>? data) {
    final url = '${data?['supabaseUrl'] ?? ''}', key = '${data?['supabaseAnonKey'] ?? ''}';
    return url.isEmpty || key.isEmpty ? null : SignInConfig(url, key);
  }

  try {
    final res = await http.get(Uri.parse('${AppConfig.apiBase}/api/mobile/config')).timeout(const Duration(seconds: 15));
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final config = fromJson(data);
      if (config != null) {
        await store.write('config', data);
        return config;
      }
    }
  } catch (_) {}
  return fromJson(store.read('config'));
}
