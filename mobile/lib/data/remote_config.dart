import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import 'local_store.dart';

class SignInConfig {
  const SignInConfig(this.url, this.key);
  final String url;
  final String key;
}

SignInConfig? _fromJson(Map<String, dynamic>? data) {
  final url = '${data?['supabaseUrl'] ?? ''}', key = '${data?['supabaseAnonKey'] ?? ''}';
  return url.isEmpty || key.isEmpty ? null : SignInConfig(url, key);
}

/// Where to sign in. Built-in values (--dart-define) win; otherwise the app asks its server
/// (`/api/mobile/config`, public values only) and keeps the answer, so later starts work offline.
/// With a saved copy the app opens at once and the copy is brought up to date in the background
/// (no waiting on the splash on weak mobile data).
Future<SignInConfig?> loadSignInConfig(LocalStore store) async {
  if (AppConfig.supabaseUrl.isNotEmpty && AppConfig.supabaseAnonKey.isNotEmpty) {
    return const SignInConfig(AppConfig.supabaseUrl, AppConfig.supabaseAnonKey);
  }
  final saved = _fromJson(store.read('config'));
  if (saved != null) {
    unawaited(_fetchConfig(store));
    return saved;
  }
  return _fetchConfig(store);
}

/// Ask the server for the sign-in settings and keep them. Null when it cannot be reached.
Future<SignInConfig?> _fetchConfig(LocalStore store) async {
  try {
    final res = await http.get(Uri.parse('${AppConfig.apiBase}/api/mobile/config')).timeout(const Duration(seconds: 15));
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final config = _fromJson(data);
      if (config != null) {
        await store.write('config', data);
        return config;
      }
    }
  } catch (_) {}
  return null;
}
